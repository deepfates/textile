import { useState } from "react";
import { useTextGeneration } from "./useTextGeneration";
import { splitTextToDraft } from "../utils/textSplitter";
import { joinSegments } from "../utils/join";
import type { StoryNode } from "../types";
import type { StoryDraft } from "../lync/storyTypes";
import type { ModelId } from "../../../shared/models";
import type { LengthMode } from "../../../shared/lengthPresets";

interface GenerationParams {
  model: ModelId;
  temperature: number;
  lengthMode: LengthMode;
  textSplitting: boolean;
}

interface EmptyGenerationNotice {
  message: string;
}

export const EMPTY_GENERATION_NOTICE_MESSAGE =
  "Model returned no text.";

export const getEmptyGenerationNotice = (
  generatedText: string,
): EmptyGenerationNotice | null =>
  generatedText.length === 0
    ? { message: EMPTY_GENERATION_NOTICE_MESSAGE }
    : null;

export const createPrompt = (path: StoryNode[], depth: number) => {
  // Validate that depth is within bounds
  if (path.length === 0) {
    throw new Error(`Invalid depth: ${depth}. Path is empty (length 0).`);
  }
  if (!Number.isInteger(depth) || depth < 0 || depth >= path.length) {
    const maxIndex = path.length - 1;
    throw new Error(
      `Invalid depth: ${depth}. Must be an integer between 0 and ${maxIndex}.`,
    );
  }

  // Get the story context from the current path
  const context = joinSegments(
    path.slice(0, depth + 1).map((node) => node.text),
  );

  return context;
};

export function useStoryGeneration() {
  const { generate, error } = useTextGeneration();
  const [generatedText, setGeneratedText] = useState("");
  const [emptyGeneration, setEmptyGeneration] =
    useState<EmptyGenerationNotice | null>(null);

  const flattenDraftText = (draft: StoryDraft): string => {
    const segments: string[] = [];
    let current: StoryDraft | undefined = draft;
    const visited = new Set<StoryDraft>();

    while (current && !visited.has(current)) {
      visited.add(current);
      segments.push(current.text);
      if (current.continuations?.length === 1) {
        current = current.continuations[0];
      } else {
        break;
      }
    }

    return joinSegments(segments);
  };

  const generateContinuation = async (
    path: StoryNode[],
    depth: number,
    params: GenerationParams,
  ): Promise<StoryDraft> => {
    setGeneratedText("");
    setEmptyGeneration(null);
    let fullText = "";

    const prompt = createPrompt(path, depth);

    await generate(
      prompt,
      {
        model: params.model,
        temperature: params.temperature,
        lengthMode: params.lengthMode,
      },
      (token) => {
        fullText += token;
        setGeneratedText(fullText);
      },
      () => {
        setGeneratedText(fullText);
      },
    );

    const emptyNotice = getEmptyGenerationNotice(fullText);
    if (emptyNotice) {
      setEmptyGeneration(emptyNotice);
      throw new Error("Generation returned no content");
    }

    // Conditionally split the generated text based on settings
    if (params.textSplitting) {
      const draft = splitTextToDraft(fullText);

      // If splitting succeeded, return the chain
      if (draft) {
        return draft;
      }
    }

    // Fallback to single draft (if splitting disabled or failed)
    return {
      text: fullText,
      continuations: [],
    };
  };

  const chooseContinuation = async (
    path: StoryNode[],
    candidates: StoryDraft[],
    params: GenerationParams,
  ): Promise<number | null> => {
    if (!candidates.length) {
      return null;
    }

    const context = joinSegments(path.map((node) => node.text));
    const optionTexts = candidates.map(
      (candidate) => flattenDraftText(candidate).trim() || "(empty)",
    );

    try {
      console.log(
        `[AutoMode] Requesting judge from ${params.model} for ${candidates.length} candidates`,
      );

      const response = await fetch("/api/judge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          context: context.trim(),
          options: optionTexts,
          model: params.model,
          temperature: Math.max(0.1, Math.min(params.temperature, 0.8)),
        }),
      });

      if (!response.ok) {
        console.error("[AutoMode] Judge request failed", await response.text());
        return null;
      }

      const payload = (await response.json()) as {
        choice: number | null;
        raw?: string;
      };
      console.log("[AutoMode] Judge response:", payload);

      if (typeof payload.choice === "number") {
        return payload.choice;
      }
    } catch (err) {
      console.error("[AutoMode] Judge error", err);
    }

    return null;
  };

  return {
    generateContinuation,
    chooseContinuation,
    generatedText,
    emptyGeneration,
    error,
  };
}
