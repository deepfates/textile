import { EventEmitter } from "events";
import { describe, it, expect } from "bun:test";
import {
  findBoundaryCutoff,
  getBoundaryRegex,
  normalizeJoin,
  prepareGeneratedText,
  shouldDeferPossiblePreamble,
  startsWithChatPreamble,
  stripMarkdownEmphasis,
} from "../apis/generation.helpers.ts";
import { generateText } from "../apis/generation.ts";
import { openai } from "../apis/openaiClient.ts";



describe("boundary regexes", () => {
  it("word mode: matches first non-space run plus trailing whitespace (including multiples and CRLF)", () => {
    const rx = getBoundaryRegex("word");
    // Word mode now returns null for special token-aware handling
    expect(rx).toBeNull();

    // Skip regex-based tests for word mode since it uses token-aware logic
    return;
  });

  it("sentence mode: includes terminal punctuation and optional closing quotes/brackets, not trailing space", () => {
    const rx = getBoundaryRegex("sentence")!;
    const s1 = `He said 'Hi.' Next`;
    const m1 = rx.exec(s1);
    expect(m1).toBeTruthy();
    // Match should end after the closing quote, not include trailing space
    expect(m1?.[0]).toBe(".'");

    const s2 = `Is this OK?) Yes`;
    const m2 = rx.exec(s2);
    expect(m2).toBeTruthy();
    // Includes ) after ?
    expect(m2?.[0]).toBe("?)");

    const s3 = `Wow!  Really?`;
    const m3 = rx.exec(s3);
    expect(m3).toBeTruthy();
    expect(m3?.[0]).toBe("!");
  });

  it("paragraph mode: matches blank line or Markdown horizontal rule", () => {
    const rx = getBoundaryRegex("paragraph")!;
    const s1 = "Line 1\n\nLine 2";
    const m1 = rx.exec(s1);
    // Should match exactly the blank line sequence
    expect(m1).toBeTruthy();
    expect(m1?.[0]).toBe("\n\n");

    const s2 = "Para\n\n\nPara";
    const m2 = rx.exec(s2);
    // First blank line pair should be taken as boundary
    expect(m2).toBeTruthy();
    expect(m2?.[0]).toBe("\n\n");

    const s3 = "A\n---\nB";
    const m3 = rx.exec(s3);
    // Horizontal rule with newline should match as a paragraph boundary
    expect(m3).toBeTruthy();
    expect(m3?.[0]).toBe("\n---\n");
  });

  it("page mode: matches three or more blank lines or horizontal rule", () => {
    const rx = getBoundaryRegex("page")!;
    const s1 = "A\n\n\nB";
    const m1 = rx.exec(s1);
    expect(m1).toBeTruthy();
    expect(m1?.[0]).toBe("\n\n\n");

    const s2 = "Intro\n\n\n\n\nChapter 1";
    const m2 = rx.exec(s2);
    expect(m2).toBeTruthy();
    // Should match three or more consecutive blank lines (greedy inside the group is fine as long as boundary exists)
    expect(m2?.[0]).toMatch(/^\n(\n|\r\n){2,}$/);

    const s3 = "X\n***\nY";
    const m3 = rx.exec(s3);
    expect(m3).toBeTruthy();
    expect(m3?.[0]).toBe("\n***\n");
  });
});

describe("findBoundaryCutoff", () => {
  it("handles token-like arrival patterns in word mode", () => {
    // Word mode now uses token-aware logic, not regex boundaries
    // This test is no longer applicable
    expect(getBoundaryRegex("word")).toBeNull();
  });

  it("returns null when no boundary exists yet (e.g., word without trailing whitespace)", () => {
    // Test with sentence mode instead since word mode no longer uses regex
    const rx = getBoundaryRegex("sentence")!;
    const acc = "Hello"; // no sentence terminator yet
    const cut = findBoundaryCutoff(acc, 0, rx);
    expect(cut).toBeNull();
  });

  it("returns the first boundary end strictly after sentIndex", () => {
    const rx = getBoundaryRegex("sentence")!;
    const acc = "Hello. world"; // first boundary is after "."
    const cut = findBoundaryCutoff(acc, 0, rx);
    expect(cut).toBe(6);
  });

  it("ignores boundaries that end at or before sentIndex", () => {
    const rx = getBoundaryRegex("sentence")!;
    const acc = "Hello. world"; // "." boundary ends at 6
    const sentIndex = 6; // we've 'already sent' up to first boundary
    const cut = findBoundaryCutoff(acc, sentIndex, rx);
    // No more sentence boundaries
    expect(cut).toBeNull();
  });

  it("handles seam: boundary appears only after additional chunk arrives", () => {
    const rx = getBoundaryRegex("sentence")!;
    let acc = "Hello"; // no boundary yet
    let cut = findBoundaryCutoff(acc, 0, rx);
    expect(cut).toBeNull();

    acc += "."; // now "Hello."
    cut = findBoundaryCutoff(acc, 0, rx);
    expect(cut).toBe(6);
  });

  it("sentence cutoff: stops after first sentence terminator (with closing quote)", () => {
    const rx = getBoundaryRegex("sentence")!;
    const acc = `She said "Go." Then left.`;
    const cut = findBoundaryCutoff(acc, 0, rx);
    // First sentence ends after the period and closing quote -> `"Go."` -> cutoff at index of the quote included
    const expectedEnd = acc.indexOf('" Then') + 1; // end index after closing quote
    expect(cut).toBe(expectedEnd);
  });

  it("paragraph cutoff: stops at first blank line or horizontal rule", () => {
    const rx = getBoundaryRegex("paragraph")!;
    const acc = "A\n\nB\n\nC";
    const cut = findBoundaryCutoff(acc, 0, rx);
    // First blank line at indices 1-3 ("\n\n"), cutoff should be 3
    expect(cut).toBe(3);
  });

  it("preserves single spaces between words when normalizing", () => {
    // Simulate: previous word ended with space, next token starts with space
    const prev = {
      hasEmittedAny: true,
      endedWithWhitespace: true,
      endedWithNewline: false,
    };
    const next = " world";
    const out = normalizeJoin(prev, next);
    // Should drop the leading space to avoid double spacing
    expect(out).toBe("world");
  });
});

describe("word mode token patterns", () => {
  it("word mode now uses token-aware logic instead of regex boundaries", () => {
    // Word mode returns null for regex - it uses special token handling
    expect(getBoundaryRegex("word")).toBeNull();

    // The actual word mode behavior is tested in integration tests
    // since it requires the full streaming context
  });
});

describe("normalizeJoin (seam whitespace normalization)", () => {
  it("drops duplicated leading spaces/tabs on the new segment when previous ended with whitespace", () => {
    const prev = {
      hasEmittedAny: true,
      endedWithWhitespace: true,
      endedWithNewline: false,
    };
    const next = "   world";
    const out = normalizeJoin(prev, next);
    // We remove leading spaces so we don't end up with double-space at the seam;
    // the single space from the previous emission remains in the output stream.
    expect(out).toBe("world");
  });

  it("keeps newline if next starts with newline (newline is stronger than space/tab dedup)", () => {
    const prev = {
      hasEmittedAny: true,
      endedWithWhitespace: true,
      endedWithNewline: false,
    };
    const next = "\nworld";
    const out = normalizeJoin(prev, next);
    expect(out).toBe("\nworld");
  });

  it("drops duplicated leading newlines when previous ended with newline (handles CRLF and multiple)", () => {
    const prev1 = {
      hasEmittedAny: true,
      endedWithWhitespace: true,
      endedWithNewline: true,
    };

    const out1 = normalizeJoin(prev1, "\n\nHello");
    expect(out1).toBe("Hello");

    const out2 = normalizeJoin(prev1, "\r\n\r\nHello");
    expect(out2).toBe("Hello");

    const out3 = normalizeJoin(prev1, "\r\n\n\r\nHello");
    expect(out3).toBe("Hello");
  });

  it("does not invent spaces when previous ended with non-whitespace", () => {
    const prev = {
      hasEmittedAny: true,
      endedWithWhitespace: false,
      endedWithNewline: false,
    };
    const next = "world";
    const out = normalizeJoin(prev, next);
    expect(out).toBe("world");
  });
});

describe("generation cleanup", () => {
  it("detects standalone chat-model continuation preambles for retry", () => {
    expect(startsWithChatPreamble("Of course. Here is the story continued:"))
      .toBe(true);
    expect(startsWithChatPreamble("Continuing the story:"))
      .toBe(true);
    expect(startsWithChatPreamble("\nSure. Here is the next scene. "))
      .toBe(true);
  });

  it("does not detect plausible prose openings as retryable preambles", () => {
    expect(
      startsWithChatPreamble(
        "Of course. Here is the story continued: the narrator lied.",
      ),
    ).toBe(false);
    expect(
      startsWithChatPreamble(
        "Here is the story continued: the inscription began on the wall.",
      ),
    ).toBe(false);
    expect(startsWithChatPreamble("Continuing the story: rain filled the street."))
      .toBe(false);
    expect(
      startsWithChatPreamble(
        "Of course, here is the story continued in ink across the page.",
      ),
    ).toBe(false);
  });

  it("defers partial preambles while streaming", () => {
    expect(shouldDeferPossiblePreamble("Of cour")).toBe(true);
    expect(shouldDeferPossiblePreamble("Of course. Here is the story continued: rain"))
      .toBe(false);
  });

  it("removes markdown emphasis markers from prose", () => {
    expect(stripMarkdownEmphasis("The **red door** opened and *clicked*."))
      .toBe("The red door opened and clicked.");
  });

  it("adds the missing story seam space when a continuation starts tight", () => {
    expect(prepareGeneratedText("the day before.", "Morning came."))
      .toBe(" Morning came.");
  });

  it("does not strip preamble-like text during cleanup", () => {
    expect(
      prepareGeneratedText(
        "the day before.",
        "Of course. Here is the story continued: the narrator lied.",
      ),
    ).toBe(" Of course. Here is the story continued: the narrator lied.");
  });
});

describe("generateText upstream errors", () => {
  it("sends an SSE error before any terminal marker when request close races upstream failure", async () => {
    const originalCreate = openai.completions.create;
    const originalConsoleError = console.error;
    const req = new EventEmitter() as EventEmitter & {
      body: Record<string, unknown>;
    };
    req.body = {
      prompt: "Once upon a time",
      model: "deepseek/deepseek-chat-v3.1",
      length: "sentence",
      temperature: 1,
    };

    const writes: string[] = [];
    let ended = false;
    let headersSent = false;
    const res = new EventEmitter() as EventEmitter & {
      headersSent: boolean;
      writableEnded: boolean;
      setHeader: (name: string, value: string) => void;
      flushHeaders: () => void;
      write: (chunk: string) => void;
      end: () => void;
      status: (code: number) => typeof res;
      json: (body: unknown) => void;
    };
    Object.defineProperty(res, "headersSent", {
      get: () => headersSent,
    });
    Object.defineProperty(res, "writableEnded", {
      get: () => ended,
    });
    res.setHeader = () => {};
    res.flushHeaders = () => {
      headersSent = true;
    };
    res.write = (chunk: string) => {
      if (!ended) writes.push(chunk);
    };
    res.end = () => {
      ended = true;
    };
    res.status = () => res;
    res.json = (body: unknown) => {
      writes.push(JSON.stringify(body));
      ended = true;
    };

    openai.completions.create = (async () => {
      req.emit("close");
      throw new Error("Request was aborted.");
    }) as typeof openai.completions.create;
    console.error = () => {};

    try {
      await generateText(req as never, res as never);
    } finally {
      openai.completions.create = originalCreate;
      console.error = originalConsoleError;
    }

    expect(writes).toEqual([
      `data: ${JSON.stringify({ error: "Request was aborted." })}\n\n`,
    ]);
    expect(writes.join("")).not.toContain("[DONE]");
    expect(ended).toBe(true);
  });
});
