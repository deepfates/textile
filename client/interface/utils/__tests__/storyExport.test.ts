import { describe, expect, it } from "bun:test";
import { buildKeptStoryExport, collectKeptEntries } from "../storyExport";
import type { StoryNode } from "../../types";

// A small curated tree: root → (A kept) → (A1) , (B) , where A carries a note.
// Only A is kept, so the curated set must contain exactly A (with its note and
// its root→A thread), never B or A1.
function curatedTree(): { root: StoryNode } {
  return {
    root: {
      id: "root",
      text: "Seed",
      origin: "human",
      actor: "ada",
      continuations: [
        {
          id: "A",
          text: "Kept branch",
          origin: "model",
          actor: "ada",
          kept: true,
          annotations: [
            { id: "n1", text: "training-worthy", actor: "ada", createdAt: 10 },
          ],
          continuations: [
            { id: "A1", text: "Child of kept", origin: "model", continuations: [] },
          ],
        },
        {
          id: "B",
          text: "Discarded branch",
          origin: "model",
          continuations: [],
        },
      ],
    },
  };
}

describe("curated (KEPT) export", () => {
  it("collects exactly the kept turns, with annotations and thread", () => {
    const entries = collectKeptEntries(curatedTree().root);
    expect(entries.map((e) => e.id)).toEqual(["A"]);
    const [a] = entries;
    expect(a.text).toBe("Kept branch");
    expect(a.origin).toBe("model");
    expect(a.annotations.map((n) => n.text)).toEqual(["training-worthy"]);
    // Thread is the root→node path so the kept line has its context.
    expect(a.thread.map((t) => t.id)).toEqual(["root", "A"]);
  });

  it("emits ONLY the kept set in the curated payload", () => {
    const tree = curatedTree();
    // Mark the root kept too — the set is now {root, A}, still never B or A1.
    tree.root.kept = true;
    const payload = buildKeptStoryExport("Story 1", tree);
    expect(payload.kind).toBe("curated");
    expect(payload.title).toBe("Story 1");
    expect(payload.kept.map((e) => e.id)).toEqual(["root", "A"]);
  });

  it("emits an empty curated set when nothing is kept (visible, not silent)", () => {
    const tree = curatedTree();
    // Drop every keep mark.
    tree.root.continuations![0].kept = undefined;
    const payload = buildKeptStoryExport("Story 1", tree);
    expect(payload.kept).toEqual([]);
  });
});
