import fs from "node:fs/promises";
import http from "node:http";
import type net from "node:net";
import os from "node:os";
import path from "node:path";
import { cbor, type PeerId } from "@automerge/automerge-repo/slim";
import { describe, expect, it } from "vitest";
import { WebSocketServer } from "isomorphic-ws";
import { createNodeLoomClient, type SyncStatus } from "../src/node.js";
import { createWebSocketSyncAdapter } from "../src/sync.js";

type JoinMessage = {
  type: "join";
  senderId: PeerId;
};

describe("node loom client", () => {
  it("persists looms through the filesystem storage adapter", async () => {
    const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "lync-node-"));

    const client = createNodeLoomClient<{ text: string }>({
      storageDir,
      syncUrl: false,
    });
    const info = await client.looms.create({ title: "Node script" });
    const loom = await client.looms.open(info.id);
    const first = await loom.appendTurn(null, { text: "Hello" });
    await client.close();

    const reopened = createNodeLoomClient<{ text: string }>({
      storageDir,
      syncUrl: false,
    });
    const reopenedLoom = await reopened.looms.open(info.id);

    await expect(reopenedLoom.childrenOf(null)).resolves.toEqual([first]);

    await reopened.close();
    await fs.rm(storageDir, { recursive: true, force: true });
  });

  it("can run without persistence or network for short-lived scripts", async () => {
    const client = createNodeLoomClient<{ text: string }>({
      storageDir: false,
      syncUrl: false,
    });

    const info = await client.looms.create();
    const loom = await client.looms.open(info.id);

    await expect(loom.appendTurn(null, { text: "Transient" })).resolves.toMatchObject({
      loomId: info.id,
      parentId: null,
      payload: { text: "Transient" },
    });

    await client.close();
  });

  it("keeps local loom operations alive when websocket sync is unavailable", async () => {
    const server = http.createServer();
    server.on("upgrade", (_request, socket) => {
      socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP server");

    const statuses: SyncStatus[] = [];
    const client = createNodeLoomClient<{ text: string }>({
      storageDir: false,
      sync: {
        url: `ws://127.0.0.1:${address.port}/lync`,
        retryInterval: 0,
        onStatus: (status) => statuses.push(status),
      },
    });

    const info = await client.looms.create({ title: "Offline tolerant" });
    const loom = await client.looms.open(info.id);
    await expect(loom.appendTurn(null, { text: "Still works" })).resolves.toMatchObject({
      payload: { text: "Still works" },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(statuses.some((status) => status.state === "failed")).toBe(true);

    await client.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("closes a hanging websocket before retrying", async () => {
    const upgradeSockets = new Set<net.Socket>();
    const statuses: SyncStatus[] = [];
    const server = http.createServer();
    server.on("upgrade", (_request, socket) => {
      upgradeSockets.add(socket);
      socket.on("close", () => upgradeSockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP server");

    const adapter = createWebSocketSyncAdapter({
      url: `ws://127.0.0.1:${address.port}/lync`,
      retryInterval: 20,
      onStatus: (status) => statuses.push(status),
    });

    adapter.connect("peer-a" as PeerId);
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(upgradeSockets.size).toBeLessThanOrEqual(1);
    expect(
      statuses.some(
        (status) =>
          status.state === "failed" &&
          status.recoverable &&
          status.error.message === "WebSocket handshake timed out",
      ),
    ).toBe(true);

    adapter.disconnect();
    for (const socket of upgradeSockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("does not reconnect after the peer handshake completes", async () => {
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    let connectionCount = 0;
    server.on("connection", (socket) => {
      connectionCount += 1;
      socket.send(
        cbor.encode({
          type: "peer",
          senderId: "peer-server",
          peerMetadata: {},
          selectedProtocolVersion: "1",
          targetId: "peer-a",
        }),
      );
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP server");

    const statuses: SyncStatus[] = [];
    const adapter = createWebSocketSyncAdapter({
      url: `ws://127.0.0.1:${address.port}/lync`,
      retryInterval: 20,
      onStatus: (status) => statuses.push(status),
    });

    adapter.connect("peer-a" as PeerId);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(connectionCount).toBe(1);
    expect(statuses.some((status) => status.state === "connected")).toBe(true);

    adapter.disconnect();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("can use the native Automerge websocket adapter for unauthenticated sync", async () => {
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    let receivedJoin = false;
    server.on("connection", (socket) => {
      socket.on("message", (messageBytes) => {
        const message = cbor.decode(new Uint8Array(messageBytes as Buffer)) as JoinMessage;
        if (message.type !== "join") return;
        receivedJoin = true;
        socket.send(
          cbor.encode({
            type: "peer",
            senderId: "peer-server",
            peerMetadata: {},
            selectedProtocolVersion: "1",
            targetId: message.senderId,
          }),
        );
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP server");

    const client = createNodeLoomClient<{ text: string }>({
      storageDir: false,
      sync: {
        url: `ws://127.0.0.1:${address.port}/lync`,
        retryInterval: 20,
        adapter: "native",
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(receivedJoin).toBe(true);

    await client.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("rejects native adapter selection when auth headers are required", () => {
    expect(() =>
      createWebSocketSyncAdapter({
        url: "ws://127.0.0.1:3030/lync",
        adapter: "native",
        auth: { type: "bearer", token: "secret" },
      }),
    ).toThrow("does not support auth headers");
  });

  it("does not report a timeout when disconnecting during a handshake", async () => {
    const upgradeSockets = new Set<net.Socket>();
    const statuses: SyncStatus[] = [];
    const server = http.createServer();
    server.on("upgrade", (_request, socket) => {
      upgradeSockets.add(socket);
      socket.on("close", () => upgradeSockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP server");

    const adapter = createWebSocketSyncAdapter({
      url: `ws://127.0.0.1:${address.port}/lync`,
      retryInterval: 20,
      onStatus: (status) => statuses.push(status),
    });

    adapter.connect("peer-a" as PeerId);
    adapter.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(statuses.some((status) => status.state === "failed")).toBe(false);

    for (const socket of upgradeSockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
