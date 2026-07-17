import { useState } from "react";
import type { DrawerTab } from "../types";
import type { ModelId } from "../../../shared/models";
import type { LengthMode } from "../../../shared/lengthPresets";

/**
 * Top-level UI state for everything that isn't the tree itself.
 *
 *   screen:        what overlay (if any) covers the tree view
 *   drawerTab:     which tab the drawer is on when screen === "drawer"
 *   expandedModel: which model row in the Models tab is expanded into
 *                  the editor form.  null = not editing; "__new__" =
 *                  blank editor for a fresh model.
 *
 * Routing lives in Interface.tsx, not here.  This hook owns the
 * independent state variables and the per-menu cursor indices.
 */

export type Screen = null | "drawer" | "edit" | "turn" | "note";

export interface MenuParams {
  temperature: number;
  lengthMode: LengthMode;
  model: ModelId;
  textSplitting: boolean;
  autoModeIterations: number;
}

export function useMenuSystem(defaultParams: MenuParams) {
  const [screen, setScreen] = useState<Screen>(null);
  const [drawerTab, setDrawerTabRaw] = useState<DrawerTab>("settings");
  const [expandedModel, setExpandedModel] = useState<ModelId | "__new__" | null>(
    null,
  );

  // Cursor within the per-turn action menu (screen === "turn"): 0=keep 1=note 2=edit.
  const [selectedTurnAction, setSelectedTurnAction] = useState(0);
  const [selectedParam, setSelectedParam] = useState(0);
  const [selectedTreeIndex, setSelectedTreeIndex] = useState(0);
  const [selectedTreeColumn, setSelectedTreeColumn] = useState(0);
  const [selectedModelIndex, setSelectedModelIndex] = useState(0);
  const [selectedModelField, setSelectedModelField] = useState(0);
  const [menuParams, setMenuParams] = useState<MenuParams>(defaultParams);

  // When switching tabs, collapse any expanded model editor.
  const setDrawerTab = (tab: DrawerTab) => {
    if (tab !== drawerTab) setExpandedModel(null);
    setDrawerTabRaw(tab);
  };

  return {
    screen,
    setScreen,
    selectedTurnAction,
    setSelectedTurnAction,
    drawerTab,
    setDrawerTab,
    expandedModel,
    setExpandedModel,
    selectedParam,
    setSelectedParam,
    selectedTreeIndex,
    setSelectedTreeIndex,
    selectedTreeColumn,
    setSelectedTreeColumn,
    selectedModelIndex,
    setSelectedModelIndex,
    selectedModelField,
    setSelectedModelField,
    menuParams,
    setMenuParams,
  };
}
