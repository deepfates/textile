import {
  createIndexedDbEventStore,
  createLyncLooms,
  createMemoryEventStore,
  referenceFromUrl,
  referenceToUrl,
  type LoomReference,
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
  if (!isTextStoryLoomMeta(info.meta)) {
    throw new Error("Reference does not point to a text-story loom");
  }
  await addStoryLoomToIndex(info.id, {
    title: info.meta?.title ?? "Shared Story",
  });
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
