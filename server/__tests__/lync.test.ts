import { describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createMemoryEventStore } from "lync-core/memory-log";
import { createLyncLooms, loomRootId } from "lync-core/looms";
import { createSyncedStore, createWebSocketTransport } from "lync-core/synced-store";
import { textStoryLoomMeta } from "lync-core/profiles/text-story";
import { startLyncServe } from "lync-core/relay";
import { resolveLyncAuthMode } from "../lync";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check: () => Promise<boolean> | boolean, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await delay(20);
  }
  return false;
}

describe("lync server config", () => {
  it("defaults websocket sync auth to site access", () => {
    expect(resolveLyncAuthMode(undefined)).toBe("site-access");
    expect(resolveLyncAuthMode("")).toBe("site-access");
    expect(resolveLyncAuthMode("api")).toBe("site-access");
  });

  it("can make /lync a public sync endpoint", () => {
    expect(resolveLyncAuthMode("public")).toBe("public");
    expect(resolveLyncAuthMode(" PUBLIC ")).toBe("public");
  });
});

describe("lync relay convergence", () => {
  it("converges several live stories to a fresh reader", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "textile-lync-"));
    const relay = await startLyncServe({ dir: path.join(tempDir, "relay"), log: () => {} });
    const url = `ws://localhost:${relay.port}`;

    const writers: Array<{ close: () => void }> = [];
    let reader: { close: () => void } | undefined;
    const createdRoots: string[] = [];
    try {
      // Several independent writers each seed a story; all stay connected.
      for (let cycle = 0; cycle < 3; cycle += 1) {
        const store = createSyncedStore(
          createMemoryEventStore(),
          createWebSocketTransport(url, { reconnectMs: 0 }),
        );
        writers.push(store);
        const looms = createLyncLooms<{ text: string }, { title: string }, { role: string }>({
          store,
          author: { actor: "writer" },
        });
        const info = await looms.create(textStoryLoomMeta({ title: `Story ${cycle}` }) as { title: string });
        const loom = await looms.open(info.id);
        const seed = await loom.appendTurn(null, { text: `Seed ${cycle}` }, { role: "prose" });
        await loom.appendTurn(seed.id, { text: `Branch ${cycle}` }, { role: "prose" });
        createdRoots.push(loomRootId(info.id));
      }

      // Let the writers connect and flush their seeds to the relay before a
      // reader joins the established session.
      await waitFor(() => writers.every((w) => (w as ReturnType<typeof createSyncedStore>).status().connection === "online"));
      await delay(200);

      // A fresh reader syncs every root and sees all three stories in full.
      reader = createSyncedStore(
        createMemoryEventStore(),
        createWebSocketTransport(url, { reconnectMs: 0 }),
      );
      const syncing = reader as ReturnType<typeof createSyncedStore>;
      for (const root of createdRoots) syncing.syncRoot(root);
      const converged = await waitFor(async () => {
        for (const root of createdRoots) {
          if ((await syncing.byRoot(root)).length < 3) return false; // loom event + 2 turns
        }
        return true;
      });
      expect(converged).toBe(true);
    } finally {
      reader?.close();
      for (const w of writers) w.close();
      await relay.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }, 20_000);
});
