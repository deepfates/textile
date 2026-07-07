import { useCallback, useRef, useEffect, useState, useMemo } from "react";

import { useKeyboardControls } from "./hooks/useKeyboardControls";
import { useMenuSystem } from "./hooks/useMenuSystem";
import { useStoryTree } from "./hooks/useStoryTree";
import { useOfflineStatus } from "./hooks/useOfflineStatus";
import { useScrollSync } from "./hooks/useScrollSync";
import { useModels } from "./hooks/useModels";

import { DPad } from "./components/DPad";
import { GamepadButton } from "./components/GamepadButton";
import { MenuButton } from "./components/MenuButton";
import { MenuScreen } from "./components/MenuScreen";
import { NavigationDots } from "./components/NavigationDots";
import { StoryMinimap } from "./components/StoryMinimap";
import { useTheme, THEME_PRESETS } from "./components/ThemeToggle";
import type {
  ThemeClass,
  ThemeMode,
  FontOption,
} from "./components/ThemeToggle";
import {
  ModelEditor,
  type ModelFormState,
  type ModelEditorField,
} from "./components/ModelEditor";

import { SettingsMenu } from "./menus/SettingsMenu";
import { TreeListMenu } from "./menus/TreeListMenu";
import { ModelsMenu } from "./menus/ModelsMenu";
import { EditMenu, EDIT_CONTROL_EVENT } from "./menus/EditMenu";
import { InstallPrompt } from "./components/InstallPrompt";
import ModeBar from "./components/ModeBar";
import { Drawer, DRAWER_TABS } from "./components/Drawer";
import { splitTextToDraft } from "./utils/textSplitter";
import {
  scrollElementIntoViewIfNeeded,
  isAtBottom,
  scrollMenuItemElIntoView,
} from "./utils/scrolling";

import type { ModelSortOption, DrawerTab } from "./types";
import type { ModelId, ModelConfig } from "../../shared/models";
import {
  orderKeysReverseChronological,
  orderKeysByStorySort,
  getDefaultStoryKey,
  getStoryMeta,
  setStoryMeta,
  touchStoryActive,
  type StorySortOption,
} from "./utils/storyMeta";
import {
  downloadStoryThreadText,
  downloadStoryTreeJson,
  getStoryPrimaryPath,
} from "./utils/storyExport";
import {
  createStoryIndexShareUrl,
  createStoryShareUrl,
  createStoryThreadShareUrl,
  getStoryIndex,
  replaceStoryFocusUrl,
} from "./lync/storyRuntime";

const DEFAULT_PARAMS = {
  temperature: 1.0,
  lengthMode: "paragraph" as const,
  model: "deepseek/deepseek-chat-v3.1" as ModelId,
  textSplitting: true,
  autoModeIterations: 0,
};

// Row labels for Settings, in cursor-index order.  Used by the navigation-bar
// minibuffer to tell the user what row they're on.  Keep in sync with the
// row order in SettingsMenu and the SETTINGS_PARAMS array below.
const SETTINGS_ROW_LABELS = [
  "Temperature",
  "Length",
  "Model",
  "Auto Mode",
  "Text Splitting",
  "Theme Mode",
  "Light Theme",
  "Dark Theme",
  "Font",
];

const createEmptyModelForm = (): ModelFormState => ({
  id: "" as ModelId | "",
  name: "",
  maxTokens: 1024,
  defaultTemp: 0.7,
});

export const GamepadInterface = () => {
  const { isOnline, isOffline, wasOffline } = useOfflineStatus();
  const {
    themeMode,
    setThemeMode,
    lightTheme,
    setLightTheme,
    darkTheme,
    setDarkTheme,
    font,
    setFont,
    availableFonts,
  } = useTheme();
  const [lastMapNodeId, setLastMapNodeId] = useState<string | null>(null);
  const [bonkDirection, setBonkDirection] = useState<
    "up" | "right" | "down" | "left" | null
  >(null);

  // (select menu navigation now handled in useMenuSystem)

  const {
    screen,
    setScreen,
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
  } = useMenuSystem(DEFAULT_PARAMS);

  // Which tree projection (loom / map) is showing when no overlay is up.
  // Persists while the drawer or edit overlay is open, so closing just
  // restores the prior view — no stash/return ref needed.
  const [projection, setProjection] = useState<"loom" | "map">("loom");
  // When cursor is on the drawer's tab strip, Left/Right cycle tabs
  // and ArrowDown drops into the rows beneath.  ArrowUp from the
  // first row comes back up here.
  const [cursorOnTabs, setCursorOnTabs] = useState(false);

  const openDrawer = useCallback(
    (tab: DrawerTab = drawerTab) => {
      setDrawerTab(tab);
      setScreen("drawer");
      setCursorOnTabs(false);
    },
    [drawerTab, setDrawerTab, setScreen],
  );
  const closeDrawer = useCallback(() => {
    setExpandedModel(null);
    setScreen(null);
    setCursorOnTabs(false);
  }, [setExpandedModel, setScreen]);


  const {
    models,
    loading: modelsLoading,
    error: modelsError,
    saving: modelsSaving,
    createModel,
    updateModel,
    deleteModel,
    getModelName,
  } = useModels();

  const [modelSort, setModelSort] = useState<ModelSortOption>("name-asc");
  const [storySort, setStorySort] = useState<StorySortOption>("recent");
  const [modelForm, setModelForm] = useState<ModelFormState>(() =>
    createEmptyModelForm()
  );
  const [modelEditorMode, setModelEditorMode] = useState<"create" | "edit">(
    "create"
  );
  const [editingModelId, setEditingModelId] = useState<ModelId | null>(null);
  const [modelFormError, setModelFormError] = useState<string | null>(null);
  const [pendingModelSelection, setPendingModelSelection] =
    useState<ModelId | null>(null);

  const {
    trees,
    currentLoomId,
    storyTree,
    currentDepth,
    selectedOptions,
    inFlight,
    generatingInfo,
    isGeneratingAt,
    isAnyGenerating,
    error,
    handleStoryNavigation,
    setCurrentLoomId,
    getCurrentPath,
    getOptionsAtDepth,
    setSelectionByPath,
    storyTitles,
    currentLoomReady,
    createStory,
    deleteStory,
    saveCurrentNodeRevision,
  } = useStoryTree(menuParams);

  // Compute reverse-chronologically ordered trees for menus
  const orderedKeys = useMemo(
    () => orderKeysByStorySort(trees, storySort),
    [trees, storySort]
  );
  // Use orderedKeys directly where needed; no reordered trees object required

  const sortedModelEntries = useMemo(() => {
    if (!models) return [] as Array<[ModelId, ModelConfig]>;
    const entries = Object.entries(models) as Array<[ModelId, ModelConfig]>;
    const sorted = [...entries].sort((a, b) => {
      const nameA = a[1].name.toLowerCase();
      const nameB = b[1].name.toLowerCase();
      const compare = nameA.localeCompare(nameB);
      return modelSort === "name-desc" ? -compare : compare;
    });
    return sorted;
  }, [models, modelSort]);

  const modelOrder = useMemo(
    () => sortedModelEntries.map(([modelId]) => modelId),
    [sortedModelEntries]
  );

  const modelEditorFields = useMemo<ModelEditorField[]>(() => {
    const base: ModelEditorField[] = [
      "id",
      "name",
      "maxTokens",
      "defaultTemp",
      "save",
      "cancel",
    ];

    if (modelEditorMode === "edit") {
      return [...base, "delete"];
    }

    return base;
  }, [modelEditorMode]);

  const currentModelEditorField =
    modelEditorFields[selectedModelField] ?? modelEditorFields[0] ?? "id";

  // On first load, default to the most recently active story (if any)
  const hasAppliedDefault = useRef(false);

  useEffect(() => {
    if (hasAppliedDefault.current) return;
    const keys = Object.keys(trees);
    if (!keys.length) return;
    const preferred = getDefaultStoryKey(trees) ?? orderedKeys[0];
    if (preferred && currentLoomId !== preferred) {
      setCurrentLoomId(preferred);
    }
    if (preferred) touchStoryActive(preferred);
    hasAppliedDefault.current = true;
  }, [trees, orderedKeys, currentLoomId, setCurrentLoomId]);

  // Calculate current highlighted node for map
  const highlightedNode = useMemo(() => {
    let node = storyTree.root;
    for (let depth = 0; depth < currentDepth; depth++) {
      const idx = selectedOptions[depth];
      const child = node.continuations?.[idx];
      if (!child) break;
      node = child;
    }
    return node;
  }, [storyTree, currentDepth, selectedOptions]);

  useEffect(() => {
    if (!currentLoomReady) return;
    const turnId = getCurrentPath().at(-1)?.id ?? null;
    replaceStoryFocusUrl(currentLoomId, turnId);
  }, [currentLoomReady, currentLoomId, getCurrentPath]);

  const storyTextRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const { queueScroll, cancel } = useScrollSync({
    containerRef: storyTextRef,
    prefersReducedMotion,
    padding: 8,
  });

  const handleNewTree = useCallback(async () => {
    const newKey = await createStory();
    touchStoryActive(newKey);
    closeDrawer();
    return newKey;
  }, [createStory, closeDrawer]);

  const handleDeleteTree = useCallback(
    async (key: string) => {
      if (window.confirm(`Are you sure you want to delete "${key}"?`)) {
        await deleteStory(key);
        {
          const meta = getStoryMeta();
          if (meta[key]) {
            delete meta[key];
            setStoryMeta(meta);
          }
        }

        // If we deleted the current tree, switch to another one
        if (key === currentLoomId) {
          const remaining = orderKeysReverseChronological(trees).filter(
            (k) => k !== key
          );
          if (remaining.length > 0) {
            setCurrentLoomId(remaining[0]);
            touchStoryActive(remaining[0]);
          }
        }
      }
    },
    [currentLoomId, deleteStory, trees, setCurrentLoomId]
  );

  const handleExportTree = useCallback(
    (key: string) => {
      const tree = trees[key];
      if (!tree) return;
      downloadStoryTreeJson(key, tree);
    },
    [trees]
  );

  const handleExportThread = useCallback(
    (key: string) => {
      const tree = trees[key];
      if (!tree) return;
      const path =
        key === currentLoomId ? getCurrentPath() : getStoryPrimaryPath(tree);
      downloadStoryThreadText(key, path);
    },
    [currentLoomId, getCurrentPath, trees]
  );

  const copyText = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text);
  }, []);

  const handleShareStory = useCallback(
    async (key: string) => {
      await copyText(createStoryShareUrl(key));
    },
    [copyText]
  );

  const handleShareThread = useCallback(
    async (key: string) => {
      const tree = trees[key];
      if (!tree) return;
      const path =
        key === currentLoomId ? getCurrentPath() : getStoryPrimaryPath(tree);
      const turnId = path.at(-1)?.id ?? null;
      await copyText(
        turnId ? createStoryThreadShareUrl(key, turnId) : createStoryShareUrl(key)
      );
    },
    [copyText, currentLoomId, getCurrentPath, trees]
  );

  const handleShareIndex = useCallback(async () => {
    const index = await getStoryIndex();
    await copyText(createStoryIndexShareUrl(index.id));
  }, [copyText]);

  const handleStoryHighlight = useCallback(
    (index: number, column: number) => {
      setCursorOnTabs(false);
      setSelectedTreeIndex(index);
      setSelectedTreeColumn(column);
    },
    [setSelectedTreeIndex, setSelectedTreeColumn]
  );

  const cycleModelSort = useCallback((_delta: -1 | 1 = 1) => {
    setModelSort((prev) => {
      if (prev === "name-asc") {
        return "name-desc";
      }
      return "name-asc";
    });
  }, []);

  const cycleStorySort = useCallback((_delta: -1 | 1 = 1) => {
    setStorySort((prev) => (prev === "recent" ? "oldest" : "recent"));
  }, []);

  const handleModelFormChange = useCallback(
    <Key extends keyof ModelFormState>(
      field: Key,
      value: ModelFormState[Key]
    ) => {
      setModelForm((prev) => ({
        ...prev,
        [field]: value,
      }));
    },
    []
  );

  const handleStartNewModel = useCallback(() => {
    setModelEditorMode("create");
    setEditingModelId(null);
    setModelForm(createEmptyModelForm());
    setModelFormError(null);
    setSelectedModelField(0);
    setScreen("drawer");
    setDrawerTab("models");
    setExpandedModel("__new__");
  }, [setDrawerTab, setExpandedModel, setScreen, setSelectedModelField]);

  const handleEditModel = useCallback(
    (modelId: ModelId) => {
      const config = models?.[modelId];
      if (!config) return;
      setModelEditorMode("edit");
      setEditingModelId(modelId);
      setModelForm({
        id: modelId,
        name: config.name,
        maxTokens: config.maxTokens,
        defaultTemp: config.defaultTemp,
      });
      setModelFormError(null);
      setSelectedModelField(0);
      setScreen("drawer");
      setDrawerTab("models");
      setExpandedModel(modelId);
    },
    [models, setDrawerTab, setExpandedModel, setScreen, setSelectedModelField]
  );

  const showModelsMenu = useCallback(
    (focusModelId?: ModelId | null) => {
      const targetId =
        focusModelId ??
        (models && models[menuParams.model] ? menuParams.model : modelOrder[0]);
      if (targetId) {
        const index = modelOrder.indexOf(targetId);
        if (index >= 0) {
          setSelectedModelIndex(index + 2);
        }
      } else {
        setSelectedModelIndex(1);
      }
      setModelFormError(null);
      setScreen("drawer");
      setDrawerTab("models");
      setExpandedModel(null);
    },
    [
      menuParams.model,
      modelOrder,
      models,
      setDrawerTab,
      setExpandedModel,
      setScreen,
      setSelectedModelIndex,
    ]
  );

  const handleCancelModelEdit = useCallback(() => {
    if (
      modelEditorMode === "edit" &&
      editingModelId &&
      models?.[editingModelId]
    ) {
      const config = models[editingModelId];
      setModelForm({
        id: editingModelId,
        name: config.name,
        maxTokens: config.maxTokens,
        defaultTemp: config.defaultTemp,
      });
    } else {
      setModelForm(createEmptyModelForm());
      setEditingModelId(null);
      setModelEditorMode("create");
    }
    setModelFormError(null);
    showModelsMenu(editingModelId);
  }, [editingModelId, modelEditorMode, models, showModelsMenu]);

  const handleModelEditorHighlight = useCallback(
    (field: ModelEditorField) => {
      const index = modelEditorFields.indexOf(field);
      if (index >= 0) {
        setSelectedModelField(index);
      }
    },
    [modelEditorFields, setSelectedModelField]
  );

  const handleDeleteModel = useCallback(
    async (modelId: ModelId) => {
      const totalModels = models ? Object.keys(models).length : 0;
      if (totalModels <= 1) {
        setModelFormError("At least one model must remain.");
        return;
      }

      const modelName = models?.[modelId]?.name ?? modelId;
      if (!window.confirm(`Delete model "${modelName}"?`)) {
        return;
      }

      try {
        const updated = await deleteModel(modelId);
        setModelFormError(null);

        if (menuParams.model === modelId) {
          const remainingIds = Object.keys(updated) as ModelId[];
          if (remainingIds.length > 0) {
            setMenuParams((prev) => ({ ...prev, model: remainingIds[0] }));
          }
        }

        if (editingModelId === modelId) {
          const remainingEntries = Object.entries(updated) as Array<
            [ModelId, ModelConfig]
          >;
          if (remainingEntries.length > 0) {
            const [firstId, config] = remainingEntries[0];
            setEditingModelId(firstId);
            setModelEditorMode("edit");
            setModelForm({
              id: firstId,
              name: config.name,
              maxTokens: config.maxTokens,
              defaultTemp: config.defaultTemp,
            });
            setPendingModelSelection(firstId);
            setSelectedModelField(0);
          } else {
            setEditingModelId(null);
            setModelEditorMode("create");
            setModelForm(createEmptyModelForm());
            setSelectedModelField(0);
          }
        }
      } catch (err) {
        setModelFormError(
          err instanceof Error ? err.message : "Failed to delete model"
        );
      }
    },
    [
      deleteModel,
      editingModelId,
      menuParams.model,
      models,
      setMenuParams,
      setPendingModelSelection,
    ]
  );

  const handleSubmitModel = useCallback(async () => {
    const trimmedId = `${modelForm.id ?? ""}`.trim();
    const trimmedName = modelForm.name.trim();
    if (!trimmedId) {
      setModelFormError("Model ID is required.");
      return;
    }
    if (!trimmedName) {
      setModelFormError("Model name is required.");
      return;
    }
    if (!Number.isFinite(modelForm.maxTokens) || modelForm.maxTokens <= 0) {
      setModelFormError("Max tokens must be greater than 0.");
      return;
    }
    if (
      Number.isNaN(modelForm.defaultTemp) ||
      modelForm.defaultTemp < 0 ||
      modelForm.defaultTemp > 2
    ) {
      setModelFormError("Default temperature must be between 0 and 2.");
      return;
    }

    try {
      let nextFocusId: ModelId | null = null;
      if (modelEditorMode === "create") {
        const newId = trimmedId as ModelId;
        await createModel(newId, {
          name: trimmedName,
          maxTokens: modelForm.maxTokens,
          defaultTemp: modelForm.defaultTemp,
        });
        setModelEditorMode("edit");
        setEditingModelId(newId);
        setModelForm({
          id: newId,
          name: trimmedName,
          maxTokens: modelForm.maxTokens,
          defaultTemp: modelForm.defaultTemp,
        });
        setPendingModelSelection(newId);
        setMenuParams((prev) => ({ ...prev, model: newId }));
        nextFocusId = newId;
      } else if (editingModelId) {
        await updateModel(editingModelId, {
          name: trimmedName,
          maxTokens: modelForm.maxTokens,
          defaultTemp: modelForm.defaultTemp,
        });
        setModelForm({
          id: editingModelId,
          name: trimmedName,
          maxTokens: modelForm.maxTokens,
          defaultTemp: modelForm.defaultTemp,
        });
        setPendingModelSelection(editingModelId);
        nextFocusId = editingModelId;
      }
      setModelFormError(null);
      showModelsMenu(nextFocusId);
    } catch (err) {
      setModelFormError(
        err instanceof Error ? err.message : "Failed to save model"
      );
    }
  }, [
    createModel,
    updateModel,
    modelEditorMode,
    modelForm,
    editingModelId,
    setMenuParams,
    showModelsMenu,
  ]);

  const handleModelEditorAdjust = useCallback(
    (field: ModelEditorField, delta: number) => {
      if (field === "maxTokens") {
        setModelForm((prev) => {
          const next = Math.max(1, prev.maxTokens + delta * 64);
          return {
            ...prev,
            maxTokens: next,
          };
        });
        setModelFormError(null);
      } else if (field === "defaultTemp") {
        setModelForm((prev) => {
          const next = Math.max(
            0,
            Math.min(2, Number((prev.defaultTemp + delta * 0.1).toFixed(1)))
          );
          return {
            ...prev,
            defaultTemp: next,
          };
        });
        setModelFormError(null);
      }
    },
    []
  );

  const handleModelEditorActivate = useCallback(
    (field: ModelEditorField) => {
      switch (field) {
        case "id": {
          if (modelEditorMode === "edit") {
            return;
          }
          const input = window.prompt(
            "Model ID",
            `${modelForm.id ?? "provider/model"}`.trim()
          );
          if (input === null) return;
          const trimmed = input.trim();
          setModelForm((prev) => ({
            ...prev,
            id: (trimmed as ModelId | "") ?? ("" as ModelId | ""),
          }));
          setModelFormError(null);
          break;
        }
        case "name": {
          const input = window.prompt("Display Name", modelForm.name.trim());
          if (input === null) return;
          const trimmed = input.trim();
          setModelForm((prev) => ({
            ...prev,
            name: trimmed,
          }));
          setModelFormError(null);
          break;
        }
        case "maxTokens": {
          const input = window.prompt("Max Tokens", `${modelForm.maxTokens}`);
          if (input === null) return;
          const parsed = Number.parseInt(input, 10);
          if (!Number.isNaN(parsed) && parsed > 0) {
            setModelForm((prev) => ({
              ...prev,
              maxTokens: parsed,
            }));
            setModelFormError(null);
          } else {
            setModelFormError("Max tokens must be a positive number.");
          }
          break;
        }
        case "defaultTemp": {
          const input = window.prompt(
            "Default Temperature",
            modelForm.defaultTemp.toFixed(1)
          );
          if (input === null) return;
          const parsed = Number.parseFloat(input);
          if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 2) {
            const rounded = Number(parsed.toFixed(1));
            setModelForm((prev) => ({
              ...prev,
              defaultTemp: rounded,
            }));
            setModelFormError(null);
          } else {
            setModelFormError("Temperature must be between 0 and 2.");
          }
          break;
        }
        case "save": {
          void handleSubmitModel();
          break;
        }
        case "cancel": {
          handleCancelModelEdit();
          break;
        }
        case "delete": {
          if (editingModelId) {
            void handleDeleteModel(editingModelId);
          }
          break;
        }
        default:
          break;
      }
    },
    [
      editingModelId,
      handleCancelModelEdit,
      handleDeleteModel,
      handleSubmitModel,
      modelEditorMode,
      modelForm.defaultTemp,
      modelForm.id,
      modelForm.maxTokens,
      modelForm.name,
      setModelForm,
    ]
  );

  useEffect(() => {
    const total = modelOrder.length + 2;
    setSelectedModelIndex((prev) => {
      const maxIndex = Math.max(0, total - 1);
      return prev > maxIndex ? maxIndex : prev;
    });
  }, [modelOrder, setSelectedModelIndex]);

  useEffect(() => {
    if (selectedModelField >= modelEditorFields.length) {
      setSelectedModelField(0);
    }
  }, [modelEditorFields, selectedModelField, setSelectedModelField]);

  useEffect(() => {
    if (!pendingModelSelection) return;
    const index = modelOrder.indexOf(pendingModelSelection);
    if (index >= 0) {
      setSelectedModelIndex(index + 2);
    }
    setPendingModelSelection(null);
  }, [modelOrder, pendingModelSelection, setSelectedModelIndex]);

  useEffect(() => {
    if (!editingModelId) return;
    const index = modelOrder.indexOf(editingModelId);
    if (index >= 0) {
      setSelectedModelIndex((prev) => (prev === index + 2 ? prev : index + 2));
    }
  }, [editingModelId, modelOrder, setSelectedModelIndex]);

  useEffect(() => {
    if (!models) return;
    if (editingModelId && !models[editingModelId]) {
      const fallbackId = modelOrder[0];
      if (fallbackId) {
        handleEditModel(fallbackId);
        const index = modelOrder.indexOf(fallbackId);
        if (index >= 0) {
          setSelectedModelIndex(index + 2);
        }
      } else {
        handleStartNewModel();
      }
    }
  }, [
    editingModelId,
    handleEditModel,
    handleStartNewModel,
    modelOrder,
    models,
    setSelectedModelIndex,
  ]);

  useEffect(() => {
    if (!models) return;
    if (!models[menuParams.model]) {
      const fallbackId = modelOrder[0];
      if (fallbackId) {
        setMenuParams((prev) => ({ ...prev, model: fallbackId }));
      }
    }
  }, [models, menuParams.model, modelOrder, setMenuParams]);

  // Per-tab navigators — each consumes a key and mutates the cursor / values
  // for its own tab.  Factored out so handleControlAction stays a clean
  // top-level switch on (screen, projection, drawerTab, expandedModel).

  const lightThemeOptions = THEME_PRESETS.filter(
    (p) => p.tone === "light"
  ).map((p) => p.id);
  const darkThemeOptions = THEME_PRESETS.filter(
    (p) => p.tone === "dark"
  ).map((p) => p.id);

  const SETTINGS_PARAMS = useMemo(
    () =>
      [
        "temperature",
        "lengthMode",
        "model",
        "autoModeIterations",
        "textSplitting",
        "themeMode",
        "lightTheme",
        "darkTheme",
        "font",
      ] as const,
    []
  );

  const scrollCurrentMenuItemIntoView = useCallback((index: number) => {
    const menuContent = document.querySelector(".menu-content");
    if (!menuContent) return;
    const container = menuContent as HTMLElement;
    const items = container.querySelectorAll(".menu-item");
    const el = items[index] as HTMLElement | null;
    if (el) scrollMenuItemElIntoView(container, el);
  }, []);

  const navigateSettings = useCallback(
    (key: string) => {
      const count = SETTINGS_PARAMS.length;
      if (key === "ArrowUp" || key === "ArrowDown") {
        const delta = key === "ArrowUp" ? -1 : 1;
        setSelectedParam((prev) => {
          const n = (prev + delta + count) % count;
          scrollCurrentMenuItemIntoView(n);
          return n;
        });
        return;
      }
      const param = SETTINGS_PARAMS[selectedParam];
      const dir: -1 | 1 =
        key === "ArrowLeft" ? -1 : 1; // Enter/ArrowRight both forward
      const wrap = <T,>(list: T[], current: T, delta: -1 | 1): T => {
        if (!list.length) return current;
        const idx = list.indexOf(current);
        const n = ((idx === -1 ? 0 : idx) + delta + list.length) % list.length;
        return list[n];
      };
      if (key === "ArrowLeft" || key === "ArrowRight" || key === "Enter") {
        if (param === "temperature") {
          if (key === "Enter") return;
          setMenuParams((prev) => ({
            ...prev,
            temperature: Math.max(
              0,
              Math.min(2, Math.round((prev.temperature + dir * 0.1) * 10) / 10)
            ),
          }));
        } else if (param === "lengthMode") {
          setMenuParams((prev) => ({
            ...prev,
            lengthMode: wrap(
              ["word", "sentence", "paragraph", "page"],
              prev.lengthMode,
              dir
            ),
          }));
        } else if (param === "model") {
          if (!modelOrder.length) return;
          setMenuParams((prev) => ({
            ...prev,
            model: wrap(modelOrder, prev.model, dir),
          }));
        } else if (param === "autoModeIterations") {
          if (key === "Enter") {
            setMenuParams((prev) => ({
              ...prev,
              autoModeIterations: (prev.autoModeIterations + 1) % 5,
            }));
            return;
          }
          setMenuParams((prev) => ({
            ...prev,
            autoModeIterations: Math.max(
              0,
              Math.min(4, prev.autoModeIterations + dir)
            ),
          }));
        } else if (param === "textSplitting") {
          setMenuParams((prev) => ({
            ...prev,
            textSplitting: !prev.textSplitting,
          }));
        } else if (param === "themeMode") {
          const modes: ThemeMode[] = ["light", "dark", "system"];
          setThemeMode(wrap(modes, themeMode, dir));
        } else if (param === "lightTheme") {
          setLightTheme(wrap(lightThemeOptions, lightTheme, dir));
        } else if (param === "darkTheme") {
          setDarkTheme(wrap(darkThemeOptions, darkTheme, dir));
        } else if (param === "font") {
          const ids = availableFonts.map((f) => f.id);
          if (!ids.length) return;
          setFont(wrap(ids, font, dir));
        }
      }
    },
    [
      SETTINGS_PARAMS,
      availableFonts,
      darkTheme,
      darkThemeOptions,
      font,
      lightTheme,
      lightThemeOptions,
      modelOrder,
      scrollCurrentMenuItemIntoView,
      selectedParam,
      setDarkTheme,
      setFont,
      setLightTheme,
      setMenuParams,
      setSelectedParam,
      setThemeMode,
      themeMode,
    ]
  );

  const navigateStories = useCallback(
    (key: string) => {
      // Row 0 is Sort, row 1 is "+ New Story", rows 2+ are the stories.
      const baseOffset = 2;
      const totalItems = orderedKeys.length + baseOffset;
      const columnTypes: Array<"story" | "share" | "thread-link" | "json" | "thread"> = [
        "story",
        "share",
        "thread-link",
        "json",
        "thread",
      ];
      const maxColumnFor = (index: number) =>
        index === 0 ? 1 : index < baseOffset ? 0 : columnTypes.length - 1;
      switch (key) {
        case "ArrowUp":
        case "ArrowDown": {
          const delta = key === "ArrowUp" ? -1 : 1;
          setSelectedTreeIndex((prev) => {
            const n = (prev + delta + totalItems) % totalItems;
            scrollCurrentMenuItemIntoView(n);
            setSelectedTreeColumn((c) => Math.min(c, maxColumnFor(n)));
            return n;
          });
          return;
        }
        case "ArrowLeft":
          if (selectedTreeIndex === 0) {
            if (selectedTreeColumn === 0) {
              cycleStorySort(-1);
            } else {
              setSelectedTreeColumn((prev) => Math.max(0, prev - 1));
            }
          } else {
            setSelectedTreeColumn((prev) => Math.max(0, prev - 1));
          }
          return;
        case "ArrowRight":
          if (selectedTreeIndex === 0) {
            setSelectedTreeColumn((prev) =>
              Math.min(maxColumnFor(selectedTreeIndex), prev + 1)
            );
          } else {
            setSelectedTreeColumn((prev) =>
              Math.min(maxColumnFor(selectedTreeIndex), prev + 1)
            );
          }
          return;
        case "Enter": {
          if (selectedTreeIndex === 0) {
            if (selectedTreeColumn === 1) {
              void handleShareIndex();
            } else {
              cycleStorySort(1);
            }
            return;
          }
          if (selectedTreeIndex === 1) {
            void handleNewTree();
            setSelectedTreeColumn(0);
            return;
          }
          const treeKey = orderedKeys[selectedTreeIndex - baseOffset];
          if (!treeKey) return;
          if (selectedTreeColumn === 0) {
            touchStoryActive(treeKey);
            setCurrentLoomId(treeKey);
            closeDrawer();
            setSelectedTreeColumn(0);
          } else if (columnTypes[selectedTreeColumn] === "share") {
            void handleShareStory(treeKey);
          } else if (columnTypes[selectedTreeColumn] === "thread-link") {
            void handleShareThread(treeKey);
          } else if (columnTypes[selectedTreeColumn] === "json") {
            handleExportTree(treeKey);
          } else if (columnTypes[selectedTreeColumn] === "thread") {
            handleExportThread(treeKey);
          }
          return;
        }
        case "Backspace": {
          if (selectedTreeIndex >= baseOffset && orderedKeys.length > 1) {
            const treeKey = orderedKeys[selectedTreeIndex - baseOffset];
            if (treeKey) {
              handleDeleteTree(treeKey);
              setSelectedTreeColumn(0);
            }
          }
          return;
        }
      }
    },
    [
      closeDrawer,
      cycleStorySort,
      handleDeleteTree,
      handleExportThread,
      handleExportTree,
      handleShareIndex,
      handleShareStory,
      handleNewTree,
      orderedKeys,
      scrollCurrentMenuItemIntoView,
      selectedTreeColumn,
      selectedTreeIndex,
      setCurrentLoomId,
      setSelectedTreeColumn,
      setSelectedTreeIndex,
    ]
  );

  const navigateModelsList = useCallback(
    (key: string) => {
      const baseOffset = 2; // sort row + new model row
      const totalItems = modelOrder.length + baseOffset;
      switch (key) {
        case "ArrowUp":
        case "ArrowDown": {
          const delta = key === "ArrowUp" ? -1 : 1;
          setSelectedModelIndex((prev) => {
            const n = (prev + delta + totalItems) % totalItems;
            scrollCurrentMenuItemIntoView(n);
            return n;
          });
          return;
        }
        case "ArrowLeft":
          if (selectedModelIndex === 0) cycleModelSort(-1);
          return;
        case "ArrowRight":
          if (selectedModelIndex === 0) cycleModelSort(1);
          return;
        case "Enter": {
          if (selectedModelIndex === 0) {
            cycleModelSort(1);
          } else if (selectedModelIndex === 1) {
            handleStartNewModel();
          } else {
            const modelId = modelOrder[selectedModelIndex - baseOffset];
            if (modelId) handleEditModel(modelId);
          }
          return;
        }
        case "Backspace": {
          if (selectedModelIndex >= baseOffset) {
            const modelId = modelOrder[selectedModelIndex - baseOffset];
            if (modelId) void handleDeleteModel(modelId);
          }
          return;
        }
      }
    },
    [
      cycleModelSort,
      handleDeleteModel,
      handleEditModel,
      handleStartNewModel,
      modelOrder,
      scrollCurrentMenuItemIntoView,
      selectedModelIndex,
      setSelectedModelIndex,
    ]
  );

  const navigateModelEditor = useCallback(
    (key: string) => {
      const fields = modelEditorFields;
      const total = fields.length;
      if (!total) return;
      switch (key) {
        case "ArrowUp":
        case "ArrowDown": {
          const delta = key === "ArrowUp" ? -1 : 1;
          setSelectedModelField((prev) => {
            const n = (prev + delta + total) % total;
            handleModelEditorHighlight(fields[n]);
            return n;
          });
          return;
        }
        case "ArrowLeft":
          handleModelEditorAdjust(fields[selectedModelField], -1);
          return;
        case "ArrowRight":
          handleModelEditorAdjust(fields[selectedModelField], 1);
          return;
        case "Enter":
          handleModelEditorActivate(fields[selectedModelField]);
          return;
        case "Backspace":
          handleCancelModelEdit();
          return;
      }
    },
    [
      handleCancelModelEdit,
      handleModelEditorActivate,
      handleModelEditorAdjust,
      handleModelEditorHighlight,
      modelEditorFields,
      selectedModelField,
      setSelectedModelField,
    ]
  );

  const triggerBonk = useCallback((key: string) => {
    const direction =
      key === "ArrowUp"
        ? "up"
        : key === "ArrowRight"
          ? "right"
          : key === "ArrowDown"
            ? "down"
            : key === "ArrowLeft"
              ? "left"
              : null;
    if (!direction) return;
    setBonkDirection(null);
    window.setTimeout(() => setBonkDirection(direction), 0);
    window.setTimeout(() => {
      setBonkDirection((current) => (current === direction ? null : current));
    }, 180);
  }, []);

  const handleControlAction = useCallback(
    async (key: string) => {
      // EDIT overlay — EditMenu owns keyboard via its own window listener.
      // Button taps reach it through a dedicated custom event so the global
      // keyboard hook does not recursively re-handle synthetic keydowns.
      if (screen === "edit") {
        if (key === "Escape" || key === "`") {
          window.dispatchEvent(new CustomEvent(EDIT_CONTROL_EVENT, { detail: key }));
        }
        return;
      }

      // DRAWER overlay.
      if (screen === "drawer") {
        // Tab-strip cursor zone.
        if (cursorOnTabs) {
          if (key === "ArrowDown" || key === "Enter") {
            setCursorOnTabs(false);
            return;
          }
          if (key === "ArrowUp") return;
          if (key === "ArrowLeft" || key === "ArrowRight") {
            const idx = DRAWER_TABS.findIndex((t) => t.id === drawerTab);
            const delta = key === "ArrowRight" ? 1 : -1;
            const next =
              DRAWER_TABS[
                (idx + delta + DRAWER_TABS.length) % DRAWER_TABS.length
              ];
            setDrawerTab(next.id);
            return;
          }
          if (key === "Escape" || key === "`") {
            closeDrawer();
            return;
          }
          return;
        }

        // ArrowUp from the first row of the body → tab strip.
        if (key === "ArrowUp") {
          const atTop =
            (drawerTab === "settings" && selectedParam === 0) ||
            (drawerTab === "models" &&
              expandedModel === null &&
              selectedModelIndex === 0) ||
            (drawerTab === "stories" && selectedTreeIndex === 0);
          if (atTop) {
            setCursorOnTabs(true);
            return;
          }
        }

        // Model editor: START saves; SELECT closes the drawer entirely.
        if (drawerTab === "models" && expandedModel !== null) {
          if (key === "Escape") {
            void handleSubmitModel();
            return;
          }
          if (key === "`") {
            closeDrawer();
            return;
          }
          navigateModelEditor(key);
          return;
        }

        // Everywhere else in the drawer: START/SELECT close the drawer.
        if (key === "Escape" || key === "`") {
          closeDrawer();
          return;
        }

        if (drawerTab === "settings") {
          navigateSettings(key);
          return;
        }
        if (drawerTab === "stories") {
          navigateStories(key);
          return;
        }
        if (drawerTab === "models") {
          navigateModelsList(key);
          return;
        }
        return;
      }

      // Tree view: projection "loom" or "map".
      if (projection === "map") {
        if (key === "Backspace") {
          setLastMapNodeId(highlightedNode.id);
          setScreen("edit");
          return;
        }
        if (key === "`") {
          // SELECT from map opens the drawer on stories with cursor on
          // current story.  Return projection is "map" so closing restores
          // the map view.
          const currentIndex = Math.max(
            0,
            orderedKeys.indexOf(currentLoomId)
          );
          // +2: row 0 = Sort, row 1 = "+ New Story", rows 2+ = stories.
          setSelectedTreeIndex(currentIndex + 2);
          setSelectedTreeColumn(0);
          setLastMapNodeId(highlightedNode.id);
          openDrawer("stories");
          return;
        }
        if (key === "Escape") {
          setLastMapNodeId(highlightedNode.id);
          setProjection("loom");
          requestAnimationFrame(() => {
            queueScroll({
              nodeId: highlightedNode.id,
              reason: "mode-exit-map",
              priority: 90,
            });
          });
          return;
        }
        if (!(await handleStoryNavigation(key))) {
          triggerBonk(key);
        }
        return;
      }

      // projection === "loom"
      if (key === "`") {
        openDrawer("settings");
        return;
      }
      if (key === "Escape") {
        setProjection("map");
        return;
      }
      if (key === "Backspace") {
        setScreen("edit");
        return;
      }
      if (!(await handleStoryNavigation(key))) {
        triggerBonk(key);
      }
    },
    [
      closeDrawer,
      cursorOnTabs,
      currentLoomId,
      drawerTab,
      expandedModel,
      handleStoryNavigation,
      handleSubmitModel,
      highlightedNode,
      navigateModelEditor,
      navigateModelsList,
      navigateSettings,
      navigateStories,
      openDrawer,
      orderedKeys,
      projection,
      queueScroll,
      screen,
      selectedModelIndex,
      selectedParam,
      selectedTreeIndex,
      setDrawerTab,
      setScreen,
      setSelectedTreeColumn,
      setSelectedTreeIndex,
      triggerBonk,
    ]
  );

  const { activeControls, handleControlPress, handleControlRelease } =
    useKeyboardControls(handleControlAction);

  const containerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<"portrait" | "landscape">("portrait");

  useEffect(() => {
    const checkLayout = () => {
      if (containerRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        const aspectRatio = clientWidth / clientHeight;
        setLayout(aspectRatio >= 1.33 ? "landscape" : "portrait");
      }
    };

    // Use ResizeObserver for more efficient layout checks
    const resizeObserver = new ResizeObserver(checkLayout);
    const currentContainer = containerRef.current;

    if (currentContainer) {
      resizeObserver.observe(currentContainer);
      checkLayout(); // Initial check
    }

    return () => {
      if (currentContainer) {
        resizeObserver.unobserve(currentContainer);
      }
    };
  }, []);

  // Helper: scroll a specific rendered node into view within the story container
  const scrollNodeIntoView = useCallback(
    (nodeId: string | undefined | null) => {
      const container = storyTextRef.current;
      if (!container || !nodeId) return;
      const el = container.querySelector(
        `[data-node-id="${nodeId}"]`
      ) as HTMLElement | null;
      if (!el) return;
      // Use a small edge buffer, but only scroll when offscreen
      scrollElementIntoViewIfNeeded(container, el, 8, "smooth");
    },
    []
  );

  // True only when the loom view is the visible, unobstructed surface.
  const onLoom = screen === null && projection === "loom";

  // Scroll to current depth when navigation changes.  Center on the
  // cursor span (path[currentDepth + 1]) so the user's eye lands on the
  // highlighted text at the middle of the viewport, with context
  // flowing in above and preview flowing in below.  Falls back to
  // path[currentDepth] for the rare case of no next continuation.
  useEffect(() => {
    if (onLoom) {
      const path = getCurrentPath();
      const target = path[currentDepth + 1] ?? path[currentDepth];
      if (target) {
        queueScroll({
          nodeId: target.id,
          align: "center",
          reason: "nav-up-down",
          // Higher than nav-left-right so that when both effects fire
          // during a depth change (ArrowDown mutates both currentDepth
          // and selectedOptions), the center wins over the top-align.
          priority: 150,
        });
      }
    }
  }, [currentDepth, getCurrentPath, onLoom, scrollNodeIntoView]);

  // Scroll to selected sibling when left/right navigation changes
  useEffect(() => {
    if (onLoom) {
      const path = getCurrentPath();
      const next = path[currentDepth + 1];
      if (next) {
        queueScroll({
          nodeId: next.id,
          align: "top",
          reason: "nav-left-right",
          priority: 110,
        });
      }
    }
  }, [selectedOptions, getCurrentPath, onLoom, currentDepth, scrollNodeIntoView]);

  // Scroll to end when new content is added (after text splitting or generation)
  useEffect(() => {
    if (storyTextRef.current && !isAnyGenerating && onLoom) {
      const container = storyTextRef.current;
      const path = getCurrentPath();
      const wasAtBottom = isAtBottom(container);

      // If user was at bottom or near end, scroll to show new content
      if (wasAtBottom) {
        const last = path[path.length - 1];
        if (last) {
          queueScroll({
            nodeId: last.id,
            reason: "generation",
            priority: 50,
          });
        }
      }
    }
  }, [storyTree, isAnyGenerating, getCurrentPath]);

  // Removed LOOM scroll preservation to keep behavior simple and reliable

  const renderStoryText = () => {
    const currentPath = getCurrentPath();

    return (
      <div ref={storyTextRef} className="story-text">
        {currentPath.map((segment, index) => {
          const isCurrentDepth = index === currentDepth;
          const isNextDepth = index === currentDepth + 1;
          const isLoading = isGeneratingAt(segment.id);

          // Four coloration tiers, graded by distance from the cursor so the
          // eye lands on the highlighted continuation first but the whole
          // thread stays readable:
          //
          //   cursor-node  (D+1) — primary fill on inverted text; matches the
          //                        minimap's "selected" node exactly.  Styled
          //                        by .cursor-node in terminal.css.
          //   parent       (D)   — fullest normal text.
          //   ancestors    (<D)  — slightly less intense.
          //   descendants  (>D+1)— dimmest tier; will change if you regenerate
          //                        or move siblings.
          const spanClasses = ["story-node"];
          if (isNextDepth) {
            spanClasses.push("cursor-node");
          } else if (isCurrentDepth) {
            spanClasses.push("text-theme-text");
          } else if (index < currentDepth) {
            spanClasses.push("text-theme-text", "opacity-80");
          } else {
            spanClasses.push("text-theme-text", "opacity-55");
          }
          if (isLoading) {
            spanClasses.push("opacity-50");
          }

          // On the cursor span only, peel off trailing whitespace/newlines
          // so the pill hugs the last word rather than extending past
          // the paragraph.  The stripped whitespace still renders
          // inline so the next span's text starts correctly.
          if (isNextDepth) {
            const match = segment.text.match(/^([\s\S]*?)(\s*)$/);
            const body = match?.[1] ?? segment.text;
            const tail = match?.[2] ?? "";
            return (
              <span key={segment.id} data-node-id={segment.id}>
                <span className={spanClasses.join(" ")}>{body}</span>
                {tail}
              </span>
            );
          }
          return (
            <span
              key={segment.id}
              data-node-id={segment.id}
              className={spanClasses.join(" ")}
            >
              {segment.text}
            </span>
          );
        })}
      </div>
    );
  };

  return (
    <main
      className="gamepad-main bg-theme-bg text-theme-text font-mono"
      aria-label="Story Interface"
    >
      <InstallPrompt />
      <div
        ref={containerRef}
        className={`gamepad-container ${
          layout === "landscape" ? "landscape" : "portrait"
        }`}
      >
        {/* Screen area */}
        <section
          className={`terminal-screen${bonkDirection ? ` nav-bonk nav-bonk-${bonkDirection}` : ""}`}
          aria-label="Story Display"
        >
          {/* Unified top mode bar */}
          {(() => {
            const inModelEditor =
              screen === "drawer" &&
              drawerTab === "models" &&
              expandedModel !== null;
            let title = "";
            let hint = "";
            if (screen === "edit") {
              title = "EDIT";
              hint = "START: SAVE • SELECT: CANCEL";
            } else if (inModelEditor) {
              title = "EDIT MODEL";
              hint = "↵: EDIT FIELD • ⌫: BACK • START: SAVE";
            } else if (screen === "drawer") {
              if (cursorOnTabs) {
                title = "TABS";
                hint = "◄►: TAB • ↓: ROWS • START: CLOSE";
              } else if (drawerTab === "settings") {
                title = "SETTINGS";
                hint = "↵: CYCLE • ⌫: BACK • START: CLOSE";
              } else if (drawerTab === "stories") {
                title = "STORIES";
                hint = "↵: OPEN • ⌫: DELETE • START: CLOSE";
              } else if (drawerTab === "models") {
                title = "MODELS";
                hint = "↵: EDIT • ⌫: DELETE • START: CLOSE";
              }
            } else if (projection === "map") {
              title = "MAP";
              hint = "↵: GENERATE • ⌫: EDIT • START: LOOM • SELECT: CONFIG";
            } else {
              title = "LOOM";
              hint = "↵: GENERATE • ⌫: EDIT • START: MAP • SELECT: CONFIG";
            }
            return <ModeBar title={title} hint={hint} />;
          })()}
          {screen === "drawer" ? (
            <Drawer
              tab={drawerTab}
              setTab={setDrawerTab}
              cursorOnTabs={cursorOnTabs}
              onTabActivate={() => setCursorOnTabs(false)}
            >
              {drawerTab === "settings" ? (
                <MenuScreen>
                  <SettingsMenu
                    params={{
                      ...menuParams,
                      themeMode,
                      lightTheme,
                      darkTheme,
                      font,
                    }}
                    onParamChange={(param, value) => {
                      if (param === "themeMode") {
                        setThemeMode(value as ThemeMode);
                        return;
                      }
                      if (param === "lightTheme") {
                        setLightTheme(value as ThemeClass);
                        return;
                      }
                      if (param === "darkTheme") {
                        setDarkTheme(value as ThemeClass);
                        return;
                      }
                      if (param === "font") {
                        setFont(value as FontOption);
                        return;
                      }
                      setMenuParams((prev) => ({ ...prev, [param]: value }));
                    }}
                    selectedParam={cursorOnTabs ? -1 : selectedParam}
                    onSelectParam={(index) => {
                      setCursorOnTabs(false);
                      setSelectedParam(index);
                    }}
                    isLoading={isAnyGenerating}
                    models={models}
                    modelsLoading={modelsLoading}
                    modelsError={modelsError}
                    getModelName={getModelName}
                    fonts={availableFonts.map(({ id, label }) => ({ id, label }))}
                  />
                </MenuScreen>
              ) : drawerTab === "models" ? (
                expandedModel !== null ? (
                  <MenuScreen>
                    <ModelEditor
                      formState={modelForm}
                      fields={modelEditorFields}
                      selectedField={currentModelEditorField}
                      onSelectField={handleModelEditorHighlight}
                      onActivateField={handleModelEditorActivate}
                      onChange={handleModelFormChange}
                      onSubmit={handleSubmitModel}
                      onCancel={handleCancelModelEdit}
                      onDelete={
                        modelEditorMode === "edit" && editingModelId
                          ? () => {
                              void handleDeleteModel(editingModelId);
                            }
                          : undefined
                      }
                      mode={modelEditorMode}
                      isSaving={modelsSaving}
                      error={modelFormError}
                    />
                  </MenuScreen>
                ) : (
                  <MenuScreen>
                    <ModelsMenu
                      modelEntries={sortedModelEntries}
                      selectedIndex={cursorOnTabs ? -1 : selectedModelIndex}
                      sortOrder={modelSort}
                      onToggleSort={cycleModelSort}
                      onSelectIndex={(i) => {
                        setCursorOnTabs(false);
                        setSelectedModelIndex(i);
                      }}
                      onNew={handleStartNewModel}
                      onEditModel={handleEditModel}
                      isLoading={modelsLoading || modelsSaving}
                      error={modelsError ?? undefined}
                    />
                  </MenuScreen>
                )
              ) : drawerTab === "stories" ? (
                <MenuScreen>
                  <TreeListMenu
                    trees={trees}
                    storyTitles={storyTitles}
                    selectedIndex={cursorOnTabs ? -1 : selectedTreeIndex}
                    selectedColumn={selectedTreeColumn}
                    sortOrder={storySort}
                    onToggleSort={cycleStorySort}
                    onSelect={(key) => {
                      touchStoryActive(key);
                      setCurrentLoomId(key);
                      closeDrawer();
                      setSelectedTreeColumn(0);
                    }}
                    onNew={() => {
                      void handleNewTree();
                      setSelectedTreeColumn(0);
                    }}
                    onDelete={(key) => {
                      void handleDeleteTree(key);
                      if (selectedTreeIndex > 0) {
                        setSelectedTreeIndex((prev) =>
                          Math.min(prev, Object.keys(trees).length - 1)
                        );
                        setSelectedTreeColumn(0);
                      }
                    }}
                    onShareStory={(key) => {
                      void handleShareStory(key);
                    }}
                    onShareThread={(key) => {
                      void handleShareThread(key);
                    }}
                    onShareIndex={() => {
                      void handleShareIndex();
                    }}
                    onExportJson={handleExportTree}
                    onExportThread={handleExportThread}
                    onHighlight={handleStoryHighlight}
                  />
                </MenuScreen>
              ) : null}
            </Drawer>
          ) : projection === "map" && screen === null ? (
            <StoryMinimap
              tree={storyTree}
              currentDepth={currentDepth}
              selectedOptions={selectedOptions}
              currentPath={getCurrentPath()}
              inFlight={inFlight}
              generatingInfo={generatingInfo}
              onSelectNode={(path) => {
                setSelectionByPath(path);
                setProjection("loom");
                requestAnimationFrame(() => {
                  const last = path[path.length - 1];
                  if (last) {
                    queueScroll({
                      nodeId: last.id,
                      reason: "map-select",
                      priority: 90,
                    });
                  }
                });
              }}
              isVisible={projection === "map" && screen === null}
              lastMapNodeId={lastMapNodeId}
              currentNodeId={highlightedNode.id}
            />
          ) : screen === "edit" ? (
            <MenuScreen>
              <EditMenu
                node={getCurrentPath()[currentDepth]}
                onSave={async (text) => {
                  const splitRevision = menuParams.textSplitting
                    ? splitTextToDraft(text)
                    : null;
                  const revision = splitRevision ?? {
                    text,
                    continuations: [],
                  };
                  await saveCurrentNodeRevision(revision);
                  setScreen(null);

                  // Align to end of updated content after text splitting
                  requestAnimationFrame(() => {
                    const path = getCurrentPath();
                    const last = path[path.length - 1];
                    if (last) {
                      queueScroll({
                        nodeId: last.id,
                        reason: "edit-save",
                        priority: 60,
                      });
                    }
                  });
                }}
                onCancel={() => setScreen(null)}
              />
            </MenuScreen>
          ) : null}

          {/* Keep LOOM mounted; hide when a menu is active */}
          <div
            style={{ display: onLoom ? "flex" : "none" }}
            className="flex-1 flex flex-col min-h-0 overflow-hidden"
          >
            {renderStoryText()}
          </div>

          {/* Navigation bar - always visible at bottom of screen.
           *  In Loom:   sibling dots at current depth
           *  In Map:    (empty — StoryMinimap has its own minibuffer)
           *  In Drawer: current cursor context (tab / row label)
           *  In Edit:   (empty — overlay owns the whole screen)
           */}
          <div className="navigation-bar">
            {(() => {
              if (error) {
                return (
                  <span className="text-red-500 text-sm">
                    Error: {error.message}
                  </span>
                );
              }
              if (screen === "drawer") {
                const label = cursorOnTabs
                  ? "◄► tabs"
                  : drawerTab === "settings"
                    ? SETTINGS_ROW_LABELS[selectedParam] ?? ""
                    : drawerTab === "models"
                      ? expandedModel !== null
                        ? `Editing: ${
                            modelForm.name || modelForm.id || "new model"
                          }`
                        : selectedModelIndex === 0
                          ? "Sort"
                          : selectedModelIndex === 1
                            ? "+ New Model"
                            : sortedModelEntries[selectedModelIndex - 2]?.[1]
                                .name ?? ""
                      : drawerTab === "stories"
                        ? selectedTreeIndex === 0
                          ? "Sort"
                          : selectedTreeIndex === 1
                            ? "+ New Story"
                            : orderedKeys[selectedTreeIndex - 2] ?? ""
                        : "";
                return (
                  <span className="navbar-minibuffer" aria-live="polite">
                    {label}
                    {isOffline ? "  ⚡" : ""}
                  </span>
                );
              }
              if (screen === "edit") {
                return isOffline ? (
                  <span className="text-theme-focused text-sm">⚡ Offline</span>
                ) : null;
              }
              if (projection === "map") {
                // Map has its own minibuffer inside StoryMinimap; keep
                // the bottom strip empty to avoid duplicated status UI.
                return isOffline ? (
                  <span className="text-theme-focused text-xs">⚡</span>
                ) : null;
              }
              // LOOM
              return (
                <>
                  <NavigationDots
                    options={getOptionsAtDepth(currentDepth)}
                    currentDepth={currentDepth}
                    selectedOptions={selectedOptions}
                    activeControls={activeControls}
                    inFlight={inFlight}
                    generatingInfo={generatingInfo}
                  />
                  {isOffline && (
                    <span className="text-theme-focused text-xs ml-2">⚡</span>
                  )}
                </>
              );
            })()}
          </div>
        </section>

        {/* Controls */}
        <div className="gamepad-controls" aria-label="Game Controls">
          {/* Top row: D-pad and A/B buttons */}
          <div className="controls-top">
            <DPad
              activeDirection={activeControls.direction}
              onControlPress={handleControlPress}
              onControlRelease={handleControlRelease}
            />
            <div className="terminal-buttons">
              <GamepadButton
                label="⌫"
                active={activeControls.b}
                onMouseDown={() => handleControlPress("Backspace")}
                onMouseUp={() => handleControlRelease("Backspace")}
              />
              <GamepadButton
                label="↵"
                active={activeControls.a}
                onMouseDown={() => handleControlPress("Enter")}
                onMouseUp={() => handleControlRelease("Enter")}
                disabled={
                  isOffline ||
                  isGeneratingAt(getCurrentPath()[currentDepth]?.id)
                }
              />
            </div>
          </div>

          {/* Bottom row: Start/Select */}
          <div className="terminal-menu">
            <MenuButton
              label="SELECT"
              active={activeControls.select}
              onMouseDown={() => handleControlPress("`")}
              onMouseUp={() => handleControlRelease("`")}
            />
            <MenuButton
              label="START"
              active={activeControls.start}
              onMouseDown={() => handleControlPress("Escape")}
              onMouseUp={() => handleControlRelease("Escape")}
            />
          </div>
        </div>
      </div>
    </main>
  );
};

export default GamepadInterface;
