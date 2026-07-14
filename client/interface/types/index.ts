import type { AvailableModels, ModelId } from "../../../shared/models";
import type { LengthMode } from "../../../shared/lengthPresets";
import type {
  ThemeClass,
  ThemeMode,
  FontOption,
} from "../components/ThemeToggle";

/**
 * Who produced a turn's text. Derived in the ONE fold (`turnToStoryNode`) from
 * the identity carried in `meta`, never guessed. `"unknown"` is for turns whose
 * origin cannot be recovered (old or imported turns with no carried identity) —
 * an unknowable turn is NEVER silently read as `"human"`.
 */
export type StoryOrigin = "human" | "model" | "unknown";

/** Fingerprint of the generation that produced a model turn. */
export interface StoryGeneratedBy {
  model?: string;
  temperature?: number;
  lengthMode?: string;
  textSplitting?: boolean;
}

export interface StoryNode {
  id: string;
  text: string;
  continuations?: StoryNode[];
  /** Human vs model vs unknown, derived from carried meta in the fold. */
  origin: StoryOrigin;
  /** The person's identity (actor) — kept separate from the controller (`via`). */
  actor?: string;
  /** The controlling software that wrote the turn, e.g. `"textile-browser"`. */
  via?: string;
  /** Present only for model turns; absent marks a human/unknown turn. */
  generatedBy?: StoryGeneratedBy;
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
    authorName: string;
    authorshipDisplay: import("../lync/storyRuntime").AuthorshipDisplay;
  };
  onParamChange: (param: string, value: number | string | boolean) => void;
  /** Open the interactive editor for the free-text author name. */
  onEditAuthorName: () => void;
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
  currentStoryKey?: string;
  storyMeta?: import("../utils/storyMeta").StoryMetaMap;
  onToggleSort?: (direction: -1 | 1) => void;
  onSelect: (key: string) => void;
  onDelete?: (key: string) => void;
  onNew?: () => void;
  onImportConversation?: () => void;
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
