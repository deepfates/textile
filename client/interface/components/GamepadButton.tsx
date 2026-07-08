import { GamepadButtonProps } from "../types";

export const GamepadButton = ({
  label,
  caption,
  ariaLabel,
  className = "",
  active = false,
  disabled = false,
  onMouseDown,
  onMouseUp,
}: GamepadButtonProps) => (
  <button
    className={`gamepad-btn ${active ? "active" : ""} ${
      disabled ? "opacity-50 cursor-not-allowed" : ""
    } ${className}`}
    onMouseDown={disabled ? undefined : onMouseDown}
    onMouseUp={disabled ? undefined : onMouseUp}
    onMouseLeave={disabled ? undefined : onMouseUp}
    disabled={disabled}
    aria-pressed={active}
    aria-label={ariaLabel}
    title={ariaLabel}
  >
    <span className="gamepad-btn-glyph" aria-hidden="true">
      {label}
    </span>
    {caption && <span className="gamepad-btn-caption">{caption}</span>}
  </button>
);
