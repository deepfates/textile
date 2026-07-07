import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import type { Duplex } from "node:stream";
import { Repo, type RepoConfig } from "@automerge/automerge-repo";
import type {
  Chunk,
  StorageAdapterInterface,
  StorageKey,
} from "@automerge/automerge-repo";
import { WebSocketServerAdapter } from "@automerge/automerge-repo-network-websocket";
import { WebSocketServer } from "isomorphic-ws";

export type LyncUpgradeAuthenticator = (request: http.IncomingMessage) => boolean;

export interface LyncServerOptions {
  port?: number;
  host?: string;
  path?: string;
  storageDir?: string;
  keepAliveInterval?: number;
  maxConnections?: number;
  authenticate?: LyncUpgradeAuthenticator;
  repoConfig?: Omit<RepoConfig, "network">;
}

export interface LyncServer {
  repo: Repo;
  server: WebSocketServer;
  url: string;
  close(): Promise<void>;
}

export function createLyncServer(options: LyncServerOptions = {}): LyncServer {
  const port = options.port ?? 0;
  const host = options.host ?? "127.0.0.1";
  const socketPath = normalizeSyncPath(options.path ?? "/lync");
  const httpServer = http.createServer();
  const relay = attachLyncServer(httpServer, options);
  httpServer.listen(port, host);

  return {
    repo: relay.repo,
    server: relay.server,
    get url() {
      const address = httpServer.address();
      if (typeof address === "string" || address === null) {
        return `ws://${formatWebSocketHost(host)}:${port}${socketPath}`;
      }
      return `ws://${formatWebSocketHost(address.address)}:${address.port}${socketPath}`;
    },
    async close() {
      await relay.close();
      httpServer.closeAllConnections?.();
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          httpServer.close((error?: Error) => {
            if ((error as NodeJS.ErrnoException | undefined)?.code === "ERR_SERVER_NOT_RUNNING") {
              resolve();
            } else if (error) reject(error);
            else resolve();
          });
        }),
        2_000,
      );
    },
  };
}

export interface AttachLyncServerOptions extends Omit<LyncServerOptions, "port" | "host"> {
  repo?: Repo;
}

export function attachLyncServer(
  server: http.Server,
  options: AttachLyncServerOptions = {},
) {
  const socketPath = normalizeSyncPath(options.path ?? "/lync");
  const socketServer = new WebSocketServer({
    noServer: true,
  });
  const repo = options.repo ?? createRelayRepo(socketServer, options);
  const upgradeSockets = new Set<Duplex>();
  let closePromise: Promise<void> | null = null;
  let closing = false;
  const closeOnce = () => {
    closing = true;
    closePromise ??= closeRelay(repo, socketServer, upgradeSockets);
    return closePromise;
  };
  const onUpgrade = (
    request: http.IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => {
    if (!isSocketPath(request, socketPath)) return;
    console.log("[Lync] upgrade received by relay");
    if (closing) {
      console.log("[Lync] rejecting upgrade: server closing");
      rejectUpgrade(socket, "503 Service Unavailable");
      return;
    }
    if (!isAuthorized(options.authenticate, request)) {
      console.log("[Lync] rejecting upgrade: unauthorized");
      rejectUpgrade(socket, "401 Unauthorized");
      return;
    }
    if (
      options.maxConnections !== undefined &&
      socketServer.clients.size >= options.maxConnections
    ) {
      console.log("[Lync] rejecting upgrade: max connections");
      rejectUpgrade(socket, "503 Service Unavailable");
      return;
    }
    upgradeSockets.add(socket);
    socket.once("close", () => upgradeSockets.delete(socket));
    socketServer.handleUpgrade(request, socket, head, (websocket) => {
      console.log("[Lync] upgrade accepted by relay");
      socketServer.emit("connection", websocket, request);
    });
  };

  server.on("upgrade", onUpgrade);

  server.on("close", () => {
    void closeOnce();
  });

  return {
    repo,
    server: socketServer,
    close: async () => {
      server.off("upgrade", onUpgrade);
      await closeOnce();
    },
  };
}

function isSocketPath(request: http.IncomingMessage, socketPath: string) {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    return url.pathname === socketPath;
  } catch {
    return false;
  }
}

function isAuthorized(
  authenticate: LyncUpgradeAuthenticator | undefined,
  request: http.IncomingMessage,
) {
  if (!authenticate) return true;
  try {
    return authenticate(request);
  } catch {
    return false;
  }
}

function rejectUpgrade(socket: Duplex, status: string) {
  socket.write(
    `HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    () => socket.end(),
  );
}

async function closeRelay(
  repo: Repo,
  socketServer: WebSocketServer,
  upgradeSockets: Set<Duplex>,
) {
  for (const client of socketServer.clients) {
    client.close(1001, "server shutting down");
    setTimeout(() => {
      if (client.readyState !== WebSocket.CLOSED) client.terminate();
    }, 1_000).unref?.();
  }
  setTimeout(() => {
    for (const socket of upgradeSockets) socket.destroy();
  }, 1_500).unref?.();

  await shutdownRepo(repo);
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      socketServer.close((error?: Error) => {
        if (error) reject(error);
        else resolve();
      });
    }),
    2_000,
  );
}

async function shutdownRepo(repo: Repo) {
  try {
    await repo.shutdown();
  } catch (error) {
    console.warn("[Lync] repo shutdown failed; continuing shutdown", error);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    timeout.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function createRelayRepo(
  server: WebSocketServer,
  options: Pick<LyncServerOptions, "keepAliveInterval" | "repoConfig" | "storageDir">,
) {
  const adapter = new WebSocketServerAdapter(server, options.keepAliveInterval);
  return new Repo({
    ...options.repoConfig,
    storage: options.storageDir
      ? new FileStorageAdapter(options.storageDir)
      : options.repoConfig?.storage,
    network: [adapter],
  });
}

function normalizeSyncPath(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
}

function formatWebSocketHost(host: string) {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
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
  return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
}
