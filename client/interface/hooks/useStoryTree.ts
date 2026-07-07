import { useState, useCallback, useEffect } from "react";
import type { StoryNode, InFlight, GeneratingInfo } from "../types";
import { useStoryGeneration } from "./useStoryGeneration";
import type { ModelId } from "../../../shared/models";
import type { LengthMode } from "../../../shared/lengthPresets";
import { touchStoryUpdated } from "../utils/storyMeta";
import {
  getPreferredChildIndex,
  setPreferredChildIndex,
} from "../lync/storySessionState";
import {
  appendStoryDrafts,
  appendStoryRevision,
  projectStoryTree,
} from "../lync/storyLoom";
import {
  createStoryLoom,
  removeStory,
  type StoryLoom,
} from "../lync/storyRuntime";
import type { StoryDraft } from "../lync/storyTypes";
import {
  chooseInitialStoryKey,
  loadReachableStoryEntries,
  useStoryCatalog,
  type LoadedStoryEntries,
} from "./useStoryCatalog";
import { useAutoStoryMode } from "../modes/useAutoStoryMode";

export {
  chooseInitialStoryKey,
  loadReachableStoryEntries,
  type LoadedStoryEntries,
};

export const INITIAL_STORY = {
  root: {
    id: "root",
    text: "Once upon a time, in Absalom,",
    continuations: [],
  },
};

const DEFAULT_TREES = {
  "Story 1": INITIAL_STORY,
};

const findPathById = (
  root: StoryNode,
  targetId: string,
  path: StoryNode[] = [root],
): StoryNode[] | null => {
  if (root.id === targetId) return path;
  for (const child of root.continuations ?? []) {
    const found = findPathById(child, targetId, [...path, child]);
    if (found) return found;
  }
  return null;
};

const threadToSelectionIndices = (path: StoryNode[]): number[] => {
  const indices: number[] = [];
  for (let i = 1; i < path.length; i += 1) {
    const parent = path[i - 1];
    const child = path[i];
    const index = parent.continuations?.findIndex((node) => node.id === child.id) ?? -1;
    if (index < 0) break;
    indices.push(index);
  }
  return indices;
};

export interface StoryParams {
  temperature: number;
  lengthMode: LengthMode;
  model: ModelId;
  textSplitting: boolean;
  autoModeIterations: number;
}

export function useStoryTree(params: StoryParams) {
  const [trees, setTrees] = useState(DEFAULT_TREES);
  const [loomsById, setLoomsById] = useState<Record<string, StoryLoom>>({});
  const [storyTitles, setStoryTitles] = useState<Record<string, string>>({});
  const [currentLoomId, setCurrentLoomId] = useState(
    () => Object.keys(trees)[0],
  );
  const [storyTree, setStoryTree] = useState<{ root: StoryNode }>(
    () => trees[currentLoomId],
  );
  const [currentDepth, setCurrentDepth] = useState(0);
  const [selectedOptions, setSelectedOptions] = useState<number[]>([0]);
  const [inFlight, setInFlight] = useState<InFlight>(new Set());
  const [generatingInfo, setGeneratingInfo] = useState<GeneratingInfo>({});

  const { generateContinuation, chooseContinuation, emptyGeneration, error } =
    useStoryGeneration();

  const refreshTreeFromLoom = useCallback(
    async (key: string, loom: StoryLoom) => {
      const tree = await projectStoryTree(
        loom,
        INITIAL_STORY.root.text,
      );
      setTrees((prev) => ({ ...prev, [key]: tree }));
      if (key === currentLoomId) setStoryTree(tree);
      return tree;
    },
    [currentLoomId],
  );

  useStoryCatalog({
    setLoomsById,
    setTrees,
    setStoryTitles,
    setCurrentLoomId,
    setStoryTree,
    setCurrentDepth,
    setSelectedOptions,
    fallbackTree: INITIAL_STORY,
    findPathById,
    threadToSelectionIndices,
  });

  useEffect(() => {
    const unsubs = Object.entries(loomsById).map(([key, loom]) =>
      loom.subscribe((event) => {
        if (event.type === "turn-added" || event.type === "loom-updated") {
          void refreshTreeFromLoom(key, loom);
        }
      }),
    );
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [loomsById, refreshTreeFromLoom]);

  // Helper to check if a specific node is generating
  const isGeneratingAt = useCallback(
    (nodeId: string) => inFlight.has(nodeId),
    [inFlight],
  );

  // Helper to check if any generation is in progress
  const isAnyGenerating = inFlight.size > 0;

  useEffect(() => {
    setStoryTree(trees[currentLoomId] || INITIAL_STORY);
  }, [trees, currentLoomId]);

  // Helper to get the last selected index for a node
  const getLastSelectedIndex = useCallback(
    (node: StoryNode, defaultIndex: number) => {
      return getPreferredChildIndex(
        currentLoomId,
        node.id,
        node.continuations?.length ?? 0,
        defaultIndex,
      );
    },
    [currentLoomId],
  );

  const getOptionsAtDepth = useCallback(
    (depth: number): StoryNode[] => {
      if (depth === 0) return storyTree.root.continuations || [];

      let currentNode = storyTree.root;
      for (let i = 0; i < depth - 1; i++) {
        if (!currentNode.continuations?.[selectedOptions[i]]) return [];
        currentNode = currentNode.continuations[selectedOptions[i]];
      }

      return (
        currentNode.continuations?.[selectedOptions[depth - 1]]
          ?.continuations || []
      );
    },
    [storyTree, selectedOptions],
  );

  const getCurrentPath = useCallback((): StoryNode[] => {
    const path = [storyTree.root];
    let currentNode = storyTree.root;

    // First follow the selected options
    for (let i = 0; i < selectedOptions.length; i++) {
      const nextNode = currentNode.continuations?.[selectedOptions[i]];
      if (!nextNode) break;
      path.push(nextNode);
      currentNode = nextNode;
    }

    // Then continue following session-preferred children until we hit a leaf.
    while (currentNode.continuations?.length) {
      const index = getLastSelectedIndex(currentNode, 0);
      const nextNode = currentNode.continuations[index];
      if (!nextNode) break;
      path.push(nextNode);
      currentNode = nextNode;
    }

    return path;
  }, [storyTree, selectedOptions, getLastSelectedIndex]);

  const updatePreferredChildIndex = useCallback(
    (path: StoryNode[], depth: number, index: number) => {
      let current = storyTree.root;

      // Navigate to the node at the specified depth using the path directly
      for (let i = 1; i <= depth; i++) {
        const pathNode = path[i];
        if (!pathNode) break;
        // Find the matching continuation
        const continuationIndex =
          current.continuations?.findIndex((node) => node.id === pathNode.id) ??
          -1;
        if (continuationIndex === -1) break;
        current = current.continuations![continuationIndex];
      }

      setPreferredChildIndex(currentLoomId, current.id, index);
    },
    [storyTree, currentLoomId],
  );

  const generateContinuations = useCallback(
    async (count: number): Promise<StoryDraft[]> => {
      const currentPath = getCurrentPath();

      const results = await Promise.all(
        Array(count)
          .fill(null)
          .map(async () => {
            // generateContinuation now returns a node chain (head node)
            return await generateContinuation(
              currentPath,
              currentDepth,
              params,
            );
          }),
      );
      return results;
    },
    [getCurrentPath, currentDepth, params, generateContinuation],
  );

  const autoExpandChildren = useAutoStoryMode({
    autoModeIterations: params.autoModeIterations,
    chooseContinuation,
    generateContinuation,
    currentLoomId,
    refreshTreeFromLoom,
    setSelectedOptions,
    setInFlight,
    setGeneratingInfo,
  });

  const saveCurrentNodeRevision = useCallback(
    async (revision: StoryDraft) => {
      const loom = loomsById[currentLoomId];
      if (!loom) throw new Error(`Missing story loom: ${currentLoomId}`);

      const currentPath = getCurrentPath();
      const currentNode = currentPath[currentDepth];
      if (!currentNode) return;

      const parentNode = currentPath[currentDepth - 1];
      const parentId = parentNode?.id ?? null;

      const appended = await appendStoryRevision(
        loom,
        parentId,
        revision,
        currentNode.id,
      );
      const updatedTree = await refreshTreeFromLoom(currentLoomId, loom);
      touchStoryUpdated(currentLoomId);

      if (parentId === null) {
        setCurrentDepth(0);
        setSelectedOptions([0]);
        return;
      }

      const updatedParent =
        (() => {
          const findNode = (node: StoryNode): StoryNode | null => {
            if (node.id === parentId) return node;
            for (const child of node.continuations ?? []) {
              const found = findNode(child);
              if (found) return found;
            }
            return null;
          };
          return findNode(updatedTree.root);
        })();
      const selectedIndex =
        updatedParent?.continuations?.findIndex(
          (child) => child.id === appended.id,
        ) ?? -1;
      if (updatedParent && selectedIndex >= 0) {
        setPreferredChildIndex(currentLoomId, updatedParent.id, selectedIndex);
        setSelectedOptions((prev) => {
          const next = [...prev];
          next[Math.max(0, currentDepth - 1)] = selectedIndex;
          return next.slice(0, Math.max(1, currentDepth));
        });
      }
    },
    [
      currentDepth,
      currentLoomId,
      getCurrentPath,
      refreshTreeFromLoom,
      loomsById,
      trees,
    ],
  );

  const handleStoryNavigation = useCallback(
    async (key: string): Promise<boolean> => {
      // Allow arrow/backspace navigation during generation, but prevent new
      // generations from the same node if it's already generating.
      const currentPath = getCurrentPath();
      const currentNode = currentPath[currentDepth];
      if (!currentNode) {
        setCurrentDepth(0);
        setSelectedOptions([0]);
        return true;
      }
      if (key === "Enter" && isGeneratingAt(currentNode.id)) return false;

      const options = getOptionsAtDepth(currentDepth);
      const currentOption = selectedOptions[currentDepth] ?? 0;

      switch (key) {
        case "ArrowUp":
          if (currentDepth <= 0) return false;
          setCurrentDepth((prev) => Math.max(0, prev - 1));
          return true;
        case "ArrowDown":
          if (currentDepth < currentPath.length - 1) {
            setCurrentDepth((prev) => prev + 1);
            const nextOptions = getOptionsAtDepth(currentDepth + 1);
            if (nextOptions.length > 0) {
              // Use session-preferred child selection when moving down.
              const currentNode = currentPath[currentDepth];
              const nextNode =
                currentNode.continuations?.[selectedOptions[currentDepth]];
              if (nextNode) {
                const lastIndex = getLastSelectedIndex(nextNode, 0);
                setSelectedOptions((prev) => {
                  const newOptions = [...prev];
                  newOptions[currentDepth + 1] = lastIndex;
                  // Keep only the options up to the current depth + 1
                  // This allows getCurrentPath to follow session preference
                  // for the rest of the thread.
                  return newOptions.slice(0, currentDepth + 2);
                });
              }
            }
            return true;
          }
          return false;
        case "ArrowLeft":
          if (options.length > 1 && currentOption > 0) {
            setSelectedOptions((prev) => {
              const newOptions = [...prev];
              newOptions[currentDepth] = currentOption - 1;
              return newOptions.slice(0, currentDepth + 1);
            });
            updatePreferredChildIndex(
              currentPath,
              currentDepth,
              currentOption - 1,
            );
            return true;
          }
          return false;
        case "ArrowRight":
          if (options.length > 1 && currentOption < options.length - 1) {
            setSelectedOptions((prev) => {
              const newOptions = [...prev];
              newOptions[currentDepth] = currentOption + 1;
              return newOptions.slice(0, currentDepth + 1);
            });
            updatePreferredChildIndex(
              currentPath,
              currentDepth,
              currentOption + 1,
            );
            return true;
          }
          return false;
        case "Enter": {
          if (error) return false;
          const loom = loomsById[currentLoomId];
          if (!loom) return false;

          const currentNode = currentPath[currentDepth];
          const hasExistingContinuations =
            currentNode.continuations?.length > 0;
          const count = hasExistingContinuations ? 1 : 3;

          // Add node to in-flight set and track generation info
          setInFlight((prev) => new Set(prev).add(currentNode.id));
          setGeneratingInfo((prev) => ({
            ...prev,
            [currentNode.id]: {
              depth: currentDepth,
              index: hasExistingContinuations
                ? (currentNode.continuations?.length ?? 0)
                : null,
            },
          }));

          try {
            const newContinuations = await generateContinuations(count);
            await appendStoryDrafts(
              loom,
              currentNode.id,
              newContinuations,
            );

            const parentPath = currentPath.slice(0, currentDepth + 1);
            let updatedTree = await refreshTreeFromLoom(currentLoomId, loom);

            if (!hasExistingContinuations && params.autoModeIterations > 0) {
              updatedTree = await autoExpandChildren(
                loom,
                updatedTree,
                parentPath,
                newContinuations.length,
                currentDepth,
                params,
              );
            }

            // Don't auto-jump to new nodes - let user navigate manually
            // The new nodes will be visible in the reader and minimap
            // but the cursor stays where it was

            // Update tree last to ensure all state is consistent
            setStoryTree(updatedTree);
            setTrees((prev) => ({
              ...prev,
              [currentLoomId]: updatedTree,
            }));
            // Mark story as updated for reverse-chronological ordering
            touchStoryUpdated(currentLoomId);
          } catch (e) {
            console.error("Generation failed:", e);
          } finally {
            // Remove node from in-flight set and clear generation info
            setInFlight((prev) => {
              const newSet = new Set(prev);
              newSet.delete(currentNode.id);
              return newSet;
            });
            setGeneratingInfo((prev) => {
              const newInfo = { ...prev };
              delete newInfo[currentNode.id];
              return newInfo;
            });
          }
          return true;
        }
      }
      return true;
    },
    [
      error,
      getCurrentPath,
      getOptionsAtDepth,
      currentDepth,
      selectedOptions,
      generateContinuations,
      autoExpandChildren,
      currentLoomId,
      loomsById,
      refreshTreeFromLoom,
      getLastSelectedIndex,
      updatePreferredChildIndex,
      isGeneratingAt,
      params,
    ],
  );

  return {
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
    trees,
    currentLoomId,
    storyTitles,
    currentLoomReady: Boolean(loomsById[currentLoomId]),
    setCurrentLoomId: (key: string) => {
      setCurrentLoomId(key);
      setStoryTree(trees[key] || INITIAL_STORY);
      setCurrentDepth(0);
      setSelectedOptions([0]);
    },
    createStory: async () => {
      const title = `Story ${Object.keys(trees).length + 1}`;
      const { info, loom } = await createStoryLoom(
        title,
        INITIAL_STORY.root.text,
      );
      setLoomsById((prev) => ({ ...prev, [info.id]: loom }));
      setStoryTitles((prev) => ({ ...prev, [info.id]: title }));
      const tree = await projectStoryTree(loom, INITIAL_STORY.root.text);
      setTrees((prev) => ({ ...prev, [info.id]: tree }));
      setCurrentLoomId(info.id);
      setStoryTree(tree);
      setCurrentDepth(0);
      setSelectedOptions([0]);
      return info.id;
    },
    deleteStory: async (key: string) => {
      await removeStory(key);
      setLoomsById((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setStoryTitles((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setTrees((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
    // Set selection state (currentDepth and selectedOptions) from a provided path.
    // Matches path IDs against current storyTree to compute indices.
    setSelectionByPath: (path: StoryNode[]) => {
      if (!path || path.length === 0) return;
      const indices: number[] = [];
      let current = storyTree.root;
      for (let i = 1; i < path.length; i++) {
        const target = path[i];
        const idx =
          current.continuations?.findIndex((n) => n.id === target.id) ?? -1;
        if (idx < 0) break;
        indices.push(idx);
        current = current.continuations![idx];
      }
      // Depth equals number of traversed indices
      setCurrentDepth(indices.length);
      // Keep at least one element for downstream logic
      setSelectedOptions(indices.length ? indices : [0]);
    },
    getCurrentPath,
    getOptionsAtDepth,
    saveCurrentNodeRevision,
  };
}
