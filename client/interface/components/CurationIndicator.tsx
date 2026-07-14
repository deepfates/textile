import type { StoryNode } from "../types";

interface CurationIndicatorProps {
  /** The turn the cursor is ON — the one KEEP/ANNOTATE act on. */
  node: StoryNode | undefined;
}

/**
 * Quiet curation state for the FOCUSED turn, sitting in the bottom status strip
 * beside the authorship chip — the line that already narrates the current node.
 * KEEP and ANNOTATE are cursor gestures, so their state is a property of FOCUS,
 * never a badge stuck on every turn in the reading column. Renders nothing when
 * the focused turn is neither kept nor annotated (no persistent chrome). Theme
 * muted vars only — never the reserved focus accent, which belongs to the cursor.
 */
export function CurationIndicator({ node }: CurationIndicatorProps) {
  if (!node) return null;
  const kept = node.kept === true;
  const notes = node.annotations ?? [];
  if (!kept && notes.length === 0) return null;

  const noteText = notes.map((note) => note.text).join(" · ");
  const detail = [
    kept ? "kept" : null,
    notes.length
      ? `${notes.length} note${notes.length === 1 ? "" : "s"}: ${noteText}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <span className="story-curation-status" aria-label={detail} title={detail}>
      {kept ? (
        <span className="story-curation-status__kept">kept</span>
      ) : null}
      {notes.length ? (
        <span className="story-curation-status__note">{noteText}</span>
      ) : null}
    </span>
  );
}
