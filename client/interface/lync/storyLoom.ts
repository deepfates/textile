import { assertTextStoryTurn } from "@deepfates/lync/profiles/text-story";
import type { Turn } from "@deepfates/lync";
import type { StoryNode, StoryOrigin } from "../types";
import type {
  StoryDraft,
  StoryGeneratedBy,
  StoryLoom,
  StoryTurnMeta,
  StoryTurnPayload,
} from "./storyTypes";

type StoryTurn = Turn<StoryTurnPayload, StoryTurnMeta>;

/**
 * Identity stamped into a turn's `meta` at append time. `actor`/`via` travel in
 * `meta` (not `event.body.author`) so they survive lync's buildFold. `generatedBy`
 * is present ONLY for model turns — its presence is what marks model origin.
 */
export interface StoryAuthorship {
  actor?: string;
  via?: string;
  generatedBy?: StoryGeneratedBy;
}

/** Fold identity into a turn's meta without inventing a parallel flag. */
function withAuthorship(
  meta: StoryTurnMeta,
  authorship?: StoryAuthorship,
): StoryTurnMeta {
  if (!authorship) return meta;
  const next: StoryTurnMeta = { ...meta };
  if (authorship.actor !== undefined) next.author = authorship.actor;
  if (authorship.via !== undefined) next.via = authorship.via;
  if (authorship.generatedBy !== undefined) next.generatedBy = authorship.generatedBy;
  return next;
}

/**
 * Derive origin EXPLICITLY from carried meta, never by absence alone:
 *   - `generatedBy` present  -> model
 *   - a person's `author` present (and no generatedBy) -> human
 *   - neither (old/imported turn with no identity) -> unknown
 * An unknowable turn reads "unknown", NEVER a silent "human".
 */
function originFromMeta(meta: StoryTurnMeta | undefined): StoryOrigin {
  if (meta?.generatedBy) return "model";
  if (meta?.author) return "human";
  return "unknown";
}

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
        origin: "unknown",
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
  authorship?: StoryAuthorship,
): Promise<Turn<StoryTurnPayload, StoryTurnMeta>> {
  const appended = await loom.appendTurn(
    parentId,
    { text: draft.text },
    withAuthorship(meta, authorship),
  );
  for (const child of draft.continuations ?? []) {
    // A child of a model draft is part of the same generation, so the same
    // authorship (including generatedBy) rides down the whole chain.
    await appendStoryDraftChain(loom, appended.id, child, { role: "prose" }, authorship);
  }
  return appended;
}

export async function appendStoryRevision(
  loom: StoryLoom,
  parentId: string | null,
  revision: StoryDraft,
  revises?: string,
  authorship?: StoryAuthorship,
): Promise<Turn<StoryTurnPayload, StoryTurnMeta>> {
  if (parentId === null) {
    const appended = await loom.appendTurn(
      null,
      { text: revision.text },
      withAuthorship({ role: "revision", revises }, authorship),
    );
    if (revises) {
      for (const child of revision.continuations ?? []) {
        await appendStoryDraftChain(loom, revises, child, { role: "prose" }, authorship);
      }
    }
    return appended;
  }
  return appendStoryDraftChain(
    loom,
    parentId,
    revision,
    { role: "revision", revises },
    authorship,
  );
}

export async function appendStoryDrafts(
  loom: StoryLoom,
  parentId: string | null,
  drafts: StoryDraft[],
  authorship?: StoryAuthorship,
): Promise<void> {
  for (const draft of drafts) {
    await appendStoryDraftChain(loom, parentId, draft, { role: "prose" }, authorship);
  }
}

function turnToStoryNode(turn: StoryTurn): StoryNode {
  assertTextStoryTurn(turn);
  const meta = turn.meta;
  return {
    id: turn.id,
    text: turn.payload.text,
    continuations: [],
    origin: originFromMeta(meta),
    actor: meta?.author,
    via: meta?.via,
    generatedBy: meta?.generatedBy,
  };
}
