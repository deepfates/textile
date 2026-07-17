import { StoryMinimap } from "./StoryMinimap";
import type { StoryNode } from "../types";

// Stable empty refs so the previewed minimap doesn't re-render on every dial.
const EMPTY_SET: Set<string> = new Set();
const EMPTY_GENERATING: Record<
  string,
  { depth: number; index: number | null }
> = {};

// Fixed per-loom pitch so the dial's centering math is exact: cell `sel` centres
// on the strip's midline (`left:50%` + translateX below), and the row slides
// beneath it. A pitch this small shows ~10 siblings on a phone — you can count
// your looms — where the old 220px label cells showed barely one.
export const FOREST_PITCH = 34;
const PILL_WIDTH = 14; // == the map's NODE_WIDTH, so a root reads as a map node
const PILL_MIN_H = 16;
const PILL_MAX_H = 46;

// A loom's pill height encodes its size (turn count) — an absolute mapping, so a
// loom's silhouette is stable and doesn't reshuffle when you add another loom.
// The collapsed row becomes a recognizable skyline, not uniform tape.
function countTurns(node: StoryNode): number {
  let n = 1;
  for (const child of node.continuations ?? []) n += countTurns(child);
  return n;
}
function pillHeight(turns: number): number {
  return Math.min(PILL_MAX_H, PILL_MIN_H + Math.sqrt(Math.max(0, turns - 1)) * 5.5);
}

export interface ForestStory {
  id: string;
  title: string;
  tree: { root: StoryNode };
  isCurrent: boolean;
}

interface StoryForestProps {
  stories: ForestStory[];
  /** Cursor index into `stories` — the root locked at the center of the dial. */
  selected: number;
  /** Dial to a different root (tap a neighbour). */
  onFocus: (index: number) => void;
  /** Descend into the selected root's tree (tap the centered root). */
  onDescend: (index: number) => void;
}

/**
 * The forest floor: every loom is a ROOT — drawn as a node in the map's own
 * idiom (a pill whose height is the loom's size) — in a left-right row of
 * siblings you can count. You DIAL through them: the selected root stays pinned
 * at a fixed centre and the row slides under it (iOS-picker style), so the
 * selected loom's SILHOUETTE always blooms in the same place. Only the selected
 * root blooms its tree (via a fitted StoryMinimap); the others stay collapsed as
 * bare pills, so nothing re-packs as you dial. It is a PROJECTION over the
 * separate looms — the map's top zoom level, not a new surface. No titles on the
 * floor: you recognize a loom by its shape + the minibuffer, not by reading.
 */
export const StoryForest = ({
  stories,
  selected,
  onFocus,
  onDescend,
}: StoryForestProps) => {
  const clamped = Math.min(
    Math.max(0, selected),
    Math.max(0, stories.length - 1),
  );
  const sel = stories[clamped];
  return (
    <div className="story-forest view-fade" role="group" aria-label="Your looms">
      <div className="story-forest-dial">
        {/* The row of root-pills. Constant geometry — dialing only changes the
            group's translateX, so neighbours never move relative to each other
            and no layout recomputes; the bloom below swaps in place. */}
        <div
          className="story-forest-row"
          style={{ transform: `translateX(${-(clamped + 0.5) * FOREST_PITCH}px)` }}
        >
          {stories.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={[
                "story-forest-cell",
                s.isCurrent ? "current" : "",
                i === clamped ? "selected" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ width: FOREST_PITCH }}
              aria-current={i === clamped}
              aria-label={s.title}
              onClick={() => (i === clamped ? onDescend(i) : onFocus(i))}
            >
              <span
                className="story-forest-pill"
                style={{ height: pillHeight(countTurns(s.tree.root)) }}
              />
            </button>
          ))}
        </div>
      </div>
      <div className="story-forest-bloom">
        {sel ? (
          <StoryMinimap
            key={sel.id}
            tree={sel.tree}
            fit="floor"
            currentDepth={0}
            selectedOptions={[]}
            currentPath={[sel.tree.root]}
            inFlight={EMPTY_SET}
            generatingInfo={EMPTY_GENERATING}
            onSelectNode={() => onDescend(clamped)}
            isVisible
            lastMapNodeId={null}
            currentNodeId={sel.tree.root.id}
          />
        ) : null}
      </div>
    </div>
  );
};
