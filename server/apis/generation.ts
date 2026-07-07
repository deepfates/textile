import type { Request, Response } from "express";
import type { ModelId } from "../../shared/models";
import { getModel } from "../modelsStore";
import {
  DEFAULT_LENGTH_MODE,
  LENGTH_PRESETS,
  type LengthMode,
} from "../../shared/lengthPresets";
import {
  ENDING_NEWLINE_RE,
  ENDING_WHITESPACE_RE,
  NON_WHITESPACE_RE,
} from "../../shared/textSeams";
import {
  getBoundaryRegex as helperGetBoundaryRegex,
  findBoundaryCutoff as helperFindBoundaryCutoff,
  normalizeJoin as helperNormalizeJoin,
  prepareGeneratedText,
} from "./generation.helpers";
import { validateGenerateRequestBody } from "./validators";

import { openai } from "./openaiClient";

// Boundary regex is provided by helpers to keep API lean
function getBoundaryRegex(mode: LengthMode): RegExp | null {
  return helperGetBoundaryRegex(mode);
}

// Find the first boundary whose end is beyond sentIndex (delegated to helpers)
function findBoundaryCutoff(
  accumulated: string,
  sentIndex: number,
  rx: RegExp,
): number | null {
  return helperFindBoundaryCutoff(accumulated, sentIndex, rx);
}

type JoinState = {
  hasEmittedAny: boolean;
  endedWithWhitespace: boolean;
  endedWithNewline: boolean;
};

// Normalize join delegated to helpers for consistency across client/server
function normalizeJoin(prev: JoinState, segment: string): string {
  return helperNormalizeJoin(prev, segment);
}

// Tests should import helpers directly from ./generation.helpers; no __test export

export async function generateText(req: Request, res: Response) {
  try {
    const parsed = validateGenerateRequestBody(req.body);
    if (!parsed.ok) {
      return res.status(400).json({ error: parsed.error });
    }
    const { prompt, model, temperature, maxTokens, lengthMode } = parsed.value;

    const modelConfig = getModel(model as ModelId);
    if (!modelConfig) {
      return res.status(400).json({ error: "Invalid model specified" });
    }

    const mode = lengthMode ?? DEFAULT_LENGTH_MODE;
    const preset = LENGTH_PRESETS[mode] ?? LENGTH_PRESETS[DEFAULT_LENGTH_MODE];

    const modelMaxTokens = modelConfig.maxTokens;

    const presetMaxTokens = preset.maxTokens;
    const requestedMaxTokens = maxTokens ?? presetMaxTokens;
    const maxTokensToUse = Math.max(
      1,
      Math.min(modelMaxTokens, presetMaxTokens, requestedMaxTokens),
    );

    // Build boundary matcher (server-side semantic stopping)
    const boundaryRegex = getBoundaryRegex(mode);

    const completionParams = {
      model,
      prompt: [
        "Continue the story directly from the supplied text.",
        "Return only prose that belongs in the story.",
        "Do not include assistant preambles, explanations, labels, or Markdown emphasis.",
        "",
        prompt,
      ].join("\n"),
      temperature: temperature ?? modelConfig.defaultTemp,
      max_tokens: maxTokensToUse,
      // Omit upstream 'stop'; semantic stopping is handled server-side via boundary detection.
      stream: true,
    } as const;

    console.log("[OpenRouter] Request:", {
      model,
      max_tokens: maxTokensToUse,
      temperature: completionParams.temperature,
      prompt_length: prompt.length,
      prompt_preview: prompt.slice(-100),
    });

    // Set up SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // End helpers
    let ended = false;
    let activeAbortController: AbortController | null = null;
    const endEarly = () => {
      if (!ended) {
        res.write("data: [DONE]\n\n");
        res.end();
        ended = true;
      }
    };
    req.on("close", () => {
      if (!ended) {
        activeAbortController?.abort();
        endEarly();
      }
    });

    // Owner ruling 2026-07-06: NEVER discard generations invisibly. Chat-model slop
    // is visible and we generate past it. Retries stay off (loop runs once).
    const MAX_PREAMBLE_RETRIES = 0;
    for (let attempt = 0; attempt <= MAX_PREAMBLE_RETRIES && !ended; attempt++) {
      const abortController = new AbortController();
      activeAbortController = abortController;
      const stream = await openai.completions.create(completionParams, {
        signal: abortController.signal,
      });

      // Stream state
      let accumulated = "";
      let sentIndex = 0;
      const joinState: JoinState = {
        hasEmittedAny: false,
        endedWithWhitespace: false,
        endedWithNewline: false,
      };

      console.log("[OpenRouter] Stream started", { attempt: attempt + 1 });

      // Whether we've emitted at least one non-whitespace character
      let hasEmittedNonWhitespace = false;

      // Track if we've seen any non-whitespace in word mode
      let wordModeBuffer = "";

      for await (const chunk of stream) {
        // Log usage if present (often in final chunk)
        const usage = (chunk as { usage?: unknown }).usage;
        if (usage !== undefined) {
          console.log("[OpenRouter] Usage:", usage);
        }

        const delta = chunk.choices?.[0]?.text ?? "";
        if (delta) {
          // Debug logging for content flow
          // console.log(`[OpenRouter] Chunk: ${JSON.stringify(delta)}`);
        }

        if (!delta) continue;

        accumulated += delta;
        const prepared = prepareGeneratedText(prompt, accumulated);

        // Special handling for word mode: emit complete tokens
        if (mode === "word") {
          wordModeBuffer = prepared.slice(sentIndex);

          // If this token contains non-whitespace, we've found our word
          if (NON_WHITESPACE_RE.test(wordModeBuffer)) {
            // Emit the accumulated buffer
            // In word mode, preserve whitespace as generated (it acts as the separator)
            const toSend = wordModeBuffer;

            if (toSend) {
              res.write(`data: ${JSON.stringify({ content: toSend })}\n\n`);
              joinState.hasEmittedAny = true;
              joinState.endedWithNewline = ENDING_NEWLINE_RE.test(toSend);
              joinState.endedWithWhitespace = ENDING_WHITESPACE_RE.test(toSend);

              // Abort and end - we've emitted one word
              console.log("[OpenRouter] Word mode satisfied, aborting");
              abortController.abort();
              endEarly();
              return;
            }
          }
          continue;
        }

        // Check for boundary (non-word modes)
        if (boundaryRegex) {
          const cutoff = findBoundaryCutoff(
            prepared,
            sentIndex,
            boundaryRegex,
          );
          if (cutoff !== null) {
            console.log("[OpenRouter] Hit boundary match at index:", cutoff);

            let toSend = prepared.slice(sentIndex, cutoff);

            // Normalize join across seam
            toSend = normalizeJoin(joinState, toSend);

            // Only prevent empty result; do not strip valid whitespace if we've already emitted words
            const containsNonWs = NON_WHITESPACE_RE.test(toSend);
            if (toSend && (containsNonWs || hasEmittedNonWhitespace)) {
              res.write(`data: ${JSON.stringify({ content: toSend })}\n\n`);
              joinState.hasEmittedAny = true;
              if (NON_WHITESPACE_RE.test(toSend)) hasEmittedNonWhitespace = true;
              joinState.endedWithNewline = ENDING_NEWLINE_RE.test(toSend);
              joinState.endedWithWhitespace = ENDING_WHITESPACE_RE.test(toSend);
            }

            // Abort upstream and end stream
            console.log("[OpenRouter] Aborting stream due to boundary");
            abortController.abort();
            endEarly();
            return;
          }
        }

        // No boundary yet; stream what we have since last send
        let segment = prepared.slice(sentIndex);
        if (segment) {
          // Avoid emitting purely leading whitespace when nothing has been emitted at all and no non-whitespace yet
          if (!joinState.hasEmittedAny && !NON_WHITESPACE_RE.test(segment)) {
            // Buffer until we see content; don't emit whitespace-only lead
            continue;
          }

          // Normalize join to avoid duplicated spaces/newlines across chunk seams
          segment = normalizeJoin(joinState, segment);

          // Emit
          if (segment) {
            res.write(`data: ${JSON.stringify({ content: segment })}\n\n`);
            joinState.hasEmittedAny = true;
            if (NON_WHITESPACE_RE.test(segment)) hasEmittedNonWhitespace = true;
            joinState.endedWithNewline = ENDING_NEWLINE_RE.test(segment);
            joinState.endedWithWhitespace = ENDING_WHITESPACE_RE.test(segment);
            sentIndex = prepared.length;
          }
        }
      }


      // Upstream finished without hitting our boundary; flush remaining buffer (if any) then close out
      if (!ended) {
        console.log("[OpenRouter] Stream finished naturally");
        const remaining = prepareGeneratedText(prompt, accumulated).slice(sentIndex);
        if (remaining) {
          const segment = normalizeJoin(joinState, remaining);
          if (segment) {
            res.write(`data: ${JSON.stringify({ content: segment })}\n\n`);
          }
        }
        res.write("data: [DONE]\n\n");
        res.end();
        ended = true;
      }
    }
  } catch (error: unknown) {
    console.error("Generation error:", error);

    const errorMessage =
      error instanceof Error
        ? error.message
        : "An error occurred during text generation";

    // If headers haven't been sent, send error response
    if (!res.headersSent) {
      res.status(500).json({ error: errorMessage });
    } else {
      // If streaming has started, send error in stream format
      res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
      res.end();
    }
  }
}
