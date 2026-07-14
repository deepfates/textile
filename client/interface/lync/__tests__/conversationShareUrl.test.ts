import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createMemoryEventStore } from "@deepfates/lync/memory-log";
import { createLyncLooms } from "@deepfates/lync/looms";
import { textStoryLoomMeta } from "@deepfates/lync/profiles/text-story";

import {
  classifyStoryReferenceMeta,
  createStoryShareUrl,
  importConversationLoom,
  importStoryReferenceFromUrl,
  isConversationLoomMeta,
  listStoryEntries,
  type ConversationLoomSnapshot,
} from "../storyRuntime";

/**
 * dee-31x6 proof: a shared `?ref=` URL to a CONVERSATION loom opens through
 * textile's real runtime the same way a story link does. Before this, the
 * guard in `importStoryReferenceFromUrl` threw for any non-text-story meta, so
 * a conversation share URL failed. We build a SYNTHETIC conversation loom via
 * the real @deepfates/lync API, mint its share URL, point a mock location at
 * it, and drive `importStoryReferenceFromUrl` — asserting it OPENS (returns the
 * loom, registered `kind: "conversation"`) and does not throw. A garbage ref
 * still throws loud (NOTHING-SILENT). All SYNTHETIC; no real session.
 */

const MODEL = "claude-synthetic-share";

async function synthConversationSnapshot(): Promise<ConversationLoomSnapshot> {
  const store = createMemoryEventStore();
  let nextId = 0;
  const looms = createLyncLooms<
    { message: unknown; text: string },
    { profile: "conversation"; source: string; title: string },
    { role: string; author: string }
  >({
    store,
    author: { actor: "splice/claude-session-import@0.1" },
    createId: () => `conv-turn-${++nextId}`,
    now: () => 2000 + nextId,
  });
  const info = await looms.create({
    profile: "conversation",
    source: "claude-session",
    title: "Shared Synthetic Chat",
  });
  const loom = await looms.open(info.id);
  const q1 = await loom.appendTurn(
    null,
    { message: { role: "user", content: "Can a shared link open a chat?" }, text: "Can a shared link open a chat?" },
    { role: "user", author: "deepfates" },
  );
  await loom.appendTurn(
    q1.id,
    { message: { role: "assistant", model: MODEL, content: [{ type: "text", text: "Yes." }] }, text: "Yes." },
    { role: "assistant", author: MODEL },
  );
  const snapshot = await loom.export();
  loom.close();
  return snapshot as unknown as ConversationLoomSnapshot;
}

describe("classifyStoryReferenceMeta (widened guard, still loud on garbage)", () => {
  it("accepts a text-story loom", () => {
    expect(classifyStoryReferenceMeta(textStoryLoomMeta({ title: "S" }))).toBe(
      "story",
    );
  });

  it("accepts a conversation loom", () => {
    expect(
      classifyStoryReferenceMeta({ profile: "conversation", title: "C" }),
    ).toBe("conversation");
    expect(isConversationLoomMeta({ profile: "conversation" })).toBe(true);
  });

  it("throws loud + specific on a ref that is neither", () => {
    expect(() => classifyStoryReferenceMeta(undefined)).toThrow(
      /text-story or conversation loom/,
    );
    expect(() => classifyStoryReferenceMeta({ profile: "note" })).toThrow(
      /text-story or conversation loom/,
    );
    expect(() => classifyStoryReferenceMeta(42)).toThrow(
      /text-story or conversation loom/,
    );
    expect(isConversationLoomMeta({ profile: "note" })).toBe(false);
  });
});

describe("importStoryReferenceFromUrl opens a conversation ?ref= URL", () => {
  const savedWindow = (globalThis as { window?: unknown }).window;
  const localStore = new Map<string, string>();

  function mockWindowAt(href: string) {
    (globalThis as { window?: unknown }).window = {
      location: new URL(href),
      localStorage: {
        getItem: (k: string) => (localStore.has(k) ? localStore.get(k)! : null),
        setItem: (k: string, v: string) => localStore.set(k, v),
        removeItem: (k: string) => localStore.delete(k),
      },
    };
  }

  afterEach(() => {
    if (savedWindow === undefined)
      delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = savedWindow;
  });

  it("round-trips a synthetic conversation loom share URL through the real open path", async () => {
    // Build the runtime client + index over the in-memory store while window is
    // still undefined (memory-store branch), then import the synthetic loom so
    // it lives in the SAME store the shared-URL open path will read.
    const snapshot = await synthConversationSnapshot();
    const imported = await importConversationLoom(snapshot);

    // Mint the share URL the "Story link" action copies, then point a mock
    // location at it (as a fresh browser context arriving on the link would).
    const shareUrl = createStoryShareUrl(
      imported.loomId,
      new URL("https://textile.test/"),
    );
    expect(shareUrl).toContain("?ref=");
    mockWindowAt(shareUrl);

    // The formerly-throwing guard now OPENS the conversation loom.
    const opened = await importStoryReferenceFromUrl();
    expect(opened).toBeTruthy();
    if (!opened || opened.kind === "index") throw new Error("expected a loom open");
    expect(opened.loomId).toBe(imported.loomId);

    // It is (still) registered in the index as a conversation, not a story.
    const entry = (await listStoryEntries()).find(
      (e) => e.ref.loomId === imported.loomId,
    );
    expect(entry?.kind).toBe("conversation");
  });

  it("still throws loud on a genuinely-invalid (non-loom) ref", async () => {
    // A ref whose loom cannot be opened surfaces an error — never a silent null
    // or a blank story. (openReference rejects an unknown loom root.)
    const badRef = Buffer.from(
      JSON.stringify({ v: 1, kind: "loom", loomId: "lync:does-not-exist" }),
      "utf8",
    ).toString("base64url");
    mockWindowAt(`https://textile.test/?ref=${badRef}`);
    await expect(importStoryReferenceFromUrl()).rejects.toThrow();
  });
});
