import {
  duplicateLoomId,
  loomRef,
  unknownIndex,
  type IndexId,
  type LoomId,
  type LoomReference,
} from "@deepfates/lync";
import type { LyncEventBody } from "@deepfates/lync/events";
import type { EventStore, StoredEvent } from "@deepfates/lync/store";
import type {
  LoomIndex,
  LoomIndexEntry,
  LoomIndexEntryInput,
  LoomIndexEntryPatch,
  LoomIndexEvent,
  LoomIndexInfo,
  LoomIndexListener,
  LoomIndexes,
  LoomIndexSnapshot,
} from "@deepfates/lync/indexes";

type LoomOnlyReference = Extract<LoomReference, { kind: "loom" }>;

interface LoreIndexAuthor {
  actor: string;
  operator?: string;
  via?: string;
  imported_by?: string;
  source?: string;
}

interface LoreIndexOptions {
  store: EventStore;
  author: LoreIndexAuthor;
  now?: () => number;
  createId?: () => string;
}

interface IndexFold<TEntryMeta, TIndexMeta> {
  info: LoomIndexInfo<TIndexMeta>;
  entries: LoomIndexEntry<TEntryMeta>[];
}

const LORE_INDEX_PREFIX = "lore-index:";

export function createLoreLoomIndexes<TEntryMeta = unknown, TIndexMeta = unknown>(
  options: LoreIndexOptions,
): LoomIndexes<TEntryMeta, TIndexMeta> {
  validateAuthor(options.author);
  const now = options.now ?? (() => Date.now());
  const createId = options.createId ?? createUuidLike;

  const mint = (
    kind: string,
    parents: string[],
    payload: Record<string, unknown>,
    atMs = now(),
    author = options.author,
  ): LyncEventBody => ({
    v: 1,
    id: createId(),
    kind,
    at: new Date(atMs).toISOString(),
    author: compactAuthor(author),
    parents,
    payload,
  });

  return {
    async create(meta) {
      assertJsonEncodable(meta, "index meta");
      const event = mint("lync/index", [], omitUndefined({ meta: cloneJson(meta) }));
      const result = await options.store.append(event);
      if (result.status !== "added" && result.status !== "duplicate") {
        throw new Error(`Unable to create lore index: ${result.status}`);
      }
      return new LoreIndex<TEntryMeta, TIndexMeta>(
        `${LORE_INDEX_PREFIX}${result.event.body.id}`,
        result.event.body.id,
        options.store,
        mint,
        now,
      );
    },

    async open(indexId) {
      const root = rootId(indexId);
      if (!root) throw unknownIndex(indexId);
      const event = await options.store.byId(root);
      if (!event || event.body.kind !== "lync/index") throw unknownIndex(indexId);
      return new LoreIndex<TEntryMeta, TIndexMeta>(indexId, root, options.store, mint, now);
    },

    async import(snapshot) {
      validateSnapshot(snapshot);
      const index = await this.create(snapshot.index.meta);
      const internal = index as LoreIndex<TEntryMeta, TIndexMeta>;
      for (const entry of snapshot.entries) {
        await internal.addLoom(entry.ref, entry);
      }
      return index;
    },
  };
}

class LoreIndex<TEntryMeta, TIndexMeta> implements LoomIndex<TEntryMeta, TIndexMeta> {
  private closed = false;
  private readonly listeners = new Set<LoomIndexListener<TEntryMeta, TIndexMeta>>();
  private readonly unsubscribe: () => void;

  constructor(
    readonly id: IndexId,
    private readonly root: string,
    private readonly store: EventStore,
    private readonly mint: (
      kind: string,
      parents: string[],
      payload: Record<string, unknown>,
      atMs?: number,
    ) => LyncEventBody,
    private readonly now: () => number,
  ) {
    this.unsubscribe = store.subscribe(root, async (event) => {
      if (this.closed) return;
      if (event.body.kind === "lync/index-meta") {
        this.emit({ type: "index-updated", index: await this.info() });
      }
      if (event.body.kind === "lync/index-entry") {
        const entry = await this.get(String(event.body.payload.loomId));
        if (entry) this.emit({ type: "entry-updated", indexId: this.id, entry });
        else this.emit({ type: "entry-removed", indexId: this.id, loomId: String(event.body.payload.loomId) });
      }
    });
  }

  async info(): Promise<LoomIndexInfo<TIndexMeta>> {
    this.assertOpen();
    return cloneJson((await this.fold()).info);
  }

  async updateMeta(meta: TIndexMeta): Promise<LoomIndexInfo<TIndexMeta>> {
    this.assertOpen();
    assertJsonEncodable(meta, "index meta");
    const result = await this.store.append(
      this.mint("lync/index-meta", [this.root], { meta: cloneJson(meta) }),
    );
    if (result.status !== "added" && result.status !== "duplicate") {
      throw new Error(`Unable to update index meta: ${result.status}`);
    }
    return this.info();
  }

  async entries(): Promise<LoomIndexEntry<TEntryMeta>[]> {
    this.assertOpen();
    return cloneJson((await this.fold()).entries);
  }

  async get(loomId: LoomId): Promise<LoomIndexEntry<TEntryMeta> | null> {
    this.assertOpen();
    return cloneJson((await this.fold()).entries.find((entry) => entry.ref.loomId === loomId) ?? null);
  }

  async has(loomId: LoomId): Promise<boolean> {
    return (await this.get(loomId)) !== null;
  }

  async addLoom(
    ref: Extract<LoomReference, { kind: "loom" }>,
    entry: LoomIndexEntryInput<TEntryMeta> = {},
  ): Promise<LoomIndexEntry<TEntryMeta>> {
    this.assertOpen();
    assertJsonEncodable(entry, "index entry");
    if (await this.has(ref.loomId)) throw duplicateLoomId(ref.loomId);
    const ordinal = (await this.fold()).entries.length;
    const payload = entryPayload(ref, entry, this.now(), ordinal);
    await this.appendEntry(payload);
    const added = await this.get(ref.loomId);
    if (!added) throw new Error(`Added index entry missing from fold: ${ref.loomId}`);
    return added;
  }

  async updateLoom(
    loomId: LoomId,
    patch: LoomIndexEntryPatch<TEntryMeta>,
  ): Promise<LoomIndexEntry<TEntryMeta>> {
    this.assertOpen();
    assertJsonEncodable(patch, "index entry patch");
    const existing = await this.get(loomId);
    if (!existing) throw new Error(`Index does not contain loom: ${loomId}`);
    const payload = entryPayload(
      existing.ref,
      {
        ...existing,
        ...patch,
        meta: patch.meta === undefined ? existing.meta : patch.meta,
        updatedAt: patch.updatedAt ?? this.now(),
      },
      existing.addedAt,
      (await this.fold()).entries.findIndex((entry) => entry.ref.loomId === loomId),
    );
    await this.appendEntry(payload);
    const updated = await this.get(loomId);
    if (!updated) throw new Error(`Updated index entry missing from fold: ${loomId}`);
    return updated;
  }

  async removeLoom(loomId: LoomId): Promise<void> {
    this.assertOpen();
    if (!(await this.has(loomId))) return;
    await this.appendEntry({ loomId, removed: true, updatedAt: this.now() });
  }

  subscribe(listener: LoomIndexListener<TEntryMeta, TIndexMeta>): () => void {
    this.assertOpen();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async export(): Promise<LoomIndexSnapshot<TEntryMeta, TIndexMeta>> {
    this.assertOpen();
    const fold = await this.fold();
    return cloneJson({ index: fold.info, entries: fold.entries });
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
    this.unsubscribe();
  }

  private async appendEntry(payload: Record<string, unknown>): Promise<void> {
    const result = await this.store.append(this.mint("lync/index-entry", [this.root], payload));
    if (result.status !== "added" && result.status !== "duplicate") {
      throw new Error(`Unable to append index entry: ${result.status}`);
    }
  }

  private async fold(): Promise<IndexFold<TEntryMeta, TIndexMeta>> {
    return foldIndex<TEntryMeta, TIndexMeta>(await this.store.byRoot(this.root), this.id);
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("This loom index handle is closed");
  }

  private emit(event: LoomIndexEvent<TEntryMeta, TIndexMeta>): void {
    for (const listener of this.listeners) listener(event);
  }
}

function foldIndex<TEntryMeta, TIndexMeta>(
  events: StoredEvent[],
  indexId: IndexId,
): IndexFold<TEntryMeta, TIndexMeta> {
  const root = events.find((event) => event.body.kind === "lync/index" && `${LORE_INDEX_PREFIX}${event.body.id}` === indexId);
  if (!root) throw unknownIndex(indexId);
  const metaEvents = events.filter((event) => event.body.kind === "lync/index-meta").sort(compareNewest);
  const newestMeta = metaEvents.at(-1);
  const info = omitUndefined({
    id: indexId,
    meta: cloneJson((newestMeta ?? root).body.payload.meta as TIndexMeta),
    createdAt: Date.parse(root.body.at),
  });
  const byLoom = new Map<LoomId, LoomIndexEntry<TEntryMeta> | null>();
  const ordinals = new Map<LoomId, number>();
  for (const event of events.filter((item) => item.body.kind === "lync/index-entry").sort(compareNewest)) {
    const payload = event.body.payload;
    const loomId = String(payload.loomId);
    if (typeof payload.ordinal === "number" && !ordinals.has(loomId)) {
      ordinals.set(loomId, payload.ordinal);
    }
    if (payload.removed === true) {
      byLoom.set(loomId, null);
      continue;
    }
    const ref = isLoomReference(payload.ref) ? payload.ref : toLoomRef(loomId);
    byLoom.set(loomId, omitUndefined({
      ref,
      title: typeof payload.title === "string" ? payload.title : undefined,
      kind: typeof payload.entryKind === "string" ? payload.entryKind : undefined,
      meta: cloneJson(payload.meta as TEntryMeta),
      addedAt: typeof payload.addedAt === "number" ? payload.addedAt : Date.parse(event.body.at),
      updatedAt: typeof payload.updatedAt === "number" ? payload.updatedAt : undefined,
    }));
  }
  const entries = [...byLoom.entries()]
    .flatMap(([loomId, entry]) => entry === null ? [] : [{ loomId, entry }])
    .sort((a, b) => (ordinals.get(a.loomId) ?? 0) - (ordinals.get(b.loomId) ?? 0))
    .map(({ entry }) => entry);
  return { info, entries };
}

function entryPayload<TEntryMeta>(
  ref: Extract<LoomReference, { kind: "loom" }>,
  entry: LoomIndexEntryInput<TEntryMeta>,
  addedAt: number,
  ordinal: number,
) {
  return omitUndefined({
    loomId: ref.loomId,
    ref: cloneJson(ref),
    title: entry.title,
    entryKind: entry.kind,
    meta: cloneJson(entry.meta),
    addedAt,
    updatedAt: entry.updatedAt,
    ordinal,
  });
}

function rootId(id: IndexId): string | null {
  if (id.startsWith(LORE_INDEX_PREFIX)) return id.slice(LORE_INDEX_PREFIX.length);
  return null;
}

function compareNewest(a: StoredEvent, b: StoredEvent): number {
  return a.body.at.localeCompare(b.body.at) || a.body.id.localeCompare(b.body.id);
}

function toLoomRef(loomId: LoomId): LoomOnlyReference {
  return loomRef(loomId) as LoomOnlyReference;
}

function isLoomReference(value: unknown): value is LoomOnlyReference {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Partial<LoomReference>).kind === "loom" &&
    typeof (value as { loomId?: unknown }).loomId === "string"
  );
}

function validateSnapshot(snapshot: LoomIndexSnapshot<unknown, unknown>): void {
  if (!snapshot || typeof snapshot !== "object") throw new Error("Index snapshot must be an object");
  if (!snapshot.index || typeof snapshot.index.id !== "string") throw new Error("Index snapshot needs an id");
  if (!Array.isArray(snapshot.entries)) throw new Error("Index snapshot entries must be an array");
  assertJsonEncodable(snapshot, "index snapshot");
}

function validateAuthor(author: LoreIndexAuthor): void {
  if (!author || typeof author.actor !== "string" || author.actor.length === 0) {
    throw new Error("Lore author.actor is required");
  }
}

function compactAuthor(author: LoreIndexAuthor): LyncEventBody["author"] {
  return omitUndefined({
    actor: author.actor,
    operator: author.operator || undefined,
    via: author.via || undefined,
    imported_by: author.imported_by || undefined,
    source: author.source || undefined,
  });
}

function assertJsonEncodable(value: unknown, label: string): void {
  try {
    JSON.stringify(value);
  } catch (error) {
    throw new Error(`${label} must be JSON-encodable`, { cause: error });
  }
}

function cloneJson<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as T;
}

function createUuidLike(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}
