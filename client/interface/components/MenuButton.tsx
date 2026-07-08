import { MenuButtonProps } from "../types";

export const MenuButton = ({
  label,
  ariaLabel,
  active,
  onMouseDown,
  onMouseUp,
}: MenuButtonProps) => (
  <button
    className={`gamepad-btn ${active ? "active" : ""}`}
    onMouseDown={onMouseDown}
    onMouseUp={onMouseUp}
    onMouseLeave={onMouseUp}
    aria-pressed={active}
    aria-label={ariaLabel}
    title={ariaLabel}
  >
    {label}
  </button>
);
