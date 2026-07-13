import { describe, expect, it } from "bun:test";
import { createMemoryEventStore } from "@deepfates/lync/memory-log";
import { createLyncLooms, loomRootId } from "@deepfates/lync/looms";
import { textStoryLoomMeta } from "@deepfates/lync/profiles/text-story";
import { loomRef, type LoomReference } from "@deepfates/lync";
import { createLoreLoomIndexes } from "../loreIndex";
import {
  createStoryIndexShareUrl,
  createStoryFocusShareUrl,
  createLocalStoryUrl,
  createStoryShareUrl,
  createStoryThreadShareUrl,
  getStoryReferenceFromLocation,
  reduceLyncSyncStatus,
  resolveAuthorActor,
  storyAuthorFor,
} from "../storyRuntime";

describe("story runtime references", () => {
  it("creates loom reference URLs without carrying stale parameters", () => {
    const location = new URL("https://textile.test/?old=1#stale");

    const url = new URL(createStoryShareUrl("loom-1", location));

    expect([...url.searchParams.keys()]).toEqual(["ref"]);
    expect(url.hash).toBe("");
    expect(getStoryReferenceFromLocation(url)).toEqual({
      v: 1,
      kind: "loom",
      loomId: "loom-1",
    });
  });

  it("creates index reference URLs", () => {
    const location = new URL("https://textile.test/?draft=old");

    const url = new URL(createStoryIndexShareUrl("index-1", location));

    expect([...url.searchParams.keys()]).toEqual(["ref"]);
    expect(getStoryReferenceFromLocation(url)).toEqual({
      v: 1,
      kind: "index",
      indexId: "index-1",
    });
  });

  it("creates thread reference URLs", () => {
    const location = new URL("https://textile.test/");

    const url = new URL(createStoryThreadShareUrl("loom-1", "turn-1", location));

    expect(getStoryReferenceFromLocation(url)).toEqual({
      v: 1,
      kind: "thread",
      loomId: "loom-1",
      turnId: "turn-1",
    });
  });

  it("creates focus URLs as loom or thread references", () => {
    const location = new URL("https://textile.test/");

    expect(getStoryReferenceFromLocation(
      new URL(createStoryFocusShareUrl("loom-1", null, location)),
    )).toEqual({
      v: 1,
      kind: "loom",
      loomId: "loom-1",
    });
    expect(getStoryReferenceFromLocation(
      new URL(createStoryFocusShareUrl("loom-1", "turn-1", location)),
    )).toEqual({
      v: 1,
      kind: "thread",
      loomId: "loom-1",
      turnId: "turn-1",
    });
  });

  it("creates clean local URLs by removing only story references", () => {
    const location = new URL("https://textile.test/read?draft=1&ref=abc#turn");

    const url = new URL(createLocalStoryUrl(location));

    expect(url.pathname).toBe("/read");
    expect(url.searchParams.get("draft")).toBe("1");
    expect(url.searchParams.has("ref")).toBe(false);
    expect(url.hash).toBe("");
  });
});

describe("author identity", () => {
  it("resolves the person's name, else the stable anon id", () => {
    // A named person carries their own name.
    expect(resolveAuthorActor("Ada", "anon-1")).toBe("Ada");
    // Whitespace-only or empty names fall back to the anon id.
    expect(resolveAuthorActor("   ", "anon-1")).toBe("anon-1");
    expect(resolveAuthorActor("", "anon-1")).toBe("anon-1");
    expect(resolveAuthorActor(undefined, "anon-2")).toBe("anon-2");
    // Two un-named browsers stay distinguishable — never a shared constant.
    expect(resolveAuthorActor(null, "anon-1")).not.toBe(
      resolveAuthorActor(null, "anon-2"),
    );
  });

  it("keeps actor as the person and via as the controller", () => {
    expect(storyAuthorFor("Ada", "anon-1")).toEqual({
      actor: "Ada",
      via: "textile-browser",
    });
    expect(storyAuthorFor("", "anon-xyz")).toEqual({
      actor: "anon-xyz",
      via: "textile-browser",
    });
  });

  it("writes distinguishable events for two people on one shared loom", async () => {
    const store = createMemoryEventStore();
    const named = createLyncLooms<
      { text: string },
      { title: string },
      { role: string }
    >({ store, author: storyAuthorFor("Ada Lovelace", "anon-unused") });
    const anon = createLyncLooms<
      { text: string },
      { title: string },
      { role: string }
    >({ store, author: storyAuthorFor("", "anon-2f9c") });

    // A named person opens a shared story and writes the first human turn.
    const info = await named.create(
      textStoryLoomMeta({ title: "Shared" }) as { title: string },
    );
    const namedLoom = await named.open(info.id);
    const seed = await namedLoom.appendTurn(
      null,
      { text: "Ada writes." },
      { role: "prose" },
    );

    // An un-named collaborator branches from the same loom in the same store.
    const anonLoom = await anon.open(info.id);
    await anonLoom.appendTurn(
      seed.id,
      { text: "Anon replies." },
      { role: "prose" },
    );

    // Read the real appended events back and inspect their authors.
    const events = await store.byRoot(loomRootId(info.id));
    const turns = events.filter((e) => e.body.kind === "lync/turn");
    const actors = turns.map((e) => e.body.author.actor);

    // Two distinct identities produce two distinct actors.
    expect(turns.length).toBe(2);
    expect(new Set(actors).size).toBe(2);
    // A named person's turn carries their name; the anon browser its anon id.
    expect(actors).toContain("Ada Lovelace");
    expect(actors).toContain("anon-2f9c");
    // No human turn is authored as the old hardcoded "textile" constant.
    expect(actors).not.toContain("textile");
    // via stays the controller/software on every human turn.
    for (const turn of turns) {
      expect(turn.body.author.via).toBe("textile-browser");
    }
  });

  it("authors index events as the person, never the hardcoded \"textile\"", async () => {
    const store = createMemoryEventStore();
    // The same derivation getStoryClient() uses to build its index author.
    const author = storyAuthorFor("Bram Stoker", "anon-index");
    const indexes = createLoreLoomIndexes<{ title: string }, { app: "textile" }>({
      store,
      author,
    });

    // create() mints a lync/index root; addLoom() mints a lync/index-entry.
    const index = await indexes.create({ app: "textile" });
    await index.addLoom(
      loomRef("lync:demo-loom") as Extract<LoomReference, { kind: "loom" }>,
      { title: "Dracula", kind: "story" },
    );

    const root = index.id.slice("lore-index:".length);
    const indexEvents = (await store.byRoot(root)).filter((e) =>
      e.body.kind.startsWith("lync/index"),
    );

    // Both the index root and the entry were minted.
    expect(indexEvents.length).toBeGreaterThanOrEqual(2);
    // Every index event carries the person, not the old hardcoded constant,
    // and keeps via as the controller — matching the turn events.
    for (const event of indexEvents) {
      expect(event.body.author.actor).toBe("Bram Stoker");
      expect(event.body.author.actor).not.toBe("textile");
      expect(event.body.author.via).toBe("textile-browser");
    }
  });
});

describe("Lync sync status", () => {
  const initial = {
    state: "local-only" as const,
    detail: "initial",
  };

  it("reports connected only after a socket open event", () => {
    expect(reduceLyncSyncStatus(initial, { type: "connecting" })).toEqual({
      state: "reconnecting",
      detail: "Connecting to the Lync relay.",
    });

    expect(reduceLyncSyncStatus(initial, { type: "connected" })).toEqual({
      state: "connected",
      detail: "Lync relay connected.",
    });
  });

  it("reports reconnecting when the relay disconnects", () => {
    expect(reduceLyncSyncStatus(initial, { type: "disconnected" })).toEqual({
      state: "reconnecting",
      detail: "Lync relay unavailable; retrying.",
    });
  });

  it("reports local-only honestly for offline or unsupported runtimes", () => {
    expect(
      reduceLyncSyncStatus(initial, {
        type: "local-only",
        detail: "Browser is offline; stories are local only.",
      }),
    ).toEqual({
      state: "local-only",
      detail: "Browser is offline; stories are local only.",
    });
  });
});
