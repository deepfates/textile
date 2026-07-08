import type { ReactNode } from "react";

/**
 * Row: the single visual primitive for every menu row in the app.
 *
 * Four kinds, by channel response:
 *   - "pick":   label + cycling value.  ←→ cycles, ↵ cycles forward.
 *   - "knob":   label + numeric value.  ←→ adjusts, ↵ nudges.
 *   - "toggle": label + on/off glyph.   ←→ flips, ↵ flips.
 *   - "action": label + preview text.   ↵ activates.  No ←→.
 *
 * All rows are the same height, share the same selection fill, and emit the
 * same hover/focus affordances.  The menu above decides which kind to render
 * and owns the state; the Row just draws and reports its clicks.
 */

export type RowKind = "pick" | "knob" | "toggle" | "action";

interface BaseProps {
  label: string;
  selected: boolean;
  onActivate?: () => void;
  onHover?: () => void;
  danger?: boolean;
  className?: string;
}

interface PickProps extends BaseProps {
  kind: "pick";
  value: string;
  /** Glyph shown when the row is selected and ←→ adjusts the value. */
  showAdjust?: boolean;
  /** Optional right-side controls. */
  trailing?: ReactNode;
}

interface KnobProps extends BaseProps {
  kind: "knob";
  value: number;
  min: number;
  max: number;
  /** Optional pretty formatter (e.g. "∞" for max). */
  formatValue?: (v: number) => string;
  /** Optional setter for pointer (mouse/touch) drag on the bar. */
  onSetValue?: (v: number) => void;
  /** Optional step for snapping pointer values. */
  step?: number;
}

interface ToggleProps extends BaseProps {
  kind: "toggle";
  value: boolean;
}

interface ActionProps extends BaseProps {
  kind: "action";
  /** Short preview / description, shown after a separator. */
  preview?: string;
  /** Leading glyph (+, →, etc.). */
  glyph?: string;
  /** Right-side content (icons, sub-actions). */
  trailing?: ReactNode;
  disabled?: boolean;
  /** When true, render preview on its own line below the label. */
  stacked?: boolean;
}

export type RowProps = PickProps | KnobProps | ToggleProps | ActionProps;

const toggleGlyph = (on: boolean) => (on ? "×" : " ");
const adjustGlyph = "◄►";

export const Row = (props: RowProps) => {
  const { label, selected, onActivate, onHover, danger } = props;

  const className = [
    "menu-item",
    "menu-item--row",
    `menu-item--${props.kind}`,
    selected ? "selected" : "",
    danger ? "menu-item--danger" : "",
    props.kind === "action" && props.disabled ? "menu-item--disabled" : "",
    props.kind === "action" && props.stacked ? "menu-item--stacked" : "",
    props.className,
  ]
    .filter(Boolean)
    .join(" ");

  const handleClick = () => {
    if (props.kind === "action" && props.disabled) return;
    onActivate?.();
  };

  // Rendered as a div-with-button-role instead of a real <button> so rows
  // that carry trailing interactive controls (e.g. the story list's
  // export icons) don't produce invalid nested-button markup.  Keyboard
  // activation is owned by Interface's key router, not by this element.
  const isDisabled = props.kind === "action" && props.disabled;
  return (
    <div
      role="button"
      tabIndex={isDisabled ? -1 : 0}
      className={className}
      aria-selected={selected}
      aria-disabled={isDisabled || undefined}
      onClick={handleClick}
      onFocus={onHover}
    >
      <RowContent {...props} />
    </div>
  );
};

const RowContent = (props: RowProps) => {
  switch (props.kind) {
    case "pick":
      return (
        <>
          <span className="menu-item-label">{props.label}:</span>
          <span className="menu-item-value">{props.value}</span>
          {props.selected && props.showAdjust !== false ? (
            <span className="menu-item-hint" aria-hidden="true">
              {adjustGlyph}
            </span>
          ) : null}
          {props.trailing ? (
            <span className="menu-item-trailing">{props.trailing}</span>
          ) : null}
        </>
      );
    case "knob": {
      const display = props.formatValue
        ? props.formatValue(props.value)
        : String(props.value);
      const fraction =
        props.max > props.min
          ? (props.value - props.min) / (props.max - props.min)
          : 0;
      const applyPointer = (e: React.PointerEvent<HTMLSpanElement>) => {
        if (!props.onSetValue) return;
        const el = e.currentTarget;
        const rect = el.getBoundingClientRect();
        const f =
          rect.width <= 0 ? 0 : (e.clientX - rect.left) / rect.width;
        const raw =
          props.min + Math.max(0, Math.min(1, f)) * (props.max - props.min);
        const snapped =
          props.step && props.step > 0
            ? Math.round(raw / props.step) * props.step
            : raw;
        props.onSetValue(
          Math.max(props.min, Math.min(props.max, snapped)),
        );
      };
      return (
        <>
          <span className="menu-item-label">{props.label}:</span>
          <span className="menu-item-value">{display}</span>
          <span
            className="menu-item-knob-bar"
            role="presentation"
            onPointerDown={(e) => {
              if (!props.onSetValue) return;
              // Begin drag: capture pointer and track movement.
              (e.currentTarget as HTMLElement).setPointerCapture(
                e.pointerId,
              );
              e.stopPropagation();
              applyPointer(e);
            }}
            onPointerMove={(e) => {
              if (
                props.onSetValue &&
                (e.currentTarget as HTMLElement).hasPointerCapture(
                  e.pointerId,
                )
              ) {
                applyPointer(e);
              }
            }}
            // The browser synthesizes a `click` event after pointerup
            // that is separate from the pointer events above — without
            // stopping it, it bubbles to the row-level onClick and
            // fires onActivate, which for a knob means "nudge by one
            // step," so the value the user just pointer-set gets
            // clobbered by an immediate increment.
            onClick={(e) => {
              if (props.onSetValue) e.stopPropagation();
            }}
          >
            <span
              className="menu-item-knob-fill"
              style={{
                width: `${Math.max(0, Math.min(1, fraction)) * 100}%`,
              }}
            />
          </span>
          {props.selected ? (
            <span className="menu-item-hint" aria-hidden="true">
              {adjustGlyph}
            </span>
          ) : null}
        </>
      );
    }
    case "toggle":
      return (
        <>
          <span className="menu-item-toggle-box" aria-hidden="true">
            {toggleGlyph(props.value)}
          </span>
          <span className="menu-item-label">{props.label}</span>
        </>
      );
    case "action":
      return (
        <>
          {props.glyph ? (
            <span className="menu-item-glyph" aria-hidden="true">
              {props.glyph}
            </span>
          ) : null}
          <span className="menu-item-label">{props.label}</span>
          {props.preview ? (
            <span className="menu-item-preview">{props.preview}</span>
          ) : null}
          {props.trailing ? (
            <span className="menu-item-trailing">{props.trailing}</span>
          ) : null}
        </>
      );
  }
};
