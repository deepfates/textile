import { describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { throttle } from "@automerge/automerge-repo/helpers/throttle.js";
import { createNodeLoomClient } from "@lync/client/node";
import { textStoryLoomMeta } from "@lync/core/profiles/text-story";
import { createLyncServer } from "@lync/sync-server";
import { resolveLyncAuthMode } from "../lync";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function findOpenPort() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = 18_000 + Math.floor(Math.random() * 20_000);
    const available = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => {
        server.close(() => resolve(true));
      });
    });
    if (available) return port;
  }
  throw new Error("Could not find an open port for Lync test relay");
}

describe("lync server config", () => {
  it("defaults websocket sync auth to site access", () => {
    expect(resolveLyncAuthMode(undefined)).toBe("site-access");
    expect(resolveLyncAuthMode("")).toBe("site-access");
    expect(resolveLyncAuthMode("api")).toBe("site-access");
  });

  it("can make /lync a public stock Automerge sync endpoint", () => {
    expect(resolveLyncAuthMode("public")).toBe("public");
    expect(resolveLyncAuthMode(" PUBLIC ")).toBe("public");
  });

  it("does not schedule negative sync-state throttle delays after reconnect stalls", async () => {
    const realNow = Date.now;
    const realSetTimeout = globalThis.setTimeout;
    const delays: number[] = [];
    let now = 1_000;
    let calls = 0;

    Date.now = () => now;
    globalThis.setTimeout = ((handler, timeout, ...args) => {
      delays.push(Number(timeout));
      return realSetTimeout(handler, 0, ...args);
    }) as typeof setTimeout;

    try {
      const saveSyncState = throttle(() => {
        calls += 1;
      }, 100);

      now = 1_200;
      saveSyncState();

      await new Promise((resolve) => realSetTimeout(resolve, 5));
    } finally {
      Date.now = realNow;
      globalThis.setTimeout = realSetTimeout;
    }

    expect(delays).toEqual([0]);
    expect(calls).toBe(1);
  });

  it("keeps repeated Lync story reconnects free of negative timeout warnings", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "textile-lync-"));
    const relay = createLyncServer({
      port: await findOpenPort(),
      path: "/lync",
      storageDir: path.join(tempDir, "relay"),
      keepAliveInterval: 25,
      repoConfig: { saveDebounceRate: 5 },
    });
    const warnings: string[] = [];
    const onWarning = (warning: Error) => {
      if (warning.name === "TimeoutNegativeWarning") {
        warnings.push(warning.message);
      }
    };

    process.on("warning", onWarning);

    try {
      await delay(10);
      const syncUrl = relay.url;

      for (let cycle = 0; cycle < 4; cycle += 1) {
        const client = createNodeLoomClient({
          storageDir: path.join(tempDir, `client-${cycle}`),
          sync: {
            url: syncUrl,
            adapter: "resilient",
            retryInterval: 20,
          },
          repoConfig: { saveDebounceRate: 5 },
        });

        for (let story = 0; story < 4; story += 1) {
          const info = await client.looms.create(
            textStoryLoomMeta({ title: `Story ${cycle}-${story}` }),
          );
          const loom = await client.looms.open(info.id);
          const root = await loom.appendTurn(
            null,
            { text: `Seed ${cycle}-${story}` },
            { role: "prose" },
          );
          await loom.appendTurn(
            root.id,
            { text: `Branch ${cycle}-${story}` },
            { role: "prose" },
          );
        }

        await delay(30);
        await client.close();
      }

      await delay(30);
    } finally {
      process.off("warning", onWarning);
      await relay.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    }

    expect(warnings).toEqual([]);
  });
});
