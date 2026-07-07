import { describe, expect, it } from "vitest";
import http from "node:http";
import net from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import WebSocket from "isomorphic-ws";
import {
  attachLyncServer,
  createLyncServer,
  FileStorageAdapter,
} from "../src/index.js";

describe("lync server", () => {
  it("starts a WebSocket-backed Automerge repo and closes cleanly", async () => {
    const server = createLyncServer();

    expect(server.url.startsWith("ws://")).toBe(true);
    expect(new URL(server.url).pathname).toBe("/lync");
    expect(server.repo.peerId).toBeTruthy();

    await server.close();
  });

  it("normalizes custom sync paths in the standalone server URL", async () => {
    const server = createLyncServer({ path: "sync" });

    expect(new URL(server.url).pathname).toBe("/sync");

    await server.close();
  });

  it("attaches a relay to an existing HTTP server", async () => {
    const httpServer = http.createServer();
    const relay = attachLyncServer(httpServer);

    expect(relay.repo.peerId).toBeTruthy();

    await relay.close();
    httpServer.close();
  });

  it("does not fail shutdown when the repo cannot flush", async () => {
    const httpServer = http.createServer();
    const relay = attachLyncServer(httpServer, {
      repo: {
        peerId: "broken-shutdown-repo",
        shutdown: async () => {
          throw new Error("DocHandle is not ready");
        },
      } as never,
    });

    await expect(relay.close()).resolves.toBeUndefined();
    httpServer.close();
  });

  it("can authenticate websocket upgrades", async () => {
    const httpServer = http.createServer();
    const seenAuthHeaders: Array<string | undefined> = [];
    const relay = attachLyncServer(httpServer, {
      authenticate: (request) => {
        seenAuthHeaders.push(request.headers.authorization);
        return request.headers.authorization === "Bearer ok";
      },
    });

    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    if (typeof address === "string" || address === null) {
      throw new Error("Expected TCP server address");
    }
    const url = `ws://127.0.0.1:${address.port}/lync`;

    await expect(sendUpgrade(address.port)).resolves.toBe("closed");
    expect(seenAuthHeaders).toContain(undefined);
    await expect(connect(url, { authorization: "Bearer ok" })).resolves.toBeUndefined();
    expect(seenAuthHeaders).toContain("Bearer ok");

    await relay.close();
    httpServer.close();
  });

  it("rejects websocket upgrades when authentication throws", async () => {
    const httpServer = http.createServer();
    const relay = attachLyncServer(httpServer, {
      authenticate: () => {
        throw new Error("auth backend unavailable");
      },
    });

    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    if (typeof address === "string" || address === null) {
      throw new Error("Expected TCP server address");
    }

    const url = `ws://127.0.0.1:${address.port}/lync`;
    await expect(sendUpgrade(address.port)).resolves.toBe("closed");

    await relay.close();
    httpServer.close();
  });

  it("persists storage chunks to the filesystem", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lync-storage-"));
    const storage = new FileStorageAdapter(dir);
    await storage.save(["doc", "snapshot"], new Uint8Array([1, 2, 3]));

    await expect(storage.load(["doc", "snapshot"])).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    );
    await expect(storage.loadRange(["doc"])).resolves.toHaveLength(1);

    await storage.removeRange(["doc"]);
    await expect(storage.load(["doc", "snapshot"])).resolves.toBeUndefined();
  });
});

function sendUpgrade(port: number) {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(
        [
          "GET /lync HTTP/1.1",
          "Host: 127.0.0.1",
          "Connection: Upgrade",
          "Upgrade: websocket",
          "Sec-WebSocket-Version: 13",
          `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString("base64")}`,
          "",
          "",
        ].join("\r\n"),
      );
    });

    socket.setTimeout(1000, () => {
      socket.destroy(new Error("Timed out waiting for websocket rejection"));
    });
    socket.on("data", (chunk) => {
      if (!chunk.toString().startsWith("HTTP/1.1")) return;
      settled = true;
      socket.destroy();
      resolve("closed");
    });
    socket.on("close", () => {
      if (!settled) resolve("closed");
    });
    socket.on("error", (error) => {
      if (!settled) reject(error);
    });
  });
}

function connect(url: string, headers: Record<string, string> = {}) {
  return new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url, { headers });
    socket.once("open", () => {
      socket.close();
      resolve();
    });
    socket.once("error", reject);
  });
}
