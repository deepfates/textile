import { useCallback, useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { StoryNode } from "../types";
import {
  createStoryLoom,
  getStoryIndex,
  importStoryReferenceFromUrl,
  listStoryEntries,
  openStoryLoom,
  type StoryLoom,
  type StoryReferenceImport,
} from "../lync/storyRuntime";
import { projectStoryTree } from "../lync/storyLoom";
import {
  getDefaultStoryKey,
  getStoryMeta,
  type StoryMetaMap,
} from "../utils/storyMeta";

type StoryIndexEntry = Awaited<ReturnType<typeof listStoryEntries>>[number];

export interface LoadedStoryEntries {
  loomsById: Record<string, StoryLoom>;
  trees: Record<string, { root: StoryNode }>;
  titles: Record<string, string>;
  orderedIds: string[];
  skippedIds: string[];
}

interface UseStoryCatalogParams {
  setLoomsById: Dispatch<SetStateAction<Record<string, StoryLoom>>>;
  setTrees: Dispatch<SetStateAction<Record<string, { root: StoryNode }>>>;
  setStoryTitles: Dispatch<SetStateAction<Record<string, string>>>;
  setCurrentLoomId: Dispatch<SetStateAction<string>>;
  setStoryTree: Dispatch<SetStateAction<{ root: StoryNode }>>;
  setCurrentDepth: Dispatch<SetStateAction<number>>;
  setSelectedOptions: Dispatch<SetStateAction<number[]>>;
  fallbackTree: { root: StoryNode };
  findPathById: (root: StoryNode, targetId: string) => StoryNode[] | null;
  threadToSelectionIndices: (path: StoryNode[]) => number[];
}

export function chooseInitialStoryKey(
  loaded: Pick<LoadedStoryEntries, "trees" | "orderedIds">,
  previousKey?: string | null,
  focusedKey?: string | null,
  metaMap: StoryMetaMap = getStoryMeta(),
): string | null {
  if (focusedKey && loaded.trees[focusedKey]) return focusedKey;
  if (previousKey && loaded.trees[previousKey]) return previousKey;
  const defaultKey = getDefaultStoryKey(loaded.trees, metaMap);
  return defaultKey ?? loaded.orderedIds[0] ?? null;
}

export async function loadReachableStoryEntries(
  entries: StoryIndexEntry[],
  openLoom: (loomId: string) => Promise<StoryLoom>,
  fallbackRootText: string,
  onSkip: (loomId: string, error: unknown) => void = (loomId, error) => {
    console.warn(`Skipping unreachable story loom ${loomId}:`, error);
  },
): Promise<LoadedStoryEntries> {
  const trees: Record<string, { root: StoryNode }> = {};
  const loomsById: Record<string, StoryLoom> = {};
  const titles: Record<string, string> = {};
  const orderedIds: string[] = [];
  const skippedIds: string[] = [];

  for (const entry of entries) {
    const loomId = entry.ref.loomId;
    try {
      const loom = await openLoom(loomId);
      const info = await loom.info();
      loomsById[loomId] = loom;
      titles[loomId] =
        entry.title ?? entry.meta?.title ?? info.meta?.title ?? loomId;
      trees[loomId] = await projectStoryTree(loom, fallbackRootText);
      orderedIds.push(loomId);
    } catch (error) {
      skippedIds.push(loomId);
      onSkip(loomId, error);
    }
  }

  return { loomsById, trees, titles, orderedIds, skippedIds };
}

export function useStoryCatalog({
  setLoomsById,
  setTrees,
  setStoryTitles,
  setCurrentLoomId,
  setStoryTree,
  setCurrentDepth,
  setSelectedOptions,
  fallbackTree,
  findPathById,
  threadToSelectionIndices,
}: UseStoryCatalogParams) {
  const loadStoriesFromIndex = useCallback(async (focus?: StoryReferenceImport | null) => {
    const entries = await listStoryEntries();

    if (!entries.length) {
      const { info, loom } = await createStoryLoom(
        "Story 1",
        fallbackTree.root.text,
      );
      const tree = await projectStoryTree(loom, fallbackTree.root.text);
      setLoomsById({ [info.id]: loom });
      setTrees({ [info.id]: tree });
      setStoryTitles({ [info.id]: info.meta?.title ?? "Story 1" });
      setCurrentLoomId(info.id);
      setStoryTree(tree);
      return;
    }

    const loaded = await loadReachableStoryEntries(
      entries,
      openStoryLoom,
      fallbackTree.root.text,
    );

    if (!loaded.orderedIds.length) {
      const { info, loom } = await createStoryLoom(
        "Story 1",
        fallbackTree.root.text,
      );
      const tree = await projectStoryTree(loom, fallbackTree.root.text);
      setLoomsById({ [info.id]: loom });
      setTrees({ [info.id]: tree });
      setStoryTitles({ [info.id]: info.meta?.title ?? "Story 1" });
      setCurrentLoomId(info.id);
      setStoryTree(tree);
      setCurrentDepth(0);
      setSelectedOptions([0]);
      return;
    }

    setLoomsById(loaded.loomsById);
    setTrees(loaded.trees);
    setStoryTitles(loaded.titles);
    setCurrentLoomId((prev) => {
      const focusedKey = focus?.kind !== "index" ? focus?.loomId : null;
      const nextKey = chooseInitialStoryKey(loaded, prev, focusedKey)
        ?? loaded.orderedIds[0];
      const nextTree = loaded.trees[nextKey] ?? fallbackTree;
      setStoryTree(nextTree);
      let appliedFocus = false;
      if (focus?.kind !== "index" && focus?.turnId && loaded.trees[nextKey]) {
        const path = findPathById(nextTree.root, focus.turnId);
        if (path) {
          const indices = threadToSelectionIndices(path);
          setCurrentDepth(Math.max(0, path.length - 1));
          setSelectedOptions(indices.length ? indices : [0]);
          appliedFocus = true;
        }
      }
      if (!appliedFocus && nextKey !== prev) {
        setCurrentDepth(0);
        setSelectedOptions([0]);
      }
      return nextKey;
    });
  }, [
    findPathById,
    fallbackTree,
    setCurrentDepth,
    setCurrentLoomId,
    setLoomsById,
    setSelectedOptions,
    setStoryTitles,
    setStoryTree,
    setTrees,
    threadToSelectionIndices,
  ]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const imported = await importStoryReferenceFromUrl().catch((error) => {
        console.warn("Failed to import shared story reference from URL:", error);
        return null;
      });
      if (!cancelled) await loadStoriesFromIndex(imported);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadStoriesFromIndex]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      const index = await getStoryIndex();
      if (cancelled) return;
      unsubscribe = index.subscribe(() => {
        void loadStoriesFromIndex();
      });
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [loadStoriesFromIndex]);

  return { loadStoriesFromIndex };
}
