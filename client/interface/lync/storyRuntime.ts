import {
  createIndexedDbEventStore,
  createLyncLooms,
  createMemoryEventStore,
  referenceFromUrl,
  referenceToUrl,
  type LoomReference,
  type LoomSnapshot,
  type Looms,
  type TurnId,
} from "@deepfates/lync";
import type { EventStore } from "@deepfates/lync/store";
import { loomRootId } from "@deepfates/lync/looms";
import {
  createSyncedStore,
  createWebSocketTransport,
  type SyncStatus,
  type SyncTransport,
} from "@deepfates/lync/synced-store";
import {
  isTextStoryLoomMeta,
  textStoryLoomMeta,
} from "@deepfates/lync/profiles/text-story";
import { createLoomClient } from "@deepfates/lync/client";
import { upsertLoom } from "@deepfates/lync/indexes/entries";
import type { LoomIndex } from "@deepfates/lync/indexes";
import { createLoreLoomIndexes } from "./loreIndex";
import { projectRawLyncFile } from "./rawLync";
import type { RawLyncTag } from "../types";
import type {
  StoryEntryMeta,
  StoryLoom,
  StoryLoomMeta,
  StoryTurnMeta,
  StoryTurnPayload,
} from "./storyTypes";

export type { StoryEntryMeta, StoryLoom, StoryLoomMeta } from "./storyTypes";
export type StoryIndex = LoomIndex<StoryEntryMeta, { app: "textile" }>;
type LoomOnlyReference = Extract<LoomReference, { kind: "loom" }>;
export type StoryReferenceImport =
  | { kind: "index"; indexId: string }
  | { kind: "loom" | "turn" | "thread"; loomId: string; turnId?: TurnId };
export type LyncSyncState = "connected" | "reconnecting" | "local-only";
export type LyncSyncSnapshot = {
  state: LyncSyncState;
  detail: string;
};
export type LyncSyncEvent =
  | { type: "local-only"; detail: string }
  | { type: "connecting" }
  | { type: "connected" }
  | { type: "disconnected" };

type StoryClient = ReturnType<
  typeof createLoomClient<
    StoryTurnPayload,
    StoryLoomMeta,
    StoryTurnMeta,
    StoryEntryMeta,
    { app: "textile" }
  >
>;

let client: StoryClient | null = null;
let indexPromise: Promise<StoryIndex> | null = null;
let eventStore: EventStore | null = null;
let serverLoreImportPromise: Promise<void> | null = null;
let syncMonitorStarted = false;
const syncListeners = new Set<() => void>();
let syncSnapshot: LyncSyncSnapshot = {
  state: "local-only",
  detail: "Sync starts when the browser runtime is ready.",
};

const INDEX_STORAGE_KEY = "textile-lync-v1-index-id";
const LORE_IMPORT_STORAGE_KEY = "textile-lync-v1-server-lore-imported";
const STORAGE_NAMESPACE = "textile-lync-v1";
// The person's display name (identity) and a stable per-browser anonymous id
// used when no name is set. Identity is the PERSON; `via` (below) is the
// controller/software — the two are kept separate per the world charter.
const AUTHOR_NAME_STORAGE_KEY = "textile-lync-v1-author-name";
const ANON_AUTHOR_STORAGE_KEY = "textile-lync-v1-anon-author-id";
// How loudly authorship (human vs model) is surfaced in the reader. The taste
// call — does authorship ever touch the prose? — lives in this dial, not baked
// into the reading surface. Persisted per-browser like the author name.
const AUTHORSHIP_DISPLAY_STORAGE_KEY = "textile-lync-v1-authorship-display";
const LORE_VIA = "textile-browser";

/**
 * Resolve the person's `actor` identity: their display name if they set one,
 * otherwise the stable per-browser anonymous id. The anon id is REQUIRED so
 * two un-named browsers still produce distinguishable events — it is never a
 * shared constant.
 */
export function resolveAuthorActor(
  name: string | null | undefined,
  anonId: string,
): string {
  return (name?.trim() ?? "") || anonId;
}

/** Build a full lync author from a name + anon id. `via` is the controller. */
export function storyAuthorFor(
  name: string | null | undefined,
  anonId: string,
): { actor: string; via: string } {
  return { actor: resolveAuthorActor(name, anonId), via: LORE_VIA };
}

/**
 * The person's current authorship {actor, via} for stamping into turn `meta`.
 * Resolves the same identity lync binds at client construction, so `meta.author`
 * matches `event.body.author.actor` — but unlike the dropped event author, meta
 * survives buildFold to the read layer. `via` (controller) stays separate from
 * `actor` (person) per the world charter.
 */
export function getStoryAuthorship(): { actor: string; via: string } {
  return storyAuthorFor(getAuthorName(), anonAuthorId());
}

function generateAnonId(): string {
  const bytes = new Uint8Array(4);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return `anon-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** The stable per-browser anonymous id, minting and persisting one if absent. */
function anonAuthorId(): string {
  if (typeof window === "undefined") return generateAnonId();
  const existing = window.localStorage.getItem(ANON_AUTHOR_STORAGE_KEY);
  if (existing) return existing;
  const id = generateAnonId();
  window.localStorage.setItem(ANON_AUTHOR_STORAGE_KEY, id);
  return id;
}

/** The person's saved display name, or "" when unset. */
export function getAuthorName(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(AUTHOR_NAME_STORAGE_KEY)?.trim() ?? "";
}

/**
 * Persist the person's display name. lync binds the author at client
 * construction time, and the UI holds open loom handles bound to that author
 * (see useStoryTree's loomsById), so a live singleton reset would split writes
 * across two stores. The change therefore takes effect on the next reload; the
 * caller is responsible for telling the user so (NOTHING-SILENT). The anon-id
 * fallback keeps identities distinguishable in the meantime.
 */
export function setAuthorName(name: string): void {
  if (typeof window === "undefined") return;
  const trimmed = name.trim();
  if (trimmed) window.localStorage.setItem(AUTHOR_NAME_STORAGE_KEY, trimmed);
  else window.localStorage.removeItem(AUTHOR_NAME_STORAGE_KEY);
}

/**
 * How loudly the reader surfaces authorship (human vs model):
 *   off     — nothing shown; the not-seeing case, first-class.
 *   ambient — the quiet status-strip chip only; prose is UNTOUCHED (default).
 *   detail  — the louder mode; the only one that tints the prose.
 */
export type AuthorshipDisplay = "off" | "ambient" | "detail";

const AUTHORSHIP_DISPLAY_VALUES: AuthorshipDisplay[] = [
  "off",
  "ambient",
  "detail",
];

/** The saved authorship-display mode; defaults to "ambient" when unset. */
export function getAuthorshipDisplay(): AuthorshipDisplay {
  if (typeof window === "undefined") return "ambient";
  const raw = window.localStorage.getItem(AUTHORSHIP_DISPLAY_STORAGE_KEY);
  return AUTHORSHIP_DISPLAY_VALUES.includes(raw as AuthorshipDisplay)
    ? (raw as AuthorshipDisplay)
    : "ambient";
}

/** Persist the authorship-display mode. Takes effect immediately (view-only). */
export function setAuthorshipDisplay(mode: AuthorshipDisplay): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AUTHORSHIP_DISPLAY_STORAGE_KEY, mode);
}

/** Whether a story client has already been built (and its author bound). */
export function hasLiveStoryClient(): boolean {
  return client !== null;
}

function buildSyncTransport(): SyncTransport | null {
  if (typeof window === "undefined") return null;
  if (!("WebSocket" in window)) return null;
  if (window.location.protocol === "file:") return null;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return createWebSocketTransport(`${protocol}//${window.location.host}/lync`);
}

function getStoryClient() {
  client ??= (() => {
    const base =
      typeof window === "undefined"
        ? createMemoryEventStore()
        : createIndexedDbEventStore({
            dbName: STORAGE_NAMESPACE,
            indexedDB: window.indexedDB,
          });
    // In the browser, wrap the store in live sync: local appends push to the
    // relay and remote turns arrive through union, so looms and the index
    // update reactively. The transport owns connection and reconnect.
    const transport = buildSyncTransport();
    const store = transport
      ? createSyncedStore(base, transport, { onStatus: applySyncStatus })
      : base;
    eventStore = store;
    // Bind the author to the PERSON's identity (their name, else a stable
    // per-browser anon id) at construction time — lync captures it here.
    const author = storyAuthorFor(getAuthorName(), anonAuthorId());
    return createLoomClient<
      StoryTurnPayload,
      StoryLoomMeta,
      StoryTurnMeta,
      StoryEntryMeta,
      { app: "textile" }
    >({
      looms: createLyncLooms<StoryTurnPayload, StoryLoomMeta, StoryTurnMeta>({
        store,
        author,
      }),
      indexes: createLoreLoomIndexes<StoryEntryMeta, { app: "textile" }>({
        store,
        author,
      }),
      close: async () => {},
    });
  })();
  return client;
}

export function getStoryLooms(): Looms<
  StoryTurnPayload,
  StoryLoomMeta,
  StoryTurnMeta
> {
  return getStoryClient().looms;
}

export function reduceLyncSyncStatus(
  _current: LyncSyncSnapshot,
  event: LyncSyncEvent,
): LyncSyncSnapshot {
  switch (event.type) {
    case "local-only":
      return { state: "local-only", detail: event.detail };
    case "connected":
      return { state: "connected", detail: "Lync relay connected." };
    case "connecting":
      return { state: "reconnecting", detail: "Connecting to the Lync relay." };
    case "disconnected":
      return { state: "reconnecting", detail: "Lync relay unavailable; retrying." };
  }
}

export function getLyncSyncSnapshot(): LyncSyncSnapshot {
  return syncSnapshot;
}

export function subscribeLyncSyncStatus(listener: () => void): () => void {
  syncListeners.add(listener);
  startLyncSyncMonitor();
  return () => syncListeners.delete(listener);
}

export async function getStoryIndex(): Promise<StoryIndex> {
  indexPromise ??= (async () => {
    await importServerLoreIfNeeded();
    const storedId =
      typeof window === "undefined"
        ? null
        : window.localStorage.getItem(INDEX_STORAGE_KEY);
    if (storedId) {
      const opened = await openIndexWithRetry(storedId).catch(() => null);
      if (opened) {
        if (!(await opened.entries()).length) await addImportedLoreLoomsToIndex(opened);
        return opened;
      }
      window.localStorage.removeItem(INDEX_STORAGE_KEY);
    }
    const index = await getStoryClient().indexes.create({ app: "textile" });
    if (typeof window !== "undefined") {
      window.localStorage.setItem(INDEX_STORAGE_KEY, index.id);
    }
    await addImportedLoreLoomsToIndex(index);
    return index;
  })();
  return indexPromise;
}

export function createStoryIndexShareUrl(
  indexId: string,
  location: Location | URL = window.location,
) {
  return referenceToUrl(getStoryClient().references.index(indexId), location);
}

export function createStoryShareUrl(
  loomId: string,
  location: Location | URL = window.location,
) {
  return referenceToUrl(getStoryClient().references.loom(loomId), location);
}

export function createStoryThreadShareUrl(
  loomId: string,
  turnId: string,
  location: Location | URL = window.location,
) {
  return referenceToUrl(getStoryClient().references.thread(loomId, turnId), location);
}

export function createStoryFocusShareUrl(
  loomId: string,
  turnId: string | null,
  location: Location | URL = window.location,
) {
  return turnId
    ? createStoryThreadShareUrl(loomId, turnId, location)
    : createStoryShareUrl(loomId, location);
}

export function createLocalStoryUrl(location: Location | URL = window.location) {
  const url = new URL(location.href);
  url.searchParams.delete("ref");
  url.hash = "";
  return url.toString();
}

export function clearStoryReferenceUrl(location: Location = window.location) {
  if (typeof window === "undefined") return;
  const nextUrl = createLocalStoryUrl(location);
  const currentUrl = window.location.href;
  if (nextUrl !== currentUrl) {
    window.history.replaceState(window.history.state, "", nextUrl);
  }
}

export function getStoryReferenceFromLocation(location: Location | URL = window.location) {
  return referenceFromUrl(location);
}

export async function importStoryReferenceFromUrl(): Promise<StoryReferenceImport | null> {
  if (typeof window === "undefined") return null;
  const ref = getStoryReferenceFromLocation(window.location);
  if (!ref) return null;
  const opened = await openReferenceWithRetry(ref);

  if (opened.kind === "index") {
    window.localStorage.setItem(INDEX_STORAGE_KEY, opened.index.id);
    indexPromise = Promise.resolve(opened.index);
    return { kind: "index", indexId: opened.index.id };
  }

  const info = await opened.loom.info();
  // A shared ?ref= URL may point at a base-model STORY loom or a CONVERSATION
  // loom (turns authored by different actors) — textile reads both since #65.
  // Classify loudly: a genuinely-invalid ref (neither profile) still throws, so
  // nothing wrong opens silently; only VALID conversation looms stop being
  // rejected.
  const loomKind = classifyStoryReferenceMeta(info.meta);
  const sharedTitle =
    (info.meta as { title?: string } | null | undefined)?.title ??
    (loomKind === "conversation" ? "Shared conversation" : "Shared Story");
  if (loomKind === "conversation") {
    await registerConversationLoomInIndex(info.id, sharedTitle);
  } else {
    await addStoryLoomToIndex(info.id, { title: sharedTitle });
  }
  return {
    kind: opened.kind,
    loomId: info.id,
    turnId: opened.kind === "loom" ? undefined : opened.ref.turnId,
  };
}

export async function createStoryLoom(title: string, seedText: string) {
  const storyLooms = getStoryLooms();
  const info = await storyLooms.create(textStoryLoomMeta({ title }));
  const loom = await storyLooms.open(info.id);
  // The seed is human-typed: stamp the person's identity into meta (no
  // generatedBy), so the fold reads it as a human turn rather than "unknown".
  const authorship = getStoryAuthorship();
  await loom.appendTurn(null, { text: seedText }, {
    role: "prose",
    author: authorship.actor,
    via: authorship.via,
  });
  await addStoryLoomToIndex(info.id, { title });
  return { info, loom };
}

export async function addStoryLoomToIndex(
  loomId: string,
  meta: StoryEntryMeta,
): Promise<void> {
  await upsertLoom(await getStoryIndex(), storyLoomRef(loomId), {
    title: meta.title,
    kind: "story",
    meta,
  });
}

/* ------------------------- Conversation loom import ------------------------
 * The entry path that lets textile OPEN a conversation loom (what splice's
 * session→loom adapter emits) in the running app, not just read one in a test.
 * A conversation loom is a plain lync loom whose turns carry `payload.message`
 * + `meta.role`/`meta.author` — the generic reader (projectStoryTree) already
 * projects it. So opening one is three steps: import the snapshot's events into
 * textile's SAME event store, register the new loom in the story index (which
 * the catalog subscribes to), and let useStoryTree render it like any loom. No
 * presence, no story-flow change — a story loom is untouched by this path.
 */

/** A conversation turn's payload: the message, plus optional derived text. */
export interface ConversationTurnPayload {
  message: unknown;
  text?: string;
}
/** A conversation turn's meta: role + the actor (person or model id). */
export interface ConversationTurnMeta {
  role: string;
  author: string;
  via?: string;
  rawVirtual?: boolean;
  sourceId?: string;
  sourceKind?: string;
  sourceParents?: string[];
  extraParentIds?: string[];
  rawTags?: RawLyncTag[];
  sourceSelected?: boolean;
  sourceWarnings?: string[];
}
/** A conversation loom's own meta: marks the profile + carries a title. */
export interface ConversationLoomMeta {
  profile: "conversation";
  source?: string;
  sessionLocator?: string;
  title?: string;
}
export type ConversationLoomSnapshot = LoomSnapshot<
  ConversationTurnPayload,
  ConversationLoomMeta,
  ConversationTurnMeta
>;

/** A conversation loom is any lync loom whose meta marks `profile: "conversation"`. */
export function isConversationLoomMeta(
  meta: unknown,
): meta is ConversationLoomMeta {
  return (
    typeof meta === "object" &&
    meta !== null &&
    (meta as { profile?: unknown }).profile === "conversation"
  );
}

/**
 * Which kind of loom a shared reference points at. textile reads both a
 * base-model STORY loom and a CONVERSATION loom (since #65), so a share URL to
 * either must open. A ref that is NEITHER throws loud and specific — a garbage
 * or non-loom reference never opens as a blank/corrupt story (NOTHING-SILENT).
 */
export function classifyStoryReferenceMeta(
  meta: unknown,
): "story" | "conversation" {
  if (isTextStoryLoomMeta(meta)) return "story";
  if (isConversationLoomMeta(meta)) return "conversation";
  throw new Error(
    "Reference does not point to a readable loom (expected a text-story or conversation loom).",
  );
}

/**
 * Parse + VALIDATE a conversation-loom snapshot from JSON text (a file the
 * person drops in, or splice's `convertClaudeSessionToLoomFile` output). Every
 * malformed input throws loud and specific — NOTHING silently wrong is imported
 * (a story loom mis-dropped here, a truncated file, a non-conversation profile
 * all surface as an error the caller shows, never a blank or corrupt story).
 */
export function parseConversationSnapshot(text: string): ConversationLoomSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Not a conversation loom: invalid JSON (${
        error instanceof Error ? error.message : String(error)
      }).`,
    );
  }
  if (!raw || typeof raw !== "object") {
    throw new Error("Not a conversation loom: expected a snapshot object.");
  }
  const snapshot = raw as Partial<ConversationLoomSnapshot>;
  const loom = snapshot.loom;
  if (!loom || typeof loom !== "object" || typeof loom.id !== "string") {
    throw new Error("Not a conversation loom: snapshot.loom.id is missing.");
  }
  if (!Array.isArray(snapshot.turns)) {
    throw new Error("Not a conversation loom: snapshot.turns must be an array.");
  }
  const profile = (loom.meta as { profile?: unknown } | undefined)?.profile;
  if (profile !== undefined && profile !== "conversation") {
    throw new Error(
      `Not a conversation loom: profile is "${String(profile)}", expected "conversation".`,
    );
  }
  return snapshot as ConversationLoomSnapshot;
}

export interface ImportedConversation {
  loomId: string;
  title: string;
  turnCount: number;
  kind?: "conversation" | "raw-lync";
  annotationCount?: number;
  nonconformingCount?: number;
  warnings?: string[];
}

/**
 * Import a conversation-loom SNAPSHOT into the running app: replay its events
 * into textile's event store via the real Looms API, register the new loom in
 * the story index, and return its id so the caller can select it. The catalog
 * subscribes to the index, so the loom appears in the Stories list and opens
 * through useStoryTree exactly like a story loom — navigable, actor + message
 * per turn (rendered by the generic reader from PR #65).
 */
export async function importConversationLoom(
  snapshot: ConversationLoomSnapshot,
): Promise<ImportedConversation> {
  // The store is untyped at the event level; import persists JSON-encoded
  // payload/meta verbatim, so viewing the story Looms handle through the
  // conversation payload/meta types is sound (the reader is payload-agnostic).
  const looms = getStoryLooms() as unknown as Looms<
    ConversationTurnPayload,
    ConversationLoomMeta,
    ConversationTurnMeta
  >;
  const info = await looms.import(snapshot);
  const title = info.meta?.title ?? snapshot.loom.meta?.title ?? "Imported conversation";
  await registerConversationLoomInIndex(info.id, title);
  return { loomId: info.id, title, turnCount: snapshot.turns.length };
}

/**
 * Register an already-opened conversation loom in the story index with
 * `kind: "conversation"`, so the catalog lists it and the generic reader opens
 * it. Shared by the snapshot import path and the shared-URL open path.
 */
async function registerConversationLoomInIndex(
  loomId: string,
  title: string,
): Promise<void> {
  await upsertLoom(await getStoryIndex(), storyLoomRef(loomId), {
    title,
    kind: "conversation",
    meta: { title },
  });
}

/** Parse conversation-loom JSON text and import it in one step. */
export async function importConversationLoomText(
  text: string,
): Promise<ImportedConversation> {
  return {
    ...(await importConversationLoom(parseConversationSnapshot(text))),
    kind: "conversation",
  };
}

/** Project raw protocol events into Textile without changing their identity. */
export async function importRawLyncText(
  text: string,
  filename = "Imported Lync corpus",
): Promise<ImportedConversation> {
  const projection = projectRawLyncFile(text, filename);
  const imported = await importConversationLoom(projection.snapshot);
  return {
    ...imported,
    kind: "raw-lync",
    turnCount: projection.sourceEventCount,
    annotationCount: projection.annotationCount,
    nonconformingCount: projection.nonconformingCount,
    warnings: projection.warnings,
  };
}

/** File-aware import keeps snapshot JSON and raw `.lync` as distinct contracts. */
export async function importLyncOrConversationText(
  text: string,
  filename: string,
): Promise<ImportedConversation> {
  return /\.(lync|jsonl)$/i.test(filename)
    ? importRawLyncText(text, filename)
    : importConversationLoomText(text);
}

export async function listStoryEntries() {
  return (await getStoryIndex()).entries();
}

export async function openStoryLoom(loomId: string): Promise<StoryLoom> {
  return openLoomWithRetry(loomId);
}

export async function removeStory(loomId: string): Promise<void> {
  await (await getStoryIndex()).removeLoom(loomId);
}

// Opening a loom or index touches store.byId(root) before store.byRoot, and
// byId does not trigger sync — so a fresh context opening a SHARED reference
// would never pull that root from the relay. Kick off the sync explicitly so
// the retry loops below actually converge. Idempotent; a no-op on a local-only
// store (server render) or a root already synced.
function ensureRootSynced(root: string): void {
  // Building the client wires up the synced store and sets `eventStore`. A fresh
  // browser context can open a shared reference before any status subscriber has
  // constructed the client, so force it here — otherwise eventStore is still null
  // and the root never gets pulled from the relay.
  if (!eventStore) getStoryClient();
  const store = eventStore as (EventStore & { syncRoot?: (root: string) => void }) | null;
  store?.syncRoot?.(root);
}

function indexRootId(indexId: string): string {
  return indexId.startsWith("lore-index:") ? indexId.slice("lore-index:".length) : indexId;
}

async function openLoomWithRetry(loomId: string): Promise<StoryLoom> {
  ensureRootSynced(loomRootId(loomId));
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await getStoryClient().looms.open(loomId);
    } catch (error) {
      lastError = error;
      if (attempt < 7) await delay(250);
    }
  }
  throw lastError;
}

async function openIndexWithRetry(indexId: string): Promise<StoryIndex> {
  ensureRootSynced(indexRootId(indexId));
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await getStoryClient().indexes.open(indexId);
    } catch (error) {
      lastError = error;
      if (attempt < 7) await delay(250);
    }
  }
  throw lastError;
}

async function openReferenceWithRetry(ref: NonNullable<ReturnType<typeof referenceFromUrl>>) {
  // Sync the shared reference's root before opening so a fresh browser context
  // pulls it from the relay.
  if (ref.kind === "index") ensureRootSynced(indexRootId(ref.indexId));
  else ensureRootSynced(loomRootId(ref.loomId));
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await getStoryClient().openReference(ref);
    } catch (error) {
      lastError = error;
      if (attempt < 7) await delay(250);
    }
  }
  throw lastError;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emitLyncSyncEvent(event: LyncSyncEvent) {
  const next = reduceLyncSyncStatus(syncSnapshot, event);
  if (next.state === syncSnapshot.state && next.detail === syncSnapshot.detail) return;
  syncSnapshot = next;
  for (const listener of syncListeners) listener();
}

function applySyncStatus(status: SyncStatus) {
  if (status.connection === "online") emitLyncSyncEvent({ type: "connected" });
  else if (status.connection === "connecting") emitLyncSyncEvent({ type: "connecting" });
  else emitLyncSyncEvent({ type: "disconnected" });
}

function startLyncSyncMonitor() {
  if (syncMonitorStarted) return;
  syncMonitorStarted = true;
  if (typeof window === "undefined") {
    emitLyncSyncEvent({
      type: "local-only",
      detail: "Server rendering uses local Lync state only.",
    });
    return;
  }
  if (!("WebSocket" in window) || window.location.protocol === "file:") {
    emitLyncSyncEvent({
      type: "local-only",
      detail: "No Lync relay is available in this context.",
    });
    return;
  }
  // Constructing the client builds its synced store and transport; the
  // transport connects and reconnects on its own, and applySyncStatus keeps
  // the snapshot current.
  emitLyncSyncEvent({ type: "connecting" });
  getStoryClient();
}

async function importServerLoreIfNeeded(): Promise<void> {
  if (typeof window === "undefined") return;
  if (window.localStorage.getItem(LORE_IMPORT_STORAGE_KEY) === "1") return;
  serverLoreImportPromise ??= (async () => {
    if (!eventStore) getStoryClient();
    const store = eventStore;
    if (!store) return;
    const response = await fetch("/api/lync/lore", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    }).catch(() => null);
    if (!response?.ok) return;
    const payload = (await response.json()) as {
      files?: { file?: unknown; text?: unknown }[];
    };
    for (const file of payload.files ?? []) {
      if (typeof file.text !== "string") continue;
      for (const line of file.text.split("\n")) {
        if (line.trim()) await store.union(line);
      }
    }
    window.localStorage.setItem(LORE_IMPORT_STORAGE_KEY, "1");
  })();
  return serverLoreImportPromise;
}

async function addImportedLoreLoomsToIndex(index: StoryIndex): Promise<void> {
  const store = eventStore;
  if (!store) return;
  const roots = await store.roots("lync/loom");
  for (const root of roots) {
    const loomId = `lync:${root.body.id}`;
    const loom = await getStoryClient().looms.open(loomId).catch(() => null);
    const info = await loom?.info().catch(() => null);
    if (!info || !isTextStoryLoomMeta(info.meta)) continue;
    await upsertLoom(index, storyLoomRef(loomId), {
      title: info.meta?.title ?? loomId,
      kind: "story",
      meta: { title: info.meta?.title ?? loomId },
    });
  }
}

function storyLoomRef(loomId: string): LoomOnlyReference {
  return getStoryClient().references.loom(loomId) as LoomOnlyReference;
}
