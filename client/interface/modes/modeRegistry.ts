import type { DrawerTab, Projection, Screen } from "../types";

export type ModeId =
  | "loom"
  | "map"
  | "bin"
  | "edit"
  | "turn"
  | "story-actions"
  | "note"
  | "drawer-tabs"
  | "drawer-settings"
  | "drawer-stories"
  | "drawer-models"
  | "model-editor";

interface ModeContext {
  screen: Screen;
  projection: Projection;
  drawerTab: DrawerTab;
  cursorOnTabs: boolean;
  editingModel: boolean;
}

interface RegisteredMode {
  id: ModeId;
  title: string;
  hint: string;
  matches: (context: ModeContext) => boolean;
}

export const registeredModes: RegisteredMode[] = [
  {
    id: "edit",
    title: "EDIT",
    hint: "START: SAVE • SELECT: CANCEL",
    matches: ({ screen }) => screen === "edit",
  },
  {
    id: "note",
    title: "NOTE",
    hint: "START: SAVE • SELECT: CANCEL",
    matches: ({ screen }) => screen === "note",
  },
  {
    id: "turn",
    title: "TURN",
    hint: "↕: MOVE • ↵: CHOOSE • START: CLOSE",
    matches: ({ screen }) => screen === "turn",
  },
  {
    id: "story-actions",
    title: "LOOM ACTIONS",
    hint: "↕: MOVE • ↵: CHOOSE • START: CLOSE",
    matches: ({ screen }) => screen === "story-actions",
  },
  {
    id: "model-editor",
    title: "EDIT MODEL",
    hint: "↵: EDIT FIELD • ⌫: BACK • START: SAVE",
    matches: ({ screen, drawerTab, editingModel }) =>
      screen === "drawer" && drawerTab === "models" && editingModel,
  },
  {
    id: "drawer-tabs",
    title: "TABS",
    hint: "◄►: TAB • ↵/↓: ROWS • START: CLOSE",
    matches: ({ screen, cursorOnTabs }) => screen === "drawer" && cursorOnTabs,
  },
  {
    id: "drawer-settings",
    title: "SETTINGS",
    hint: "↵: CYCLE • ⌫: BACK • START: CLOSE",
    matches: ({ screen, drawerTab }) =>
      screen === "drawer" && drawerTab === "settings",
  },
  {
    id: "drawer-stories",
    title: "STORIES",
    hint: "↵: OPEN • ⌫: DELETE • START: CLOSE",
    matches: ({ screen, drawerTab }) =>
      screen === "drawer" && drawerTab === "stories",
  },
  {
    id: "drawer-models",
    title: "MODELS",
    hint: "↵: EDIT • ⌫: DELETE • START: CLOSE",
    matches: ({ screen, drawerTab }) =>
      screen === "drawer" && drawerTab === "models",
  },
  {
    id: "map",
    title: "MAP",
    hint: "↵: GENERATE • ⌫: EDIT • START: LOOM • SELECT: CONFIG",
    matches: ({ screen, projection }) => screen === null && projection === "map",
  },
  {
    id: "loom",
    title: "LOOM",
    hint: "↵: GENERATE • ⌫: ACTIONS • START: MAP • SELECT: CONFIG",
    matches: ({ screen, projection }) =>
      screen === null && projection === "loom",
  },
  {
    id: "bin",
    title: "LOOMS",
    hint: "◄►: DIAL • ↓: FLY • ↵: READ • ⌫: ACTIONS • START: BACK",
    matches: ({ screen, projection }) => screen === null && projection === "bin",
  },
];

export function getRegisteredMode(context: ModeContext): RegisteredMode {
  return registeredModes.find((mode) => mode.matches(context)) ?? registeredModes.at(-1)!;
}
