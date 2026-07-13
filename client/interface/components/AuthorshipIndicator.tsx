import type { StoryNode } from "../types";
import type { AuthorshipDisplay } from "../lync/storyRuntime";
import { originDetail, originToken } from "../utils/originDisplay";

interface AuthorshipIndicatorProps {
  /** The frontier (current) turn whose authorship the chip describes. */
  node: StoryNode | undefined;
  /** The SELECT:CONFIG loudness dial; "off" renders nothing. */
  mode: AuthorshipDisplay;
}

/**
 * Quiet authorship chip for the CURRENT (frontier) turn, sitting in the bottom
 * status strip beside the sync indicator. Copies the dee-n19h register: a
 * leading dot glyph, theme-var color only, a short token (dot + "model" etc.),
 * with the full actor · via · origin/model line reserved for title/aria. On
 * mobile the word hides and only the dot glyph remains. Shown in ambient/detail;
 * "off" renders nothing (the not-seeing case is first-class).
 */
export function AuthorshipIndicator({ node, mode }: AuthorshipIndicatorProps) {
  if (mode === "off" || !node) return null;
  const detail = originDetail(node);
  return (
    <span
      className={`story-authorship-status story-authorship-status--${node.origin}`}
      aria-label={detail}
      title={detail}
    >
      <span className="story-authorship-status__word">{originToken(node)}</span>
    </span>
  );
}
