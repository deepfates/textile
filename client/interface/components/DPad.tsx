import { DPadProps } from "../types";

export const DPad = ({
  activeDirection,
  onControlPress,
  onControlRelease,
}: DPadProps) => (
  <div className="terminal-grid" role="group" aria-label="Direction Controls">
    {/* Up */}
    <button
      className={`terminal-grid-cell gamepad-btn ${
        activeDirection === "up" ? "active" : ""
      }`}
      onMouseDown={() => onControlPress("ArrowUp")}
      onMouseUp={() => onControlRelease("ArrowUp")}
      onMouseLeave={() => onControlRelease("ArrowUp")}
      aria-label="Move up"
      title="Move up"
    >
      <span className="gamepad-btn-glyph" aria-hidden="true">
        ▴
      </span>
      <span className="gamepad-btn-caption">Up</span>
    </button>
    {/* Left */}
    <button
      className={`terminal-grid-cell gamepad-btn ${
        activeDirection === "left" ? "active" : ""
      }`}
      onMouseDown={() => onControlPress("ArrowLeft")}
      onMouseUp={() => onControlRelease("ArrowLeft")}
      onMouseLeave={() => onControlRelease("ArrowLeft")}
      aria-label="Move left"
      title="Move left"
    >
      <span className="gamepad-btn-glyph" aria-hidden="true">
        ◂
      </span>
      <span className="gamepad-btn-caption">Left</span>
    </button>
    {/* Right */}
    <button
      className={`terminal-grid-cell gamepad-btn ${
        activeDirection === "right" ? "active" : ""
      }`}
      onMouseDown={() => onControlPress("ArrowRight")}
      onMouseUp={() => onControlRelease("ArrowRight")}
      onMouseLeave={() => onControlRelease("ArrowRight")}
      aria-label="Move right"
      title="Move right"
    >
      <span className="gamepad-btn-glyph" aria-hidden="true">
        ▸
      </span>
      <span className="gamepad-btn-caption">Right</span>
    </button>
    {/* Down */}
    <button
      className={`terminal-grid-cell gamepad-btn ${
        activeDirection === "down" ? "active" : ""
      }`}
      onMouseDown={() => onControlPress("ArrowDown")}
      onMouseUp={() => onControlRelease("ArrowDown")}
      onMouseLeave={() => onControlRelease("ArrowDown")}
      aria-label="Move down"
      title="Move down"
    >
      <span className="gamepad-btn-glyph" aria-hidden="true">
        ▾
      </span>
      <span className="gamepad-btn-caption">Down</span>
    </button>
  </div>
);
