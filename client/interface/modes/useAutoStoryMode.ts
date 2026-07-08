import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { GeneratingInfo, InFlight, StoryNode } from "../types";
import { appendStoryDrafts } from "../lync/storyLoom";
import type { StoryLoom } from "../lync/storyRuntime";
import type { StoryDraft } from "../lync/storyTypes";
import { setPreferredChildIndex } from "../lync/storySessionState";
import type { StoryParams } from "../hooks/useStoryTree";

const AUTO_MODE_INFINITY_VALUE = 4;
const MAX_AUTO_MODE_ITERATIONS = 25;

interface UseAutoStoryModeParams {
  autoModeIterations: number;
  chooseContinuation: (
    path: StoryNode[],
    candidates: StoryNode[],
    params: StoryParams,
  ) => Promise<number | null>;
  generateContinuation: (
    path: StoryNode[],
    depth: number,
    params: StoryParams,
  ) => Promise<StoryDraft>;
  currentLoomId: string;
  refreshTreeFromLoom: (
    key: string,
    loom: StoryLoom,
  ) => Promise<{ root: StoryNode }>;
  setSelectedOptions: Dispatch<SetStateAction<number[]>>;
  setInFlight: Dispatch<SetStateAction<InFlight>>;
  setGeneratingInfo: Dispatch<SetStateAction<GeneratingInfo>>;
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

export function useAutoStoryMode({
  autoModeIterations,
  chooseContinuation,
  generateContinuation,
  currentLoomId,
  refreshTreeFromLoom,
  setSelectedOptions,
  setInFlight,
  setGeneratingInfo,
}: UseAutoStoryModeParams) {
  const autoModeIterationsRef = useRef(autoModeIterations);

  useEffect(() => {
    autoModeIterationsRef.current = autoModeIterations;
  }, [autoModeIterations]);

  return useCallback(
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
}
