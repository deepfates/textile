import { useCallback, useRef, useEffect, useState, useMemo } from "react";
import type { ChangeEvent } from "react";

import { useKeyboardControls } from "./hooks/useKeyboardControls";
import { useMenuSystem } from "./hooks/useMenuSystem";
import { useStoryTree } from "./hooks/useStoryTree";
import { useConversationImport } from "./hooks/useConversationImport";
import { useOfflineStatus } from "./hooks/useOfflineStatus";
import { useScrollSync } from "./hooks/useScrollSync";
import { useModelCatalog } from "./hooks/useModelCatalog";
import { useResponsiveGamepadLayout } from "./hooks/useResponsiveGamepadLayout";

import { DPad } from "./components/DPad";
import { GamepadButton } from "./components/GamepadButton";
import { MenuButton } from "./components/MenuButton";
import { MenuScreen } from "./components/MenuScreen";
import { NavigationDots } from "./components/NavigationDots";
import { StoryText } from "./components/StoryText";
import { StoryMinimap } from "./components/StoryMinimap";
import { StoryForest } from "./components/StoryForest";
import { useTheme, THEME_PRESETS } from "./components/ThemeToggle";
import type {
  ThemeClass,
  ThemeMode,
  FontOption,
} from "./components/ThemeToggle";
import {
  ModelEditor,
} from "./components/ModelEditor";

import { SettingsMenu } from "./menus/SettingsMenu";
import { TreeListMenu } from "./menus/TreeListMenu";
import { ModelsMenu } from "./menus/ModelsMenu";
import { EditMenu, EDIT_CONTROL_EVENT } from "./menus/EditMenu";
import { ActionMenu, type MenuAction } from "./menus/ActionMenu";
import { InstallPrompt } from "./components/InstallPrompt";
import ModeBar from "./components/ModeBar";
import { Drawer, DRAWER_TABS } from "./components/Drawer";
import { splitTextToDraft } from "./utils/textSplitter";
import {
  scrollElementIntoViewIfNeeded,
  isAtBottom,
  scrollMenuItemElIntoView,
} from "./utils/scrolling";

import type { DrawerTab } from "./types";
import type { ModelId } from "../../shared/models";
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
  downloadKeptStoryJson,
  downloadRawLyncSelections,
  hasRawLyncSources,
  downloadStoryThreadText,
  downloadStoryTreeJson,
  getStoryPrimaryPath,
} from "./utils/storyExport";
import {
  createStoryIndexShareUrl,
  createStoryShareUrl,
  createStoryThreadShareUrl,
  importLyncOrConversationText,
  getStoryReferenceFromLocation,
  getStoryIndex,
  getLyncSyncSnapshot,
  subscribeLyncSyncStatus,
  getAuthorName,
  setAuthorName,
  getAuthorshipDisplay,
  setAuthorshipDisplay,
  hasLiveStoryClient,
  type LyncSyncSnapshot,
  type AuthorshipDisplay,
  type ImportedConversation,
} from "./lync/storyRuntime";
import { getRegisteredMode } from "./modes/modeRegistry";
import { AuthorshipIndicator } from "./components/AuthorshipIndicator";
import { CurationIndicator } from "./components/CurationIndicator";
import { RawLyncIndicator } from "./components/RawLyncIndicator";

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
  "Author Name",
  "Authorship",
];

// The focused-turn action set — the "second layer" contents, kept as DATA in a
// stable order so it drives both the ActionMenu (labels) and the key handler
// (cursor). Growing textile to act on other object types is another builder
// like this one; the ActionMenu primitive and the key handling stay put.
const TURN_ACTIONS = ["keep", "note", "edit"] as const;

// What ⌫ does on a focused turn in the loom. "menu" = menu-first (⌫ opens the
// action sheet; edit is a row inside it); "edit" = edit-first (⌫ jumps straight
// into the editor). The owner is still deciding which; flip this ONE constant
// to change the mapping — nothing else moves.
const BACKSPACE_ON_TURN = "menu" as "menu" | "edit";

// The FLOOR's per-loom action set. Same shape as TURN_ACTIONS — a stable order
// that drives both the ActionMenu labels and the key handler. "open" is
// redundant with A on the floor but stays so touch users who reached the menu
// still have it. Kept lowercase to match the turn menu.
const STORY_ACTIONS = ["open", "share", "export", "delete"] as const;
const STORY_ACTION_MENU: MenuAction[] = STORY_ACTIONS.map((id) => ({
  id,
  label: id,
}));

// The FLOOR's own action set (SELECT on the floor) — verbs on the archive
// itself, distinct from a loom's verbs (⌫). "sort" carries the live order so
// the label doubles as the current state.
const FLOOR_ACTIONS = ["new", "import", "sort", "share-index"] as const;

function floorMenuActions(sort: StorySortOption): MenuAction[] {
  return FLOOR_ACTIONS.map((id) => ({
    id,
    label:
      id === "new"
        ? "new loom"
        : id === "import"
          ? "import conversation"
          : id === "sort"
            ? `sort: ${sort}`
            : "share index",
  }));
}

/**
 * One parameterized action-overlay — "the one door to act on whatever you're
 * focused on." Every menu (turn / story / floor / delete-confirm) is just a
 * descriptor: the ActionMenu component and the d-pad handling stay put, only
 * the rows + what Enter does change. Actions are captured when the menu opens.
 */
interface Menu {
  /** Sheet title (e.g. "TURN", "LOOM ACTIONS", "FLOOR", 'DELETE "…"?'). */
  title: string;
  /** Sheet hint; defaults to the standard move/choose/close line. */
  hint?: string;
  actions: MenuAction[];
  onActivate: (index: number) => void;
  /** Starting cursor row (e.g. delete-confirm starts on "keep"). */
  initialCursor?: number;
}

const DEFAULT_MENU_HINT = "↕: MOVE • ↵: CHOOSE • START: CLOSE";

function buildTurnActions(node: { kept?: boolean } | undefined): MenuAction[] {
  return TURN_ACTIONS.map((id) => ({
    id,
    label: id === "keep" ? (node?.kept ? "un-keep" : "keep") : id,
  }));
}

function useLyncSyncIndicator(): LyncSyncSnapshot {
  const [status, setStatus] = useState(() => getLyncSyncSnapshot());

  useEffect(() => {
    const update = () => setStatus(getLyncSyncSnapshot());
    const unsubscribe = subscribeLyncSyncStatus(update);
    update();
    return unsubscribe;
  }, []);

  return status;
}

function LyncSyncIndicator({ status }: { status: LyncSyncSnapshot }) {
  const label =
    status.state === "connected"
      ? "Lync connected"
      : status.state === "reconnecting"
        ? "Lync reconnecting"
        : "Lync local-only";
  return (
    <span
      className={`lync-sync-status lync-sync-status--${status.state}`}
      aria-label={label}
      title={status.detail}
    >
      {label}
    </span>
  );
}

export const GamepadInterface = () => {
  const { isOnline, isOffline, wasOffline } = useOfflineStatus();
  const lyncSyncStatus = useLyncSyncIndicator();
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
  // The person's display name — their identity on shared looms. Persisted in
  // localStorage and read back by storyRuntime when it binds the lync author.
  const [authorName, setAuthorNameState] = useState<string>(() => getAuthorName());
  // How loudly authorship is surfaced in the reader. View-only (unlike the
  // author name it needs no reload), persisted per-browser. Default = ambient.
  const [authorshipDisplay, setAuthorshipDisplayState] =
    useState<AuthorshipDisplay>(() => getAuthorshipDisplay());
  const changeAuthorshipDisplay = useCallback((mode: AuthorshipDisplay) => {
    setAuthorshipDisplay(mode);
    setAuthorshipDisplayState(mode);
  }, []);

  const editAuthorName = useCallback(() => {
    const input = window.prompt(
      "Your name (how your turns are signed on shared stories)",
      authorName,
    );
    if (input === null) return;
    const trimmed = input.trim();
    if (trimmed === authorName) return;
    setAuthorName(trimmed);
    setAuthorNameState(trimmed);
    // lync binds the author when the story client is built, and the open loom
    // handles keep that author, so a name change only reaches new writes after
    // a reload. Say so plainly rather than silently signing turns with the old
    // name (the anon-id fallback keeps identities distinct meanwhile).
    if (hasLiveStoryClient()) {
      window.alert(
        trimmed
          ? `Saved. Reload to sign new turns as "${trimmed}".`
          : "Saved. Reload to sign new turns with your anonymous id.",
      );
    }
  }, [authorName]);

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
  const [projection, setProjection] = useState<"loom" | "map" | "bin">("loom");
  // "descend" only while the map was entered by dropping in from the floor, so
  // that map opens in the floor's frame (continuous handoff). Cleared whenever we
  // leave the map — the standalone map (START from loom) never sees it.
  const [mapEntry, setMapEntry] = useState<"descend" | null>(null);
  useEffect(() => {
    if (projection !== "map") setMapEntry(null);
  }, [projection]);
  // Cursor across stories on the "shelf" (projection === "bin"), and the cursor
  // in the per-story action menu (screen === "story-actions").
  const [selectedShelfIndex, setSelectedShelfIndex] = useState(0);
  // The active action-overlay (screen === "menu") and its cursor row. One door
  // for turn / story / floor / delete-confirm — opened via openMenu().
  const [menu, setMenu] = useState<Menu | null>(null);
  const [menuCursor, setMenuCursor] = useState(0);
  const openMenu = useCallback(
    (m: Menu) => {
      setMenuCursor(m.initialCursor ?? 0);
      setMenu(m);
      setScreen("menu");
    },
    [setScreen],
  );
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


  const [storySort, setStorySort] = useState<StorySortOption>("recent");
  const {
    models,
    modelsLoading,
    modelsError,
    modelsSaving,
    getModelName,
    modelSort,
    sortedModelEntries,
    modelOrder,
    modelForm,
    modelEditorMode,
    editingModelId,
    modelFormError,
    modelEditorFields,
    currentModelEditorField,
    cycleModelSort,
    handleModelFormChange,
    handleStartNewModel,
    handleEditModel,
    handleCancelModelEdit,
    handleDeleteModel,
    handleSubmitModel,
    handleModelEditorHighlight,
    handleModelEditorActivate,
    navigateModelsList,
    navigateModelEditor,
  } = useModelCatalog({
    currentModelId: menuParams.model,
    setMenuParams,
    setScreen,
    setDrawerTab,
    setExpandedModel,
    selectedModelIndex,
    setSelectedModelIndex,
    selectedModelField,
    setSelectedModelField,
  });

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
    emptyGeneration,
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
    keepCurrentNode,
    annotateCurrentNode,
  } = useStoryTree(menuParams);

  // Import raw `.lync` or a conversation snapshot two ways — drop a file anywhere,
  // or use the keyboard-reachable "Import Lync" action in the Stories drawer.
  // (d-pad → Enter opens the file picker). Both share one result path. Neither
  // adds a Stories row, so the base-model story flow + drawer row math are
  // untouched; the notice keeps success AND failure visible (NOTHING-SILENT).
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const showImportNotice = useCallback((message: string) => {
    setImportNotice(message);
    window.setTimeout(() => setImportNotice(null), 6000);
  }, []);
  const handleConversationImported = useCallback(
    (result: ImportedConversation) => {
      setCurrentLoomId(result.loomId);
      showImportNotice(
        `Imported "${result.title}" — ${result.turnCount} ${
          result.turnCount === 1 ? "turn" : "turns"
        }${
          result.kind === "raw-lync"
            ? ` · ${result.annotationCount ?? 0} annotations · ${result.diagnosticCount ?? 0} diagnostics`
            : ""
        }`,
      );
    },
    [setCurrentLoomId, showImportNotice],
  );
  const handleConversationImportError = useCallback(
    (error: unknown) =>
      showImportNotice(
        `Import failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    [showImportNotice],
  );
  useConversationImport({
    onImported: handleConversationImported,
    onError: handleConversationImportError,
  });

  // Hidden file input driven by the keyboard "Import Lync" action. The
  // action calls .click() to open the OS picker; the change handler runs the
  // SAME import path the drop hook uses. Reset value so re-picking the same file
  // fires change again.
  const conversationFileInputRef = useRef<HTMLInputElement>(null);
  const openConversationFilePicker = useCallback(() => {
    conversationFileInputRef.current?.click();
  }, []);
  const handleConversationFileChosen = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.target;
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;
      try {
        handleConversationImported(
          await importLyncOrConversationText(await file.text(), file.name),
        );
      } catch (error) {
        handleConversationImportError(error);
      }
    },
    [handleConversationImported, handleConversationImportError],
  );

  // Compute reverse-chronologically ordered trees for menus
  const orderedKeys = useMemo(
    () => orderKeysByStorySort(trees, storySort),
    [trees, storySort]
  );
  // Use orderedKeys directly where needed; no reordered trees object required

  // On first load, default to the most recently active story (if any)
  const hasAppliedDefault = useRef(false);

  useEffect(() => {
    if (hasAppliedDefault.current) return;
    if (getStoryReferenceFromLocation()) {
      hasAppliedDefault.current = true;
      return;
    }
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

  // The actual deletion — no confirmation. Callers own the confirm UX (the
  // drawer wraps it in window.confirm; the forest uses an in-idiom overlay).
  const performDeleteStory = useCallback(
    async (key: string) => {
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
    },
    [currentLoomId, deleteStory, trees, setCurrentLoomId]
  );

  const handleDeleteTree = useCallback(
    async (key: string) => {
      if (window.confirm(`Are you sure you want to delete "${key}"?`)) {
        await performDeleteStory(key);
      }
    },
    [performDeleteStory]
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

  const handleExportKept = useCallback(
    (key: string) => {
      const tree = trees[key];
      if (!tree) return;
      if (hasRawLyncSources(tree.root)) downloadRawLyncSelections(key, tree);
      else downloadKeptStoryJson(key, tree);
    },
    [trees]
  );

  // KEEP (the swipe): toggle the kept state of the current turn. Feedback rides
  // the shared minibuffer notice so the result is visible, never silent — and a
  // failure (no story yet) surfaces the same way.
  const handleKeepAction = useCallback(async () => {
    try {
      const kept = await keepCurrentNode();
      if (kept === null) return;
      showImportNotice(kept ? "Kept this turn ✓" : "Discarded (un-kept)");
    } catch (error) {
      showImportNotice(
        error instanceof Error ? error.message : "Could not keep this turn.",
      );
    }
  }, [keepCurrentNode, showImportNotice]);

  // ANNOTATE: open the in-idiom note overlay for the current turn — the same
  // text surface as EDIT, no native window.prompt. Reachable by touch (the
  // "note" row of the turn menu) and by the `n` accelerator.
  const openNote = useCallback(() => {
    setScreen("note");
  }, [setScreen]);

  const saveNote = useCallback(
    async (text: string) => {
      if (!text.trim()) {
        showImportNotice("Note was empty — nothing saved.");
        setScreen(null);
        return;
      }
      try {
        await annotateCurrentNode(text);
        showImportNotice("Note saved ✓");
      } catch (error) {
        showImportNotice(
          error instanceof Error ? error.message : "Could not save the note.",
        );
      }
      setScreen(null);
    },
    [annotateCurrentNode, showImportNotice, setScreen],
  );

  // Activate a row of the per-turn action menu by its stable action id.
  const activateTurnAction = useCallback(
    async (index: number) => {
      switch (TURN_ACTIONS[index]) {
        case "keep":
          await handleKeepAction();
          setScreen(null);
          break;
        case "note":
          setScreen("note");
          break;
        case "edit":
          setScreen("edit");
          break;
      }
    },
    [handleKeepAction, setScreen],
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

  const cycleStorySort = useCallback((_delta: -1 | 1 = 1) => {
    setStorySort((prev) => (prev === "recent" ? "oldest" : "recent"));
  }, []);

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
        "authorName",
        "authorshipDisplay",
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
        } else if (param === "authorName") {
          // Free text: only Enter opens the editor; ←→ do nothing.
          if (key === "Enter") editAuthorName();
        } else if (param === "authorshipDisplay") {
          const modes: AuthorshipDisplay[] = ["off", "ambient", "detail"];
          changeAuthorshipDisplay(wrap(modes, authorshipDisplay, dir));
        }
      }
    },
    [
      SETTINGS_PARAMS,
      authorshipDisplay,
      availableFonts,
      changeAuthorshipDisplay,
      editAuthorName,
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
      const columnTypes: Array<
        "story" | "share" | "thread-link" | "json" | "thread" | "kept"
      > = ["story", "share", "thread-link", "json", "thread", "kept"];
      // Rows 0 (Sort → Index link) and 1 (New Story → Import Lync)
      // each carry exactly one trailing action at column 1; stories (rows 2+)
      // carry the full sub-action set.
      const maxColumnFor = (index: number) =>
        index < baseOffset ? 1 : columnTypes.length - 1;
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
            if (selectedTreeColumn === 1) {
              openConversationFilePicker();
            } else {
              void handleNewTree();
              setSelectedTreeColumn(0);
            }
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
          } else if (columnTypes[selectedTreeColumn] === "kept") {
            handleExportKept(treeKey);
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
      handleExportKept,
      handleExportThread,
      handleExportTree,
      handleShareIndex,
      handleShareStory,
      handleNewTree,
      openConversationFilePicker,
      orderedKeys,
      scrollCurrentMenuItemIntoView,
      selectedTreeColumn,
      selectedTreeIndex,
      setCurrentLoomId,
      setSelectedTreeColumn,
      setSelectedTreeIndex,
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

  // Run one action from the shelf's per-story menu (screen === "story-actions").
  // Every branch reuses an existing story handler — the shelf just routes them
  // through the one ActionMenu door instead of the drawer's scattered columns.
  const activateStoryAction = useCallback(
    (index: number) => {
      const storyKey =
        orderedKeys[Math.min(selectedShelfIndex, orderedKeys.length - 1)];
      if (!storyKey) {
        setScreen(null);
        return;
      }
      switch (STORY_ACTIONS[index]) {
        case "open":
          touchStoryActive(storyKey);
          setCurrentLoomId(storyKey);
          setScreen(null);
          setProjection("loom");
          break;
        case "share":
          void handleShareStory(storyKey);
          setScreen(null);
          break;
        case "export":
          handleExportTree(storyKey);
          setScreen(null);
          break;
        case "delete":
          // Never delete the last story — mirror the drawer's guard. Open an
          // in-idiom confirmation (NOT a native dialog); default the cursor to
          // "keep" so a stray press can't delete.
          if (orderedKeys.length > 1) {
            openMenu({
              title: "DELETE LOOM?",
              hint: "↕: MOVE • ↵: CHOOSE • START: CANCEL",
              actions: [
                {
                  id: "delete",
                  label: `delete "${storyTitles[storyKey] ?? storyKey}"`,
                },
                { id: "keep", label: "keep it" },
              ],
              initialCursor: 1,
              onActivate: (i) => {
                if (i === 0 && orderedKeys.length > 1) {
                  void performDeleteStory(storyKey);
                }
                setScreen(null);
              },
            });
          } else {
            setScreen(null);
          }
          break;
      }
    },
    [
      orderedKeys,
      selectedShelfIndex,
      handleShareStory,
      handleExportTree,
      openMenu,
      performDeleteStory,
      storyTitles,
      setCurrentLoomId,
      setScreen,
      setProjection,
    ]
  );

  // Run one action from the FLOOR's menu (SELECT on the floor) — verbs on the
  // archive itself. All reuse the drawer's existing handlers, so the floor is a
  // complete home without the drawer's scattered 2-D action grid.
  const activateFloorAction = useCallback(
    (index: number) => {
      switch (FLOOR_ACTIONS[index]) {
        case "new":
          // Create + drop into the fresh loom, ready to write.
          void handleNewTree();
          setScreen(null);
          setProjection("loom");
          break;
        case "import":
          openConversationFilePicker();
          setScreen(null);
          break;
        case "sort":
          // Cycle the order and close, so the reshuffled floor is immediately
          // visible (staying open would just hide the row you're reordering).
          cycleStorySort(1);
          setScreen(null);
          break;
        case "share-index":
          void handleShareIndex();
          setScreen(null);
          break;
      }
    },
    [
      handleNewTree,
      openConversationFilePicker,
      cycleStorySort,
      handleShareIndex,
      setScreen,
      setProjection,
    ]
  );

  const handleControlAction = useCallback(
    async (key: string) => {
      // EDIT overlay — EditMenu owns keyboard via its own window listener.
      // Button taps reach it through a dedicated custom event so the global
      // keyboard hook does not recursively re-handle synthetic keydowns.
      if (screen === "edit" || screen === "note") {
        if (key === "Escape" || key === "`") {
          window.dispatchEvent(new CustomEvent(EDIT_CONTROL_EVENT, { detail: key }));
        }
        return;
      }

      // ACTION MENU — the one door (turn / story / floor / delete-confirm). The
      // active Menu descriptor supplies the rows and what Enter does; the d-pad
      // handling is identical for every menu, so it lives here once.
      if (screen === "menu" && menu) {
        const count = menu.actions.length;
        if (key === "ArrowUp") {
          setMenuCursor((i) => (i + count - 1) % count);
          return;
        }
        if (key === "ArrowDown") {
          setMenuCursor((i) => (i + 1) % count);
          return;
        }
        if (key === "Enter") {
          menu.onActivate(menuCursor);
          return;
        }
        if (key === "Escape" || key === "`" || key === "Backspace") {
          setScreen(null);
          return;
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
          navigateModelsList(key, scrollCurrentMenuItemIntoView);
          return;
        }
        return;
      }

      // FLOOR (projection === "bin"): every loom a sibling root on the dial.
      // ◄ ► dial the row (clamped — bonk at the ends), ↓ descends into the
      // bloomed tree (map), A/↵ reads it (loom), ⌫ opens its action menu,
      // ` acts on the floor itself, ↑ bonks (nothing above the floor). No k/n
      // curation here — there is no focused turn on the floor.
      if (projection === "bin") {
        const count = orderedKeys.length;
        if (count === 0) {
          if (key === "Escape") setProjection("loom");
          return;
        }
        const focused = () => orderedKeys[Math.min(selectedShelfIndex, count - 1)];
        // Left/right DIAL the row of sibling roots — the selected root stays
        // pinned to the center, the row slides beneath it. CLAMP (not wrap): a
        // loom keeps its position in the row (spatial memory — leftmost is always
        // leftmost), and dialing past an end bonks rather than lurching the whole
        // row across the seam.
        if (key === "ArrowLeft") {
          if (selectedShelfIndex <= 0) {
            triggerBonk(key);
            return;
          }
          setSelectedShelfIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (key === "ArrowRight") {
          if (selectedShelfIndex >= count - 1) {
            triggerBonk(key);
            return;
          }
          setSelectedShelfIndex((i) => Math.min(count - 1, i + 1));
          return;
        }
        // Down descends into the tree blooming beneath the selected root — stay
        // in the map, now flying THIS story.
        if (key === "ArrowDown") {
          const storyKey = focused();
          if (storyKey) {
            touchStoryActive(storyKey);
            setCurrentLoomId(storyKey);
            setMapEntry("descend");
            setProjection("map");
          }
          return;
        }
        // A reads it — drop into the loom.
        if (key === "Enter") {
          const storyKey = focused();
          if (storyKey) {
            touchStoryActive(storyKey);
            setCurrentLoomId(storyKey);
            setProjection("loom");
          }
          return;
        }
        if (key === "Backspace") {
          // ⌫ acts on the focused LOOM: open / share / export / delete.
          openMenu({
            title: "LOOM ACTIONS",
            actions: STORY_ACTION_MENU,
            onActivate: activateStoryAction,
          });
          return;
        }
        if (key === "Escape") {
          setProjection("loom");
          return;
        }
        if (key === "`") {
          // SELECT acts on the FLOOR itself: new / import / sort / share-index.
          openMenu({
            title: "FLOOR",
            actions: floorMenuActions(storySort),
            onActivate: activateFloorAction,
          });
          return;
        }
        // Up — nothing above the floor.
        triggerBonk(key);
        return;
      }

      // KEEP / ANNOTATE the current turn — the curation gestures. Available in
      // both tree projections (loom + map); they never navigate, so they sit
      // ahead of the projection-specific handling below.
      if (key === "k" || key === "K") {
        void handleKeepAction();
        return;
      }
      if (key === "n" || key === "N") {
        openNote();
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
          // Up past the root rises to the forest floor — the map's top zoom
          // level, where this tree becomes one root among its siblings.
          if (key === "ArrowUp" && currentDepth === 0) {
            setSelectedShelfIndex(Math.max(0, orderedKeys.indexOf(currentLoomId)));
            setProjection("bin");
            return;
          }
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
        // ⌫ acts on the focused TURN. Menu-first vs edit-first is an open
        // owner call — BACKSPACE_ON_TURN (top of file) is the one-line flip.
        if (BACKSPACE_ON_TURN === "edit") {
          setScreen("edit");
          return;
        }
        openMenu({
          title: "TURN",
          actions: buildTurnActions(getCurrentPath()[currentDepth]),
          onActivate: (i) => void activateTurnAction(i),
        });
        return;
      }
      if (!(await handleStoryNavigation(key))) {
        // Up past the top of a story rises onto the shelf — the root bin where
        // stories hang as siblings. The one inert loom gesture, repurposed.
        if (key === "ArrowUp" && currentDepth === 0) {
          setSelectedShelfIndex(Math.max(0, orderedKeys.indexOf(currentLoomId)));
          setProjection("bin");
          return;
        }
        triggerBonk(key);
      }
    },
    [
      activateStoryAction,
      activateTurnAction,
      closeDrawer,
      cursorOnTabs,
      currentDepth,
      currentLoomId,
      drawerTab,
      expandedModel,
      openNote,
      handleKeepAction,
      activateFloorAction,
      menu,
      menuCursor,
      openMenu,
      selectedShelfIndex,
      storySort,
      setCurrentLoomId,
      setMenuCursor,
      setProjection,
      setSelectedShelfIndex,
      getCurrentPath,
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

  const { containerRef, layout, portraitPhoneHeight } =
    useResponsiveGamepadLayout();

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
  // The action menu is a bottom SHEET overlaid on the view it acts on — the
  // loom / map / floor stays rendered and visible underneath, so you can still
  // see what you're acting on (owner ruling: overlay, don't replace).
  const sheetOpen = screen === "menu" && menu !== null;

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

  // The action sheet OVERLAYS the view instead of replacing it, so the mode
  // bar keeps narrating the view underneath (loom / map / floor) while the
  // sheet carries its own title + hint. Resolve the mode as if no menu is up.
  const currentMode = getRegisteredMode({
    screen: screen === "menu" ? null : screen,
    projection,
    drawerTab,
    cursorOnTabs,
    editingModel:
      screen === "drawer" && drawerTab === "models" && expandedModel !== null,
  });

  return (
    <main
      className="gamepad-main bg-theme-bg text-theme-text font-mono"
      aria-label="Story Interface"
      data-story-ready={currentLoomReady ? "true" : "false"}
    >
      <InstallPrompt />
      {/* Hidden picker for the keyboard "Import Lync" action. Off the
          keyboard grid; triggered by openConversationFilePicker(). */}
      <input
        ref={conversationFileInputRef}
        type="file"
        accept="application/x-lync+jsonl,.lync,.jsonl,application/json,.json"
        aria-hidden="true"
        tabIndex={-1}
        style={{ display: "none" }}
        onChange={handleConversationFileChosen}
        data-testid="import-conversation-input"
      />
      <div
        ref={containerRef}
        className={`gamepad-container ${
          layout === "landscape" ? "landscape" : "portrait"
        }${portraitPhoneHeight ? ` phone-height-${portraitPhoneHeight}` : ""}`}
      >
        {/* Screen area */}
        <section
          className={`terminal-screen${bonkDirection ? ` nav-bonk nav-bonk-${bonkDirection}` : ""}`}
          aria-label="Story Display"
        >
          {/* Unified top mode bar */}
          <ModeBar title={currentMode.title} hint={currentMode.hint} />
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
                      authorName,
                      authorshipDisplay,
                    }}
                    onEditAuthorName={editAuthorName}
                    onParamChange={(param, value) => {
                      if (param === "authorshipDisplay") {
                        changeAuthorshipDisplay(value as AuthorshipDisplay);
                        return;
                      }
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
                    currentStoryKey={currentLoomId}
                    storyMeta={getStoryMeta()}
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
                    onImportConversation={openConversationFilePicker}
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
                    onExportKept={handleExportKept}
                    onHighlight={handleStoryHighlight}
                  />
                </MenuScreen>
              ) : null}
            </Drawer>
          ) : projection === "map" && (screen === null || sheetOpen) ? (
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
              isVisible={projection === "map" && (screen === null || sheetOpen)}
              lastMapNodeId={lastMapNodeId}
              currentNodeId={highlightedNode.id}
              entry={mapEntry ?? undefined}
            />
          ) : projection === "bin" && (screen === null || sheetOpen) ? (
            <StoryForest
              // orderedKeys is derived from `trees`, so every id has a tree.
              stories={orderedKeys.map((id) => ({
                id,
                title: storyTitles[id] ?? id,
                tree: trees[id]!,
                isCurrent: id === currentLoomId,
              }))}
              selected={selectedShelfIndex}
              onFocus={(index) => setSelectedShelfIndex(index)}
              onDescend={(index) => {
                const storyKey = orderedKeys[index];
                if (storyKey) {
                  touchStoryActive(storyKey);
                  setCurrentLoomId(storyKey);
                  setMapEntry("descend");
                  // Descend into the tree that's blooming beneath the root —
                  // stay in the map, now flying THIS story.
                  setProjection("map");
                }
              }}
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
          ) : screen === "note" ? (
            <MenuScreen>
              <EditMenu
                node={getCurrentPath()[currentDepth]}
                initialText=""
                placeholder="Note for this turn…"
                onSave={saveNote}
                onCancel={() => setScreen(null)}
              />
            </MenuScreen>
          ) : null}

          {/* Keep LOOM mounted; hide under the full-screen overlays (edit /
              note / drawer) but stay VISIBLE under the bottom action sheet. */}
          <div
            style={{
              display:
                onLoom || (sheetOpen && projection === "loom")
                  ? "flex"
                  : "none",
            }}
            className="flex-1 flex flex-col min-h-0 overflow-hidden"
          >
            <StoryText
              storyTextRef={storyTextRef}
              currentPath={getCurrentPath()}
              currentDepth={currentDepth}
              isGeneratingAt={isGeneratingAt}
              authorshipDisplay={authorshipDisplay}
            />
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
                  <span className="text-red-500 text-sm" aria-live="polite">
                    {error.message}
                  </span>
                );
              }
              if (importNotice) {
                return (
                  <span className="navbar-minibuffer" aria-live="polite">
                    {importNotice}
                  </span>
                );
              }
              if (emptyGeneration) {
                return (
                  <span className="navbar-minibuffer" aria-live="polite">
                    {emptyGeneration.message}
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
                            ? selectedTreeColumn === 1
                              ? "Import Lync"
                              : "+ New Story"
                            : orderedKeys[selectedTreeIndex - 2] ?? ""
                        : "";
                return (
                  <span className="navbar-minibuffer" aria-live="polite">
                    {label}
                    {isOffline ? "  ⚡" : ""}
                  </span>
                );
              }
              if (screen === "edit" || screen === "menu" || screen === "note") {
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
            {onLoom &&
            projection === "loom" &&
            !error &&
            !importNotice &&
            !emptyGeneration ? (
              // Yield the strip to a transient notice ("Note saved ✓" etc.) — the
              // centered notice and this left-pinned cluster otherwise overlap.
              <div className="story-focus-cluster">
                <AuthorshipIndicator
                  node={getCurrentPath()[getCurrentPath().length - 1]}
                  mode={authorshipDisplay}
                />
                {/* KEEP/ANNOTATE act on the turn under the cursor
                    (path[currentDepth], same as EDIT), so its curation state is
                    narrated for THAT node — a property of focus, not chrome. */}
                <CurationIndicator node={getCurrentPath()[currentDepth]} />
                <RawLyncIndicator node={getCurrentPath()[currentDepth]} />
              </div>
            ) : null}
            {screen === null && projection === "map" ? (
              <div className="story-focus-cluster story-focus-cluster--map">
                <CurationIndicator node={highlightedNode} />
                <RawLyncIndicator node={highlightedNode} />
              </div>
            ) : null}
            <LyncSyncIndicator status={lyncSyncStatus} />
          </div>

          {/* ACTION SHEET — the one action-menu door, drawn as a drawer rising
              from the bottom edge by the controls. It OVERLAYS the loom / map /
              floor (still visible above it) instead of replacing the screen,
              and carries its own title + hint so the ModeBar keeps naming the
              view you were on. */}
          {sheetOpen && menu ? (
            <div
              className="action-sheet"
              role="dialog"
              aria-label={menu.title}
              data-testid="action-sheet"
            >
              <div className="action-sheet-bar">
                <strong className="action-sheet-title">{menu.title}</strong>
                <span className="action-sheet-hint">
                  {menu.hint ?? DEFAULT_MENU_HINT}
                </span>
              </div>
              <ActionMenu
                actions={menu.actions}
                selected={menuCursor}
                onSelect={(index) => menu.onActivate(index)}
                ariaLabel={menu.title}
              />
            </div>
          ) : null}
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
                ariaLabel="B button: go back"
                active={activeControls.b}
                onMouseDown={() => handleControlPress("Backspace")}
                onMouseUp={() => handleControlRelease("Backspace")}
              />
              <GamepadButton
                label="↵"
                ariaLabel="A button: choose"
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
              ariaLabel="Select button: open settings"
              active={activeControls.select}
              onMouseDown={() => handleControlPress("`")}
              onMouseUp={() => handleControlRelease("`")}
            />
            <MenuButton
              label="START"
              ariaLabel="Start button: switch stories"
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
