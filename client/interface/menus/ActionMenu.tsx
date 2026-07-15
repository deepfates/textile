/**
 * A generic "second-layer" action menu: the d-pad's first layer navigates
 * CONTENT (the tree); this second layer navigates the ACTIONS available on
 * whatever is currently focused. One door, reused for every object type — the
 * caller computes the action list, so a turn offers keep/note/edit, a story
 * later offers open/share/export, etc. Same component, same gestures.
 *
 * Reuses the shared menu-item styling so it sits on the single-size grid, and
 * every row is a real <button> so the whole menu is touch-tappable, not just
 * d-pad reachable.
 */
export interface MenuAction {
  id: string;
  label: string;
}

interface ActionMenuProps {
  actions: MenuAction[];
  /** Cursor index into `actions`. */
  selected: number;
  onSelect: (index: number) => void;
  ariaLabel?: string;
}

export const ActionMenu = ({
  actions,
  selected,
  onSelect,
  ariaLabel = "Actions",
}: ActionMenuProps) => (
  <div className="menu-content" role="menu" aria-label={ariaLabel}>
    {actions.map((action, index) => (
      <button
        key={action.id}
        type="button"
        role="menuitem"
        className={`menu-item ${index === selected ? "selected" : ""}`}
        aria-current={index === selected}
        onClick={() => onSelect(index)}
      >
        <span className="menu-item-label">{action.label}</span>
      </button>
    ))}
  </div>
);
