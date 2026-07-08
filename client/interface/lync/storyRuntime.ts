import {
  createIndexedDbEventStore,
  createLoreLooms,
  createMemoryEventStore,
  referenceFromUrl,
  referenceToUrl,
  type LoomReference,
  type Looms,
  type TurnId,
} from "@lync/core";
import type { EventStore } from "@lync/core/lore/store";
import {
  isTextStoryLoomMeta,
  textStoryLoomMeta,
} from "@lync/core/profiles/text-story";
import { createLoomClient } from "@lync/client";
import { upsertLoom } from "@lync/index/entries";
import type { LoomIndex } from "@lync/index";
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
let syncSocket: WebSocket | null = null;
let syncReconnectTimer: ReturnType<typeof setTimeout> | null = null;
const syncListeners = new Set<() => void>();
let syncSnapshot: LyncSyncSnapshot = {
  state: "local-only",
  detail: "Sync starts when the browser runtime is ready.",
};

const INDEX_STORAGE_KEY = "textile-lync-v1-index-id";
const LORE_IMPORT_STORAGE_KEY = "textile-lync-v1-server-lore-imported";
const STORAGE_NAMESPACE = "textile-lync-v1";
const LORE_AUTHOR = { actor: "textile", via: "textile-browser" };
const SYNC_RECONNECT_MS = 2_500;

function getStoryClient() {
  client ??= (() => {
    const store =
      typeof window === "undefined"
        ? createMemoryEventStore()
        : createIndexedDbEventStore({
            dbName: STORAGE_NAMESPACE,
            indexedDB: window.indexedDB,
          });
    eventStore = store;
    return createLoomClient<
      StoryTurnPayload,
      StoryLoomMeta,
      StoryTurnMeta,
      StoryEntryMeta,
      { app: "textile" }
    >({
      looms: createLoreLooms<StoryTurnPayload, StoryLoomMeta, StoryTurnMeta>({
        store,
        author: LORE_AUTHOR,
      }),
      indexes: createLoreLoomIndexes<StoryEntryMeta, { app: "textile" }>({
        store,
        author: LORE_AUTHOR,
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

export function replaceStoryFocusUrl(
  loomId: string,
  turnId: string | null,
  location: Location = window.location,
) {
  if (typeof window === "undefined") return;
  const nextUrl = createStoryFocusShareUrl(loomId, turnId, location);
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
  await loom.appendTurn(null, { text: seedText }, { role: "prose" });
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

async function openLoomWithRetry(loomId: string): Promise<StoryLoom> {
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

  if (!("WebSocket" in window)) {
    emitLyncSyncEvent({
      type: "local-only",
      detail: "This browser cannot open the Lync relay.",
    });
    return;
  }

  const handleOffline = () => {
    clearLyncReconnect();
    closeLyncSocket();
    emitLyncSyncEvent({
      type: "local-only",
      detail: "Browser is offline; stories are local only.",
    });
  };
  const handleOnline = () => {
    connectLyncSocket();
  };
  window.addEventListener("offline", handleOffline);
  window.addEventListener("online", handleOnline);
  connectLyncSocket();
}

function connectLyncSocket() {
  if (typeof window === "undefined") return;
  if (window.location.protocol === "file:") {
    emitLyncSyncEvent({
      type: "local-only",
      detail: "No Lync relay is available from a local file.",
    });
    return;
  }
  if (window.navigator && !window.navigator.onLine) {
    emitLyncSyncEvent({
      type: "local-only",
      detail: "Browser is offline; stories are local only.",
    });
    return;
  }
  if (syncSocket && syncSocket.readyState !== WebSocket.CLOSED) return;

  clearLyncReconnect();
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${window.location.host}/lync`;
  emitLyncSyncEvent({ type: "connecting" });

  try {
    const socket = new WebSocket(url);
    syncSocket = socket;
    socket.addEventListener("open", () => {
      if (syncSocket !== socket) return;
      emitLyncSyncEvent({ type: "connected" });
    });
    socket.addEventListener("close", () => {
      if (syncSocket !== socket) return;
      syncSocket = null;
      emitLyncSyncEvent({ type: "disconnected" });
      scheduleLyncReconnect();
    });
    socket.addEventListener("error", () => {
      if (syncSocket !== socket) return;
      emitLyncSyncEvent({ type: "disconnected" });
    });
  } catch {
    syncSocket = null;
    emitLyncSyncEvent({ type: "disconnected" });
    scheduleLyncReconnect();
  }
}

function scheduleLyncReconnect() {
  if (typeof window === "undefined") return;
  if (window.navigator && !window.navigator.onLine) {
    emitLyncSyncEvent({
      type: "local-only",
      detail: "Browser is offline; stories are local only.",
    });
    return;
  }
  if (syncReconnectTimer) return;
  syncReconnectTimer = setTimeout(() => {
    syncReconnectTimer = null;
    connectLyncSocket();
  }, SYNC_RECONNECT_MS);
}

function clearLyncReconnect() {
  if (!syncReconnectTimer) return;
  clearTimeout(syncReconnectTimer);
  syncReconnectTimer = null;
}

function closeLyncSocket() {
  const socket = syncSocket;
  syncSocket = null;
  if (!socket || socket.readyState === WebSocket.CLOSED) return;
  socket.close();
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
    const loomId = `lore:${root.body.id}`;
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
