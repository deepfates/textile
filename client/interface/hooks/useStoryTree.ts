import { useState, useCallback, useEffect, useRef } from "react";
import type { StoryNode, InFlight, GeneratingInfo } from "../types";
import { useStoryGeneration } from "./useStoryGeneration";
import type { ModelId } from "../../../shared/models";
import type { LengthMode } from "../../../shared/lengthPresets";
import {
  getDefaultStoryKey,
  getStoryMeta,
  type StoryMetaMap,
  touchStoryUpdated,
} from "../utils/storyMeta";
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
  getStoryIndex,
  importStoryReferenceFromUrl,
  listStoryEntries,
  openStoryLoom,
  removeStory,
  type StoryLoom,
  type StoryReferenceImport,
} from "../lync/storyRuntime";
import type { StoryDraft } from "../lync/storyTypes";

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

const AUTO_MODE_INFINITY_VALUE = 4;
const MAX_AUTO_MODE_ITERATIONS = 25;

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

interface StoryParams {
  temperature: number;
  lengthMode: LengthMode;
  model: ModelId;
  textSplitting: boolean;
  autoModeIterations: number;
}

type StoryIndexEntry = Awaited<ReturnType<typeof listStoryEntries>>[number];

export interface LoadedStoryEntries {
  loomsById: Record<string, StoryLoom>;
  trees: Record<string, { root: StoryNode }>;
  titles: Record<string, string>;
  orderedIds: string[];
  skippedIds: string[];
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
  const autoModeIterationsRef = useRef(params.autoModeIterations);

  const { generateContinuation, chooseContinuation, error } =
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

  const loadStoriesFromIndex = useCallback(async (focus?: StoryReferenceImport | null) => {
    const entries = await listStoryEntries();

    if (!entries.length) {
      const { info, loom } = await createStoryLoom(
        "Story 1",
        INITIAL_STORY.root.text,
      );
      const tree = await projectStoryTree(loom, INITIAL_STORY.root.text);
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
      INITIAL_STORY.root.text,
    );

    if (!loaded.orderedIds.length) {
      const { info, loom } = await createStoryLoom(
        "Story 1",
        INITIAL_STORY.root.text,
      );
      const tree = await projectStoryTree(loom, INITIAL_STORY.root.text);
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
      const nextTree = loaded.trees[nextKey] ?? INITIAL_STORY;
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
  }, []);

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

  useEffect(() => {
    autoModeIterationsRef.current = params.autoModeIterations;
  }, [params.autoModeIterations]);

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

  const autoExpandChildren = useCallback(
    async (
      loom: StoryLoom,
      baseTree: { root: StoryNode },
      parentPath: StoryNode[],
      generatedChildCount: number,
      depth: number,
      params: StoryParams,
    ) => {
      if (params.autoModeIterations <= 0) {
        return baseTree;
      }

      if (generatedChildCount <= 0) {
        return baseTree;
      }

      const resolvePath = (
        tree: { root: StoryNode },
        ids: string[],
      ): StoryNode[] | null => {
        if (!ids.length) return null;
        const path: StoryNode[] = [];
        let current: StoryNode | undefined = tree.root;
        if (!current) return null;
        path.push(current);
        if (ids[0] !== current.id) {
          return null;
        }
        for (let i = 1; i < ids.length; i++) {
          const nextId = ids[i];
          if (!current?.continuations) return null;
          const nextNode = current.continuations.find(
            (node) => node.id === nextId,
          );
          if (!nextNode) return null;
          current = nextNode;
          path.push(current);
        }
        return path;
      };

      const isInfiniteMode =
        params.autoModeIterations >= AUTO_MODE_INFINITY_VALUE;
      let iterationsRemaining = isInfiniteMode
        ? MAX_AUTO_MODE_ITERATIONS
        : params.autoModeIterations;
      let workingTree = baseTree;
      let currentDepth = depth;
      let currentPathIds = parentPath.map((node) => node.id);
      let currentChildIds: string[] = [];

      while (iterationsRemaining > 0) {
        if (
          isInfiniteMode &&
          autoModeIterationsRef.current < AUTO_MODE_INFINITY_VALUE
        ) {
          break;
        }
        const pathNodes = resolvePath(workingTree, currentPathIds);
        if (!pathNodes) break;

        const parentNode = pathNodes[pathNodes.length - 1];
        if (!parentNode?.continuations?.length) break;

        if (!currentChildIds.length) {
          currentChildIds = parentNode.continuations
            .slice(-generatedChildCount)
            .map((node) => node.id);
        }

        const candidateNodes = currentChildIds
          .map((id) =>
            parentNode.continuations?.find((node) => node.id === id) ?? null,
          )
          .filter((node): node is StoryNode => Boolean(node));

        if (!candidateNodes.length) {
          break;
        }

        const choiceIndex = await chooseContinuation(
          pathNodes,
          candidateNodes,
          params,
        );

        if (
          choiceIndex === null ||
          choiceIndex < 0 ||
          choiceIndex >= candidateNodes.length
        ) {
          break;
        }

        const selectedNode = candidateNodes[choiceIndex];
        if (!selectedNode) break;

        const selectedSiblingIndex =
          parentNode.continuations?.findIndex(
            (node) => node.id === selectedNode.id,
          ) ?? choiceIndex;
        setPreferredChildIndex(
          currentLoomId,
          parentNode.id,
          selectedSiblingIndex < 0 ? choiceIndex : selectedSiblingIndex,
        );

        // Align the user's explicit selection state with the model's choice so
        // subsequent navigation (e.g. pressing ArrowDown) follows the
        // auto-expanded branch instead of staying on the previously selected
        // sibling.
        setSelectedOptions((prev) => {
          const next = [...prev];
          if (next.length <= currentDepth) {
            const fillCount = currentDepth - next.length + 1;
            next.push(...Array(fillCount).fill(0));
          }
          next[currentDepth] =
            selectedSiblingIndex < 0 ? choiceIndex : selectedSiblingIndex;
          return next.slice(0, currentDepth + 1);
        });

        const selectedPathIds = [...currentPathIds, selectedNode.id];
        const selectedPath = resolvePath(workingTree, selectedPathIds);
        if (!selectedPath) break;

        const extendPathToLeaf = (path: StoryNode[]): StoryNode[] => {
          const extended = [...path];
          let current = extended[extended.length - 1];
          const seen = new Set<string>(extended.map((node) => node.id));
          while (
            current?.continuations &&
            current.continuations.length === 1
          ) {
            const next = current.continuations[0];
            if (!next || seen.has(next.id)) break;
            extended.push(next);
            seen.add(next.id);
            current = next;
          }
          return extended;
        };

        const leafPath = extendPathToLeaf(selectedPath);
        const targetNode = leafPath[leafPath.length - 1];
        if (!targetNode) break;

        if (targetNode.continuations?.length) {
          break;
        }

        const targetDepth = leafPath.length - 1;

        setInFlight((prev) => new Set(prev).add(targetNode.id));
        setGeneratingInfo((prev) => ({
          ...prev,
          [targetNode.id]: {
            depth: targetDepth,
            index: null,
          },
        }));

        let autoChildren: StoryDraft[] = [];
        try {
          autoChildren = await Promise.all(
            Array(3)
              .fill(null)
              .map(() =>
                generateContinuation(leafPath, targetDepth, params),
              ),
          );
        } catch (err) {
          console.error("Auto-mode generation failed:", err);
          break;
        } finally {
          setInFlight((prev) => {
            const newSet = new Set(prev);
            newSet.delete(targetNode.id);
            return newSet;
          });
          setGeneratingInfo((prev) => {
            const newInfo = { ...prev };
            delete newInfo[targetNode.id];
            return newInfo;
          });
        }

        await appendStoryDrafts(
          loom,
          targetNode.id,
          autoChildren,
        );
        workingTree = await refreshTreeFromLoom(currentLoomId, loom);

        const refreshedTargetPath = resolvePath(
          workingTree,
          leafPath.map((node) => node.id),
        );
        const refreshedTarget =
          refreshedTargetPath?.[refreshedTargetPath.length - 1];
        if (!refreshedTarget?.continuations?.length) break;

        currentPathIds = leafPath.map((node) => node.id);
        currentChildIds = refreshedTarget.continuations
          .slice(-autoChildren.length)
          .map((child) => child.id);
        currentDepth = targetDepth;
        iterationsRemaining -= 1;
      }

      return workingTree;
    },
    [
      chooseContinuation,
      generateContinuation,
      setSelectedOptions,
      setInFlight,
      setGeneratingInfo,
      currentLoomId,
      refreshTreeFromLoom,
    ],
  );

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
