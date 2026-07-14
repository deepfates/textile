import type { Loom, Turn, TurnId } from "@deepfates/lync";
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
 * The read-layer view of a turn's `meta`: the provenance + role fields the
 * reader surfaces, widened PAST the story-specific role union so the SAME fold
 * reads a CONVERSATION loom (roles `"user"`/`"assistant"`) exactly as it reads a
 * story loom. `author`/`via`/`generatedBy` are the dee-9y0k provenance fields —
 * reused here, not reinvented, because provenance is first-class when reading a
 * multi-actor record.
 */
export interface ReadableTurnMeta {
  role?: string;
  author?: string;
  via?: string;
  generatedBy?: StoryGeneratedBy;
  revises?: TurnId;
}

/**
 * Any lync loom the reader can project — a story loom OR a non-story loom (a
 * conversation loom today; other shapes later). The payload is `unknown` on
 * purpose: `deriveTurnText` pulls display text from whichever field carries it
 * (`text` for story turns, `message` for conversation turns), so the reader is
 * not hardcoded to `StoryTurnPayload`. Story looms are assignable to this type.
 */
export type ReadableLoom = Loom<unknown, unknown, ReadableTurnMeta>;
type ReadableTurn = Turn<unknown, ReadableTurnMeta>;

/**
 * Derive a turn's displayable text WITHOUT assuming story shape. A story turn
 * carries `payload.text`; a conversation turn (what splice's
 * lync-claude-session emits, and what a hand-made conversation loom stamps)
 * carries `payload.message` — a string, or a structured Claude message whose
 * `content` holds the text. We read the first field that yields text.
 *
 * A payload with NO readable field is NOT silently blanked (that would hide a
 * shape the reader can't yet open): it throws, loud and specific, so an
 * unreadable loom surfaces instead of rendering empty turns.
 */
export function deriveTurnText(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const record = payload as { text?: unknown; message?: unknown };
    if (typeof record.text === "string") return record.text;
    if (typeof record.message === "string") return record.message;
    const fromMessage = textFromMessage(record.message);
    if (fromMessage !== null) return fromMessage;
  }
  throw new Error(
    "Turn payload has no readable text: expected a `text` (story) or " +
      "`message` (conversation) field.",
  );
}

/**
 * Pull text out of a structured message object (the real splice
 * lync-claude-session payload keeps the raw Claude `message`, whose `content`
 * is a string or an array of content blocks). String content wins; an array
 * concatenates its text blocks. Returns null when nothing text-like is found.
 */
function textFromMessage(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const record = message as { text?: unknown; content?: unknown };
  if (typeof record.text === "string") return record.text;
  const content = record.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object") {
          const text = (block as { text?: unknown }).text;
          if (typeof text === "string") return text;
        }
        return "";
      })
      .filter((part) => part.length > 0);
    if (parts.length > 0) return parts.join("");
  }
  return null;
}

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
 *   - `generatedBy` present            -> model
 *   - `role` is `"assistant"`          -> model (a conversation model turn)
 *   - `role` is `"user"`               -> human (a conversation person turn)
 *   - a person's `author` present      -> human
 *   - none of the above                -> unknown
 * The `role` rules read a CONVERSATION loom's origin from its explicit role,
 * not by absence — a story turn never carries `"user"`/`"assistant"`, so story
 * origins are unchanged. An unknowable turn reads "unknown", NEVER silent "human".
 */
function originFromMeta(meta: ReadableTurnMeta | undefined): StoryOrigin {
  if (meta?.generatedBy) return "model";
  if (meta?.role === "assistant") return "model";
  if (meta?.role === "user") return "human";
  if (meta?.author) return "human";
  return "unknown";
}

export async function projectStoryTree(
  loom: ReadableLoom,
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
    rootNode.text = deriveTurnText(latestRootRevision.payload);
  }

  const appendChildren = async (
    parent: StoryNode,
    parentTurn: ReadableTurn,
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

function turnToStoryNode(turn: ReadableTurn): StoryNode {
  const meta = turn.meta;
  return {
    id: turn.id,
    text: deriveTurnText(turn.payload),
    continuations: [],
    origin: originFromMeta(meta),
    actor: meta?.author,
    via: meta?.via,
    generatedBy: meta?.generatedBy,
  };
}
