import type { AvailableModels, ModelId } from "../../../shared/models";
import type { LengthMode } from "../../../shared/lengthPresets";
import type {
  ThemeClass,
  ThemeMode,
  FontOption,
} from "../components/ThemeToggle";

export interface StoryNode {
  id: string;
  text: string;
  continuations?: StoryNode[];
}

export interface MenuScreenProps {
  children: React.ReactNode;
}

export interface SettingsMenuProps {
  params: {
    temperature: number;
    lengthMode: LengthMode;
    model: ModelId;
    textSplitting: boolean;
    autoModeIterations: number;
    themeMode: ThemeMode;
    lightTheme: ThemeClass;
    darkTheme: ThemeClass;
    font: FontOption;
  };
  onParamChange: (param: string, value: number | string | boolean) => void;
  selectedParam: number;
  onSelectParam?: (index: number) => void;
  isLoading?: boolean;
  models: AvailableModels | null;
  modelsLoading?: boolean;
  modelsError?: string | null;
  getModelName: (modelId: ModelId) => string;
  fonts: Array<{ id: FontOption; label: string }>;
}

export interface TreeListProps {
  trees: { [key: string]: { root: StoryNode } };
  storyTitles?: Record<string, string>;
  selectedIndex: number;
  selectedColumn: number;
  sortOrder: import("../utils/storyMeta").StorySortOption;
  onToggleSort?: (direction: -1 | 1) => void;
  onSelect: (key: string) => void;
  onDelete?: (key: string) => void;
  onNew?: () => void;
  onShareStory?: (key: string) => void;
  onShareThread?: (key: string) => void;
  onShareIndex?: () => void;
  onExportJson?: (key: string) => void;
  onExportThread?: (key: string) => void;
  onHighlight?: (index: number, column: number) => void;
}

export interface GamepadButtonProps {
  label: string;
  caption?: string;
  ariaLabel: string;
  className?: string;
  active?: boolean;
  disabled?: boolean;
  onMouseDown: () => void;
  onMouseUp: () => void;
}

export interface DPadProps {
  activeDirection: string | null;
  onControlPress: (key: string) => void;
  onControlRelease: (key: string) => void;
}

export interface MenuButtonProps {
  label: string;
  ariaLabel: string;
  active: boolean;
  onMouseDown: () => void;
  onMouseUp: () => void;
}

export type ModelSortOption = "name-asc" | "name-desc";

export type InFlight = Set<string>;

export interface GeneratingInfo {
  [nodeId: string]: {
    depth: number;
    index: number | null;
  };
}

export interface ActiveControls {
  direction: string | null;
  a: boolean;
  b: boolean;
  select: boolean;
  start: boolean;
}

/**
 * Top-level screen overlay.  The tree view (loom + map) is always the base
 * layer; `screen` chooses what's on top of it.
 *   - null   : no overlay; tree is fully visible
 *   - "drawer" : configuration drawer with tabs (settings / models / stories)
 *   - "edit"   : full-screen text edit overlay on the current node
 */
export type Screen = "drawer" | "edit" | null;

/** Which projection of the tree is visible when no overlay is open. */
export type Projection = "loom" | "map";

/** Which tab is active in the configuration drawer. */
export type DrawerTab = "settings" | "models" | "stories";
