import fs from "node:fs/promises";
import path from "node:path";
import {
  Repo,
  type Chunk,
  type RepoConfig,
  type StorageAdapterInterface,
  type StorageKey,
} from "@automerge/automerge-repo";
import {
  createAutomergeLooms,
  type AutomergeLoomsOptions,
} from "../../core/src/automerge";
import {
  createAutomergeLoomIndexes,
  type AutomergeLoomIndexesOptions,
} from "../../index/src/automerge";
import { createLoomClient } from "./create.js";
import {
  createWebSocketSyncAdapter,
  type WebSocketSyncOptions,
} from "./sync.js";
import type { LoomClient } from "./types.js";

export type {
  SyncAuth,
  SyncMode,
  SyncStatus,
  WebSocketSyncOptions,
} from "./sync.js";

export interface NodeLoomClientOptions<
  TPayload = unknown,
  TLoomMeta = unknown,
  TTurnMeta = unknown,
  TEntryMeta = unknown,
  TIndexMeta = unknown,
> {
  repo?: Repo;
  storageDir?: string | false;
  syncUrl?: string | false;
  sync?: false | WebSocketSyncOptions;
  websocket?: false | WebSocketSyncOptions;
  repoConfig?: Omit<RepoConfig, "network" | "storage">;
  looms?: Omit<AutomergeLoomsOptions, "repo">;
  indexes?: Omit<AutomergeLoomIndexesOptions, "repo">;
}

export function createNodeLoomClient<
  TPayload = unknown,
  TLoomMeta = unknown,
  TTurnMeta = unknown,
  TEntryMeta = unknown,
  TIndexMeta = unknown,
>(
  options: NodeLoomClientOptions<
    TPayload,
    TLoomMeta,
    TTurnMeta,
    TEntryMeta,
    TIndexMeta
  > = {},
): LoomClient<TPayload, TLoomMeta, TTurnMeta, TEntryMeta, TIndexMeta> {
  const repo = options.repo ?? createNodeRepo(options);
  const looms = createAutomergeLooms<TPayload, TLoomMeta, TTurnMeta>({
    ...options.looms,
    repo,
  });
  const indexes = createAutomergeLoomIndexes<TEntryMeta, TIndexMeta>({
    ...options.indexes,
    repo,
  });

  return createLoomClient({ repo, looms, indexes });
}

function createNodeRepo(options: NodeLoomClientOptions): Repo {
  const websocket = resolveWebSocketOptions(options);

  return new Repo({
    ...options.repoConfig,
    storage:
      options.storageDir === false
        ? undefined
        : new FileStorageAdapter(options.storageDir ?? ".lync"),
    network:
      websocket === false
        ? []
        : [createWebSocketSyncAdapter(websocket)],
  });
}

function resolveWebSocketOptions(
  options: NodeLoomClientOptions,
): false | WebSocketSyncOptions {
  return (
    options.sync ??
    options.websocket ??
    (options.syncUrl === undefined
      ? false
      : options.syncUrl === false
        ? false
        : { url: options.syncUrl })
  );
}

export class FileStorageAdapter implements StorageAdapterInterface {
  constructor(private readonly dir: string) {}

  async load(key: StorageKey): Promise<Uint8Array | undefined> {
    try {
      return toUint8Array(await fs.readFile(this.filePath(key)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async save(key: StorageKey, data: Uint8Array): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.filePath(key), data);
  }

  async remove(key: StorageKey): Promise<void> {
    try {
      await fs.unlink(this.filePath(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async loadRange(keyPrefix: StorageKey): Promise<Chunk[]> {
    await fs.mkdir(this.dir, { recursive: true });
    const prefix = this.keyToFilename(keyPrefix);
    const files = await fs.readdir(this.dir);
    return Promise.all(
      files
        .filter((file) => this.matchesPrefix(file, prefix))
        .map(async (file) => ({
          key: this.filenameToKey(file),
          data: toUint8Array(await fs.readFile(path.join(this.dir, file))),
        })),
    );
  }

  async removeRange(keyPrefix: StorageKey): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const prefix = this.keyToFilename(keyPrefix);
    const files = await fs.readdir(this.dir);
    await Promise.all(
      files
        .filter((file) => this.matchesPrefix(file, prefix))
        .map((file) => fs.unlink(path.join(this.dir, file))),
    );
  }

  private filePath(key: StorageKey) {
    return path.join(this.dir, this.keyToFilename(key));
  }

  private keyToFilename(key: StorageKey) {
    return key.map((part) => encodeURIComponent(part)).join(".");
  }

  private filenameToKey(filename: string): StorageKey {
    return filename.split(".").map((part) => decodeURIComponent(part));
  }

  private matchesPrefix(filename: string, prefix: string) {
    return !prefix || filename === prefix || filename.startsWith(`${prefix}.`);
  }
}

function toUint8Array(data: Uint8Array) {
  return new Uint8Array(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
  );
}
