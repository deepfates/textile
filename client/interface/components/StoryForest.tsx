import { StoryMinimap } from "./StoryMinimap";
import type { StoryNode } from "../types";

// Stable empty refs so the previewed minimap doesn't re-render on every dial.
const EMPTY_SET: Set<string> = new Set();
const EMPTY_GENERATING: Record<
  string,
  { depth: number; index: number | null }
> = {};

// Fixed cell width so the dial's centering math is exact: the selected root
// always lands in the same spot, and the row slides beneath it.
export const FOREST_CELL = 220;

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
 * The forest floor: every story is a ROOT sitting on an invisible baseline, in a
 * left-right row of siblings. Only the selected root blooms its tree below it
 * (the others stay bare), so nothing re-packs as you dial — and you find the one
 * you want by its SILHOUETTE plus the minibuffer, not by reading titles. The
 * whole thing is a PROJECTION over the separate looms; it's the map's top zoom
 * level, not a new surface.
 *
 * The dial is iOS-picker style: the selected root is pinned to the center and
 * the row translates under it, so the fingerprint always shows in the same
 * place. That fixed focal point is the point — stable attention, moving world.
 */
export const StoryForest = ({
  stories,
  selected,
  onFocus,
  onDescend,
}: StoryForestProps) => {
  const clamped = Math.min(Math.max(0, selected), Math.max(0, stories.length - 1));
  const sel = stories[clamped];
  return (
    <div className="story-forest view-fade" role="group" aria-label="Your looms">
      <div className="story-forest-floor">
        <div
          className="story-forest-row"
          style={{ transform: `translateX(${-(clamped + 0.5) * FOREST_CELL}px)` }}
        >
          {stories.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={[
                "story-forest-root",
                i === clamped ? "selected" : "",
                s.isCurrent ? "current" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ width: FOREST_CELL }}
              aria-current={i === clamped}
              onClick={() => (i === clamped ? onDescend(i) : onFocus(i))}
            >
              <span className="story-forest-root-label">{s.title}</span>
              {s.isCurrent ? (
                <span className="story-forest-root-tag">current</span>
              ) : null}
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
