import { SettingsMenuProps } from "../types";
import { Row } from "../components/Row";
import type { ModelId } from "../../../shared/models";
import { LENGTH_PRESETS, type LengthMode } from "../../../shared/lengthPresets";
import { THEME_PRESETS } from "../components/ThemeToggle";

const LENGTH_MODES: LengthMode[] = ["word", "sentence", "paragraph", "page"];
const AUTHORSHIP_LABELS = {
  on: "On",
  off: "Off",
} as const;
const THEME_MODE_LABELS = {
  light: "Light",
  dark: "Dark",
  system: "System",
} as const;

/**
 * Rows, top-down, ordered by how often users actually touch them.
 *   0  Temperature     — tweaked per-generation
 *   1  Length          — tweaked per-generation
 *   2  Model           — switched fairly often
 *   3  Auto Mode       — toggled when exploring
 *   4  Text Splitting  — set once
 *   5  Theme Mode      — set occasionally
 *   6  Light Theme     — set occasionally
 *   7  Dark Theme      — set occasionally
 *   8  Font            — set once or twice ever
 *   9  Author Name     — the person's identity on shared looms; set once
 *   10 Authorship      — whether the map minibuffer shows who wrote a node (On/Off)
 *
 * Keep SETTINGS_ROW_LABELS (Interface.tsx) in lock-step with this order.
 * The "Manage Models" action row was removed when Models became a tab.
 */
export const SettingsMenu = ({
  params,
  onParamChange,
  selectedParam = 0,
  onSelectParam,
  isLoading = false,
  models,
  modelsLoading = false,
  modelsError,
  getModelName,
  fonts,
  onEditAuthorName,
}: SettingsMenuProps) => {
  const hover = (index: number) => onSelectParam?.(index);
  const modelOptions = models ? (Object.keys(models) as ModelId[]) : [];
  const isModelsLoading = modelsLoading && !models;

  const cycle = <T,>(list: T[], current: T, delta: 1 | -1): T => {
    if (!list.length) return current;
    const idx = list.indexOf(current);
    const next = ((idx === -1 ? 0 : idx) + delta + list.length) % list.length;
    return list[next];
  };

  const lightThemes = THEME_PRESETS.filter((p) => p.tone === "light");
  const darkThemes = THEME_PRESETS.filter((p) => p.tone === "dark");
  const themeLabel = (id: string) =>
    THEME_PRESETS.find((p) => p.id === id)?.label ?? id;
  const fontLabel = (id: string) =>
    fonts.find((f) => f.id === id)?.label ?? id;

  return (
    <div className="menu-content">
      <Row
        kind="knob"
        label="Temperature"
        value={params.temperature}
        min={0.0}
        max={2.0}
        step={0.1}
        formatValue={(v) => v.toFixed(1)}
        selected={selectedParam === 0}
        onHover={() => hover(0)}
        onActivate={() => {
          hover(0);
          onParamChange(
            "temperature",
            Math.min(2.0, Math.round((params.temperature + 0.1) * 10) / 10),
          );
        }}
        onSetValue={(v) => {
          hover(0);
          onParamChange("temperature", Math.round(v * 10) / 10);
        }}
      />
      <Row
        kind="pick"
        label="Length"
        value={LENGTH_PRESETS[params.lengthMode].label}
        selected={selectedParam === 1}
        onHover={() => hover(1)}
        onActivate={() => {
          hover(1);
          onParamChange("lengthMode", cycle(LENGTH_MODES, params.lengthMode, 1));
        }}
      />
      <Row
        kind="pick"
        label={`Model${isModelsLoading ? " (loading…)" : ""}`}
        value={getModelName(params.model)}
        selected={selectedParam === 2}
        onHover={() => hover(2)}
        onActivate={() => {
          hover(2);
          if (!modelOptions.length) return;
          onParamChange("model", cycle(modelOptions, params.model, 1));
        }}
      />
      <Row
        kind="knob"
        label="Auto Mode"
        value={params.autoModeIterations}
        min={0}
        max={4}
        step={1}
        formatValue={(v) => (v >= 4 ? "∞" : String(v))}
        selected={selectedParam === 3}
        onHover={() => hover(3)}
        onActivate={() => {
          hover(3);
          onParamChange(
            "autoModeIterations",
            Math.min(4, params.autoModeIterations + 1),
          );
        }}
        onSetValue={(v) => {
          hover(3);
          onParamChange("autoModeIterations", Math.round(v));
        }}
      />
      <Row
        kind="toggle"
        label="Text Splitting"
        value={params.textSplitting}
        selected={selectedParam === 4}
        onHover={() => hover(4)}
        onActivate={() => {
          hover(4);
          onParamChange("textSplitting", !params.textSplitting);
        }}
      />
      <Row
        kind="pick"
        label="Theme Mode"
        value={THEME_MODE_LABELS[params.themeMode]}
        selected={selectedParam === 5}
        onHover={() => hover(5)}
        onActivate={() => {
          hover(5);
          const modes = ["light", "dark", "system"] as const;
          onParamChange(
            "themeMode",
            cycle(modes as unknown as string[], params.themeMode, 1),
          );
        }}
      />
      <Row
        kind="pick"
        label="Light Theme"
        value={themeLabel(params.lightTheme)}
        selected={selectedParam === 6}
        onHover={() => hover(6)}
        onActivate={() => {
          hover(6);
          const ids = lightThemes.map((p) => p.id);
          onParamChange("lightTheme", cycle(ids, params.lightTheme, 1));
        }}
      />
      <Row
        kind="pick"
        label="Dark Theme"
        value={themeLabel(params.darkTheme)}
        selected={selectedParam === 7}
        onHover={() => hover(7)}
        onActivate={() => {
          hover(7);
          const ids = darkThemes.map((p) => p.id);
          onParamChange("darkTheme", cycle(ids, params.darkTheme, 1));
        }}
      />
      <Row
        kind="pick"
        label="Font"
        value={fontLabel(params.font)}
        selected={selectedParam === 8}
        onHover={() => hover(8)}
        onActivate={() => {
          hover(8);
          const ids = fonts.map((f) => f.id);
          onParamChange("font", cycle(ids, params.font, 1));
        }}
      />
      <Row
        kind="pick"
        label="Author Name"
        value={params.authorName || "anonymous"}
        showAdjust={false}
        selected={selectedParam === 9}
        onHover={() => hover(9)}
        onActivate={() => {
          hover(9);
          onEditAuthorName();
        }}
      />
      <Row
        kind="pick"
        label="Authorship"
        value={AUTHORSHIP_LABELS[params.authorshipDisplay]}
        selected={selectedParam === 10}
        onHover={() => hover(10)}
        onActivate={() => {
          hover(10);
          const modes = ["on", "off"] as const;
          onParamChange(
            "authorshipDisplay",
            cycle(modes as unknown as string[], params.authorshipDisplay, 1),
          );
        }}
      />
      {modelsError && (
        <output className="error-message">
          Failed to load models: {modelsError}
        </output>
      )}
    </div>
  );
};
