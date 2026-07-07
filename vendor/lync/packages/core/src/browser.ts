import "@automerge/automerge";
import { Repo, type RepoConfig } from "@automerge/automerge-repo";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";
import { BroadcastChannelNetworkAdapter } from "@automerge/automerge-repo-network-broadcastchannel";
import { WebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket";

type StorageConstructor = new (database?: string, store?: string) => unknown;
type BroadcastConstructor = new (options?: {
  channelName: string;
  peerWaitMs?: number;
}) => unknown;
type WebSocketConstructor = new (url: string, retryInterval?: number) => unknown;

export interface BrowserAutomergeRepoOptions {
  location?: Pick<Location, "protocol" | "host">;
  syncPath?: string;
  indexedDb?: false | {
    database?: string;
    store?: string;
  };
  broadcastChannel?: false | {
    channelName?: string;
    peerWaitMs?: number;
  };
  websocket?: false | true | {
    url: string;
    retryInterval?: number;
  };
  adapters?: {
    IndexedDBStorageAdapter?: StorageConstructor;
    BroadcastChannelNetworkAdapter?: BroadcastConstructor;
    WebSocketClientAdapter?: WebSocketConstructor;
  };
}

export function createBrowserAutomergeRepo(options: BrowserAutomergeRepoOptions = {}): Repo {
  return new Repo(createBrowserAutomergeRepoConfig(options) as RepoConfig);
}

export function createBrowserAutomergeRepoConfig(
  options: BrowserAutomergeRepoOptions = {},
): {
  storage?: unknown;
  network: unknown[];
} {
  const IndexedDB =
    options.adapters?.IndexedDBStorageAdapter ?? IndexedDBStorageAdapter;
  const Broadcast =
    options.adapters?.BroadcastChannelNetworkAdapter ?? BroadcastChannelNetworkAdapter;
  const WebSocket =
    options.adapters?.WebSocketClientAdapter ?? WebSocketClientAdapter;

  const indexedDbOptions = options.indexedDb ?? {};
  const broadcastOptions = options.broadcastChannel ?? {};
  const websocketOptions = options.websocket ?? true;

  const network = [];
  if (broadcastOptions !== false) {
    network.push(
      new Broadcast({
        channelName: broadcastOptions.channelName ?? "lync",
        peerWaitMs: broadcastOptions.peerWaitMs,
      }),
    );
  }
  if (websocketOptions !== false) {
    const websocketUrl =
      websocketOptions === true
        ? defaultWebSocketUrl({
            location: options.location,
            path: options.syncPath,
          })
        : websocketOptions.url;
    const retryInterval =
      websocketOptions === true ? undefined : websocketOptions.retryInterval;
    if (websocketUrl) network.push(new WebSocket(websocketUrl, retryInterval));
  }

  return {
    storage:
      indexedDbOptions === false
        ? undefined
        : new IndexedDB(indexedDbOptions.database, indexedDbOptions.store),
    network,
  };
}

export interface DefaultWebSocketUrlOptions {
  location?: Pick<Location, "protocol" | "host">;
  path?: string;
}

export function defaultWebSocketUrl(options: DefaultWebSocketUrlOptions = {}) {
  const location =
    options.location ??
    (typeof window === "undefined" ? undefined : window.location);
  if (!location) return null;
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const path = normalizeSyncPath(options.path ?? "/lync");
  return `${protocol}//${location.host}${path}`;
}

function normalizeSyncPath(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
}
