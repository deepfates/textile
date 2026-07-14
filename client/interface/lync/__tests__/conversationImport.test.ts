import { describe, expect, it } from "bun:test";
import { createMemoryEventStore } from "@deepfates/lync/memory-log";
import { createLyncLooms } from "@deepfates/lync/looms";

import {
  importConversationLoom,
  listStoryEntries,
  openStoryLoom,
  parseConversationSnapshot,
  type ConversationLoomSnapshot,
} from "../storyRuntime";
import { loadReachableStoryEntries } from "../../hooks/useStoryCatalog";

/**
 * Part B proof: textile can OPEN a conversation loom through its real runtime
 * entry path, not just read one in an isolated fold test. We build a SYNTHETIC
 * conversation snapshot shaped exactly like splice's session→loom adapter emits
 * (turns carry `payload.message` + `payload.text`, `meta.role`/`meta.author`),
 * import it through `importConversationLoom` (which persists it into textile's
 * event store and registers it in the story index), then drive the SAME catalog
 * loader `useStoryCatalog` uses to open + project looms — proving the loom shows
 * each turn's actor + message and is navigable. All SYNTHETIC; no real session.
 */

const MODEL = "claude-synthetic-1";

/**
 * Hand-build a conversation snapshot via the REAL @deepfates/lync Looms API,
 * over a throwaway store, matching splice's adapter output byte-shape:
 * user → assistant → user → assistant, with a branch off the root.
 */
async function synthConversationSnapshot(): Promise<ConversationLoomSnapshot> {
  const store = createMemoryEventStore();
  let nextId = 0;
  const looms = createLyncLooms<
    { message: unknown; text: string },
    { profile: "conversation"; source: string; sessionLocator: string; title: string },
    { role: string; author: string }
  >({
    store,
    author: { actor: "splice/claude-session-import@0.1" },
    createId: () => `turn-${++nextId}`,
    now: () => 1000 + nextId,
  });
  const info = await looms.create({
    profile: "conversation",
    source: "claude-session",
    sessionLocator: "synthetic.jsonl",
    title: "Synthetic Chat",
  });
  const loom = await looms.open(info.id);

  const q1 = await loom.appendTurn(
    null,
    { message: { role: "user", content: "What is a loom?" }, text: "What is a loom?" },
    { role: "user", author: "deepfates" },
  );
  const a1 = await loom.appendTurn(
    q1.id,
    {
      message: { role: "assistant", model: MODEL, content: [{ type: "text", text: "A branching record of turns." }] },
      text: "A branching record of turns.",
    },
    { role: "assistant", author: MODEL },
  );
  const q2 = await loom.appendTurn(
    a1.id,
    { message: { role: "user", content: "Can textile read one?" }, text: "Can textile read one?" },
    { role: "user", author: "deepfates" },
  );
  await loom.appendTurn(
    q2.id,
    { message: { role: "assistant", model: MODEL, content: [{ type: "text", text: "Yes." }] }, text: "Yes." },
    { role: "assistant", author: MODEL },
  );
  // A second child of the root — proves the branch survives import.
  await loom.appendTurn(
    q1.id,
    { message: { role: "assistant", model: MODEL, content: [{ type: "text", text: "A tree of continuations." }] }, text: "A tree of continuations." },
    { role: "assistant", author: MODEL },
  );

  const snapshot = await loom.export();
  loom.close();
  return snapshot as unknown as ConversationLoomSnapshot;
}

describe("parseConversationSnapshot validation (nothing silently wrong)", () => {
  it("throws loud + specific on malformed or non-conversation input", () => {
    expect(() => parseConversationSnapshot("not json")).toThrow(/invalid JSON/);
    expect(() => parseConversationSnapshot("42")).toThrow(/snapshot object/);
    expect(() => parseConversationSnapshot(JSON.stringify({ turns: [] }))).toThrow(
      /loom\.id is missing/,
    );
    expect(() =>
      parseConversationSnapshot(JSON.stringify({ loom: { id: "x" } })),
    ).toThrow(/turns must be an array/);
    // A story loom mis-dropped here is refused, not imported as a broken story.
    expect(() =>
      parseConversationSnapshot(
        JSON.stringify({ loom: { id: "x", meta: { profile: "text-story" } }, turns: [] }),
      ),
    ).toThrow(/expected "conversation"/);
  });

  it("round-trips a valid snapshot through JSON", async () => {
    const snapshot = await synthConversationSnapshot();
    const parsed = parseConversationSnapshot(JSON.stringify(snapshot));
    expect(parsed.turns.length).toBe(5);
    expect(parsed.loom.meta?.profile).toBe("conversation");
  });
});

describe("importConversationLoom → catalog opens + renders it", () => {
  it("imports, registers in the index with kind conversation, and opens navigable", async () => {
    const snapshot = await synthConversationSnapshot();
    const imported = await importConversationLoom(snapshot);

    expect(imported.turnCount).toBe(5);
    expect(imported.title).toBe("Synthetic Chat");

    // It is registered in the SAME story index the running catalog reads.
    const entries = await listStoryEntries();
    const entry = entries.find((e) => e.ref.loomId === imported.loomId);
    expect(entry).toBeTruthy();
    expect(entry?.kind).toBe("conversation");
    expect(entry?.title).toBe("Synthetic Chat");

    // Drive the EXACT loader useStoryCatalog uses to open + project looms.
    const loaded = await loadReachableStoryEntries(entries, openStoryLoom, "");
    const tree = loaded.trees[imported.loomId];
    expect(tree).toBeTruthy();
    expect(loaded.skippedIds).not.toContain(imported.loomId);

    // Root: the person's question, actor + origin surfaced per turn.
    const root = tree.root;
    expect(root.text).toBe("What is a loom?");
    expect(root.actor).toBe("deepfates");
    expect(root.origin).toBe("human");

    // The root branches — both children present, each a model turn.
    expect(root.continuations?.length).toBe(2);
    const childTexts = (root.continuations ?? []).map((c) => c.text).sort();
    expect(childTexts).toEqual(
      ["A branching record of turns.", "A tree of continuations."].sort(),
    );
    for (const child of root.continuations ?? []) {
      expect(child.actor).toBe(MODEL);
      expect(child.origin).toBe("model");
    }

    // Navigable down the main thread: question → answer → follow-up → answer.
    const mainReply = (root.continuations ?? []).find(
      (c) => c.text === "A branching record of turns.",
    )!;
    const followUp = mainReply.continuations?.[0];
    expect(followUp?.text).toBe("Can textile read one?");
    expect(followUp?.actor).toBe("deepfates");
    const finalReply = followUp?.continuations?.[0];
    expect(finalReply?.text).toBe("Yes.");
    expect(finalReply?.actor).toBe(MODEL);
    expect(finalReply?.origin).toBe("model");
  });
});
