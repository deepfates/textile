import type { StoryNode } from "../types";

export type TurnActionId = "keep" | "note" | "edit";

interface TurnActionsMenuProps {
  node: StoryNode;
  selected: number;
  onSelect: (index: number) => void;
}

/**
 * The per-turn action menu (screen === "turn"), opened by B (⌫) in the reading
 * view. Three verbs on the focused turn — each one BOTH d-pad reachable and
 * touch-tappable, which is the whole point: keep/note stop being a hidden
 * keyboard-only gesture. The order is fixed so the cursor index maps
 * 0=keep · 1=note · 2=edit (see useMenuSystem.selectedTurnAction), and it reuses
 * the shared menu-item styling so it sits on the same single-size grid as the
 * drawer.
 */
export const TurnActionsMenu = ({
  node,
  selected,
  onSelect,
}: TurnActionsMenuProps) => {
  const actions: { id: TurnActionId; label: string }[] = [
    { id: "keep", label: node.kept ? "un-keep" : "keep" },
    { id: "note", label: "note" },
    { id: "edit", label: "edit" },
  ];

  return (
    <div className="menu-content" role="menu" aria-label="Turn actions">
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
};
