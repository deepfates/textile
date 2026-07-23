import { describe, expect, it } from "bun:test";
import {
  buildKeptStoryExport,
  buildRawLyncSelectionEvents,
  collectKeptEntries,
  hasRawLyncSources,
} from "../storyExport";
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

describe("raw Lync selection export", () => {
  it("targets exact source siblings with the positive keep event identity", () => {
    const A = "0197e6a0-4a09-7000-8000-000000000001";
    const B = "0197e6a0-4a09-7000-8000-000000000002";
    const mark = "0197e6a0-4a09-7000-8000-00000000000e";
    const tree: { root: StoryNode } = {
      root: {
        id: "virtual",
        text: "corpus",
        origin: "unknown",
        continuations: [
          {
            id: "internal-a",
            sourceId: A,
            text: "A",
            origin: "model",
            kept: true,
            keepMark: { id: mark, createdAt: Date.parse("2026-07-06T04:10:15Z"), actor: "ada", via: "textile-browser" },
            continuations: [],
          },
          {
            id: "internal-b",
            sourceId: B,
            text: "B",
            origin: "model",
            continuations: [],
          },
        ],
      },
    };

    expect(hasRawLyncSources(tree.root)).toBe(true);
    expect(buildRawLyncSelectionEvents(tree)).toEqual([
      {
        v: 1,
        id: mark,
        kind: "lync/annotation",
        at: "2026-07-06T04:10:15.000Z",
        author: { actor: "ada", via: "textile-browser" },
        parents: [A, B],
        payload: {
          label: "selection",
          chosen: [A],
          shown: [A, B],
          basis: "human pick",
        },
      },
    ]);
  });

  it("does not duplicate a selection imported from the corpus", () => {
    const tree: { root: StoryNode } = {
      root: {
        id: "internal",
        sourceId: "0197e6a0-4a09-7000-8000-000000000001",
        text: "already selected",
        origin: "model",
        kept: true,
        continuations: [],
      },
    };
    expect(buildRawLyncSelectionEvents(tree)).toEqual([]);
  });
});
