export interface ShelfStory {
  id: string;
  title: string;
  isCurrent: boolean;
}

interface StoryShelfProps {
  stories: ShelfStory[];
  /** Cursor index into `stories`. */
  selected: number;
  onOpen: (index: number) => void;
}

/**
 * The "shelf": every story shown as a sibling under one root bin. You reach it
 * by rising (Up) out of the top of a story; you drop back into one with A/↵ and
 * act on one with ⌫ (the shared ActionMenu). It is a PROJECTION over the
 * separate looms — no data is moved, nothing stored changes. Same list styling
 * as the stories drawer so it sits on the single-size grid, and every row is a
 * real <button> so the shelf is touch-tappable, not just d-pad reachable.
 */
export const StoryShelf = ({ stories, selected, onOpen }: StoryShelfProps) => (
  <div className="menu-content story-shelf" role="menu" aria-label="Your looms">
    {stories.map((story, index) => (
      <button
        key={story.id}
        type="button"
        role="menuitem"
        className={[
          "menu-item",
          "story-menu-item",
          index === selected ? "selected" : "",
          story.isCurrent ? "story-menu-item--current" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-current={index === selected}
        onClick={() => onOpen(index)}
      >
        <span className="menu-item-label">{story.title}</span>
      </button>
    ))}
  </div>
);
