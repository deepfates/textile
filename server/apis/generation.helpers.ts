import {
  LEADING_NEWLINES_RE,
  LEADING_SPACES_TABS_RE,
  ENDING_NEWLINE_RE,
  ENDING_WHITESPACE_RE,
  NON_WHITESPACE_RE,
} from "../../shared/textSeams";
import type { LengthMode } from "../../shared/lengthPresets";

/**
 * Testable helpers for generation semantics.
 *
 * These were extracted from the generation API to avoid exporting a __test bag.
 * Import these directly in tests instead of reaching into API internals.
 */

/**
 * Return a boundary-matching regex for the given semantic length mode.
 * - Word mode has no regex (handled token-aware in stream loop), returns null.
 * - Other modes include the delimiter in the match so it is preserved in output.
 */
export function getBoundaryRegex(mode: LengthMode): RegExp | null {
  switch (mode) {
    case "word":
      // Word mode uses token-aware logic in the stream loop; no regex boundary.
      return null;
    case "sentence":
      // ., ?, ! possibly followed by closing quotes/brackets; include them, not trailing space
      return /[.?!](?:['""'»)\]}]+)?(?=\s|$)/;
    case "paragraph":
      // Blank line (including optional spaces) OR Markdown horizontal rule
      return /\r?\n[ \t]*\r?\n|(?:^|\r?\n)[ \t]{0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*(?:\r?\n|$)/;
    case "page":
      // Three or more blank lines (page break) OR horizontal rule
      return /\r?\n(?:[ \t]*\r?\n){2,}|(?:^|\r?\n)[ \t]{0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*(?:\r?\n|$)/;
    default:
      return null;
  }
}

const OVERLAP = 32;

/**
 * Ensure global search; cache global RegExp instances to avoid recompilation.
 */
const getGlobalRegex = (() => {
  const cache = new WeakMap<RegExp, RegExp>();
  return (rx: RegExp): RegExp => {
    if (rx.flags.includes("g")) return rx;
    const cached = cache.get(rx);
    if (cached) return cached;
    const globalRx = new RegExp(rx.source, rx.flags + "g");
    cache.set(rx, globalRx);
    return globalRx;
  };
})();

/**
 * Find the first boundary whose end is strictly beyond sentIndex.
 * Uses a small overlap window to handle boundary matches that straddle chunk seams.
 */
export function findBoundaryCutoff(
  accumulated: string,
  sentIndex: number,
  rx: RegExp,
): number | null {
  const start = Math.max(0, sentIndex - OVERLAP);
  const search = accumulated.slice(start);

  // Ensure global search (use cached global RegExp)
  const globalRx = getGlobalRegex(rx);

  let m: RegExpExecArray | null;
  while ((m = globalRx.exec(search)) !== null) {
    const end = m.index + m[0].length;
    if (start + end > sentIndex) {
      return start + end;
    }
  }
  return null;
}

export type JoinState = {
  hasEmittedAny: boolean;
  endedWithWhitespace: boolean;
  endedWithNewline: boolean;
};

/**
 * Normalize the join between the previously emitted tail and the new segment.
 * Goals:
 * - Preserve necessary spaces/newlines.
 * - Avoid duplicate space/newline when split across chunk seams.
 * - Never remove the only separator between two words.
 */
export function normalizeJoin(prev: JoinState, segment: string): string {
  if (segment == null) return "";
  if (segment.length === 0) return segment;

  // If previous emission ended with CRLF or LF and the next segment starts with one,
  // drop duplicated leading newlines in the new segment (preserve only the previous one).
  if (prev.endedWithNewline) {
    // Remove one or more leading CRLF/LF
    segment = segment.replace(LEADING_NEWLINES_RE, "");
  }

  // If previous ended with whitespace (space or tab) and next starts with spaces/tabs,
  // drop the leading spaces/tabs in the new segment (newline is stronger and kept).
  if (prev.endedWithWhitespace && !prev.endedWithNewline) {
    segment = segment.replace(LEADING_SPACES_TABS_RE, "");
  }

  // Do not invent separators; generation must produce its own.
  return segment;
}

/**
 * Convenience to update JoinState trackers after emitting a segment.
 * Not used by the API directly, but handy for tests.
 */
export function updateJoinState(state: JoinState, emitted: string): JoinState {
  return {
    hasEmittedAny: state.hasEmittedAny || emitted.length > 0,
    endedWithNewline: ENDING_NEWLINE_RE.test(emitted),
    endedWithWhitespace: ENDING_WHITESPACE_RE.test(emitted),
  };
}

const CHAT_PREAMBLE_PREFIXES = [
  "of course. here is the story continued",
  "of course. here is the continuation",
  "of course, here is the story continued",
  "sure. here is the story continued",
  "certainly. here is the story continued",
  "absolutely. here is the story continued",
  "here is the story continued",
  "here's the story continued",
  "continuing the story",
];

export function shouldDeferPossiblePreamble(raw: string): boolean {
  const trimmed = raw.trimStart().toLowerCase();
  if (!trimmed || trimmed.length > 96) return false;
  return CHAT_PREAMBLE_PREFIXES.some((prefix) => prefix.startsWith(trimmed));
}

const CHAT_PREAMBLE_DETECT_RE =
  /^(?:\uFEFF)?[ \t\r\n]*(?:(?:of course|sure|certainly|absolutely)[.,!]?\s+)?(?:here(?:'s| is)\s+)?(?:the\s+)?(?:story\s+)?(?:continued|continuation|next\s+part|next\s+scene)(?:\s+of\s+the\s+story)?\s*[:.!-]\s*$/i;

const CONTINUING_STORY_DETECT_RE =
  /^(?:\uFEFF)?[ \t\r\n]*continuing\s+(?:the\s+)?story\s*[:.!-]\s*$/i;

export function startsWithChatPreamble(raw: string): boolean {
  if (!raw || raw.length > 160) return false;
  return (
    CHAT_PREAMBLE_DETECT_RE.test(raw) ||
    CONTINUING_STORY_DETECT_RE.test(raw)
  );
}

export function stripMarkdownEmphasis(text: string): string {
  return text
    .replace(/\*\*([^*\n][\s\S]*?[^*\n])\*\*/g, "$1")
    .replace(/__([^_\n][\s\S]*?[^_\n])__/g, "$1")
    .replace(/(^|[\s([{])\*([^*\n][^*\n]*?[^*\n])\*(?=$|[\s.,;:!?)}\]])/g, "$1$2")
    .replace(/(^|[\s([{])_([^_\n][^_\n]*?[^_\n])_(?=$|[\s.,;:!?)}\]])/g, "$1$2");
}

export function prepareGeneratedText(prompt: string, raw: string): string {
  let output = stripMarkdownEmphasis(raw);
  if (!output) return output;

  const promptEndsTight = NON_WHITESPACE_RE.test(prompt.at(-1) ?? "");
  const outputStartsTight = /^[\p{L}\p{N}"'“‘(]/u.test(output);
  if (promptEndsTight && outputStartsTight) {
    output = ` ${output}`;
  }

  return output;
}
