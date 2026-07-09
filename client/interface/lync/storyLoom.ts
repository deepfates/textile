import { assertTextStoryTurn } from "lync-core/profiles/text-story";
import type { Turn } from "lync-core";
import type { StoryNode } from "../types";
import type {
  StoryDraft,
  StoryLoom,
  StoryTurnMeta,
  StoryTurnPayload,
} from "./storyTypes";

type StoryTurn = Turn<StoryTurnPayload, StoryTurnMeta>;

export async function projectStoryTree(
  loom: StoryLoom,
  fallbackRootText = "",
): Promise<{ root: StoryNode }> {
  const rootTurns = await loom.childrenOf(null);
  // Textile stories are single-root projections. Later top-level revision
  // turns edit the seed root's visible text without reparenting its children.
  const rootTurn = rootTurns.find((turn) => turn.meta?.role !== "revision");
  if (!rootTurn) {
    return {
      root: {
        id: "root",
        text: fallbackRootText,
        continuations: [],
      },
    };
  }

  const rootNode: StoryNode = turnToStoryNode(rootTurn);
  const rootRevisions = rootTurns.filter(
    (turn) => turn.meta?.role === "revision" && turn.meta.revises === rootTurn.id,
  );
  const latestRootRevision = rootRevisions.at(-1);
  if (latestRootRevision) {
    assertTextStoryTurn(latestRootRevision);
    rootNode.text = latestRootRevision.payload.text;
  }

  const appendChildren = async (
    parent: StoryNode,
    parentTurn: StoryTurn,
  ) => {
    const children = await loom.childrenOf(parentTurn.id);
    parent.continuations = children.map(turnToStoryNode);
    for (let index = 0; index < children.length; index += 1) {
      const child = parent.continuations[index];
      const childTurn = children[index];
      if (child && childTurn) {
        await appendChildren(child, childTurn);
      }
    }
  };

  await appendChildren(rootNode, rootTurn);
  return { root: rootNode };
}

export async function appendStoryDraftChain(
  loom: StoryLoom,
  parentId: string | null,
  draft: StoryDraft,
  meta: StoryTurnMeta = { role: "prose" },
): Promise<Turn<StoryTurnPayload, StoryTurnMeta>> {
  const appended = await loom.appendTurn(parentId, { text: draft.text }, meta);
  for (const child of draft.continuations ?? []) {
    await appendStoryDraftChain(loom, appended.id, child, { role: "prose" });
  }
  return appended;
}

export async function appendStoryRevision(
  loom: StoryLoom,
  parentId: string | null,
  revision: StoryDraft,
  revises?: string,
): Promise<Turn<StoryTurnPayload, StoryTurnMeta>> {
  if (parentId === null) {
    const appended = await loom.appendTurn(null, { text: revision.text }, {
      role: "revision",
      revises,
    });
    if (revises) {
      for (const child of revision.continuations ?? []) {
        await appendStoryDraftChain(loom, revises, child, { role: "prose" });
      }
    }
    return appended;
  }
  return appendStoryDraftChain(loom, parentId, revision, {
    role: "revision",
    revises,
  });
}

export async function appendStoryDrafts(
  loom: StoryLoom,
  parentId: string | null,
  drafts: StoryDraft[],
): Promise<void> {
  for (const draft of drafts) {
    await appendStoryDraftChain(loom, parentId, draft);
  }
}

function turnToStoryNode(turn: StoryTurn): StoryNode {
  assertTextStoryTurn(turn);
  return {
    id: turn.id,
    text: turn.payload.text,
    continuations: [],
  };
}
