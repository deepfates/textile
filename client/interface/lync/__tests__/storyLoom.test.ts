import { describe, expect, it } from "bun:test";
import { createTestLoomClient } from "@deepfates/lync/client/testing";
import { textStoryLoomMeta } from "@deepfates/lync/profiles/text-story";
import {
  appendAnnotation,
  appendKeepMark,
  appendStoryDrafts,
  appendStoryRevision,
  projectStoryTree,
} from "../storyLoom";
import type {
  StoryDraft,
  StoryLoomMeta,
  StoryTurnMeta,
  StoryTurnPayload,
} from "../storyTypes";

function createLooms() {
  let nextId = 0;
  return createTestLoomClient<StoryTurnPayload, StoryLoomMeta, StoryTurnMeta>({
    createId: () => `turn-${++nextId}`,
    now: () => 1000 + nextId,
  }).looms;
}

describe("Textile story loom", () => {
  it("appends story drafts as Lync turns with durable generated IDs", async () => {
    const looms = createLooms();
    const info = await looms.create(textStoryLoomMeta({ title: "Story" }));
    const loom = await looms.open(info.id);
    const seed = await loom.appendTurn(null, { text: "Start" }, { role: "prose" });

    await appendStoryDrafts(loom, seed.id, [
      { text: "A" },
      { text: "B" },
    ]);

    const children = await loom.childrenOf(seed.id);
    expect(children.map((turn) => ({
      id: turn.id,
      parentId: turn.parentId,
      payload: turn.payload,
      meta: turn.meta,
    }))).toEqual([
      {
        id: "turn-3",
        parentId: seed.id,
        payload: { text: "A" },
        meta: { role: "prose" },
      },
      {
        id: "turn-4",
        parentId: seed.id,
        payload: { text: "B" },
        meta: { role: "prose" },
      },
    ]);
  });

  it("projects a branching loom in canonical child order", async () => {
    const looms = createLooms();
    const info = await looms.create(textStoryLoomMeta({ title: "Story" }));
    const loom = await looms.open(info.id);
    const seed = await loom.appendTurn(null, { text: "Start" }, { role: "prose" });

    await appendStoryDrafts(loom, seed.id, [
      { text: "A" },
      { text: "B" },
    ]);

    const [first] = await loom.childrenOf(seed.id);
    await appendStoryDrafts(loom, first.id, [{ text: "C" }]);

    expect(await projectStoryTree(loom, "Start")).toEqual({
      root: {
        id: seed.id,
        text: "Start",
        origin: "unknown",
        continuations: [
          {
            id: first.id,
            text: "A",
            origin: "unknown",
            continuations: [
              {
                id: "turn-5",
                text: "C",
                origin: "unknown",
                continuations: [],
              },
            ],
          },
          {
            id: "turn-4",
            text: "B",
            origin: "unknown",
            continuations: [],
          },
        ],
      },
    });
  });

  it("saves edits as a new sibling revision without copying descendants", async () => {
    const looms = createLooms();
    const info = await looms.create(textStoryLoomMeta({ title: "Story" }));
    const loom = await looms.open(info.id);

    const seed = await loom.appendTurn(null, { text: "Start" }, { role: "prose" });
    const original = await loom.appendTurn(seed.id, { text: "Original" });
    await loom.appendTurn(original.id, { text: "Original child" });

    const revision: StoryDraft = {
      text: "Edited",
      continuations: [
        {
          text: "Split tail",
          continuations: [],
        },
      ],
    };
    const appended = await appendStoryRevision(
      loom,
      seed.id,
      revision,
      original.id,
    );
    const tree = await projectStoryTree(loom, "Start");

    expect(tree.root.text).toBe("Start");
    expect(tree.root.continuations?.map((node) => node.text)).toEqual([
      "Original",
      "Edited",
    ]);
    expect(tree.root.continuations?.[0].continuations?.map((node) => node.text))
      .toEqual(["Original child"]);
    expect(tree.root.continuations?.[1]).toEqual({
      id: appended.id,
      text: "Edited",
      origin: "unknown",
      continuations: [
        {
          id: "turn-6",
          text: "Split tail",
          origin: "unknown",
          continuations: [],
        },
      ],
    });
  });

  it("projects root revisions without dropping generated children", async () => {
    const looms = createLooms();
    const info = await looms.create(textStoryLoomMeta({ title: "Story" }));
    const loom = await looms.open(info.id);

    const original = await loom.appendTurn(null, { text: "Start" }, { role: "prose" });
    await loom.appendTurn(original.id, { text: "Original child" }, { role: "prose" });

    await appendStoryRevision(
      loom,
      null,
      { text: "Edited root", continuations: [{ text: "Split tail" }] },
      original.id,
    );

    expect(await projectStoryTree(loom, "Start")).toEqual({
      root: {
        id: original.id,
        text: "Edited root",
        origin: "unknown",
        continuations: [
          {
            id: "turn-3",
            text: "Original child",
            origin: "unknown",
            continuations: [],
          },
          {
            id: "turn-5",
            text: "Split tail",
            origin: "unknown",
            continuations: [],
          },
        ],
      },
    });
  });

  it("ignores non-revision root siblings when projecting the seed story", async () => {
    const looms = createLooms();
    const info = await looms.create(textStoryLoomMeta({ title: "Story" }));
    const loom = await looms.open(info.id);

    const original = await loom.appendTurn(null, { text: "Start" }, { role: "prose" });
    await loom.appendTurn(original.id, { text: "Original child" }, { role: "prose" });
    await loom.appendTurn(null, { text: "Second root" }, { role: "prose" });

    expect(await projectStoryTree(loom, "Start")).toEqual({
      root: {
        id: original.id,
        text: "Start",
        origin: "unknown",
        continuations: [
          {
            id: "turn-3",
            text: "Original child",
            origin: "unknown",
            continuations: [],
          },
        ],
      },
    });
  });

  it("stamps generatedBy on model turns and leaves human turns unmarked", async () => {
    const looms = createLooms();
    const info = await looms.create(textStoryLoomMeta({ title: "Story" }));
    const loom = await looms.open(info.id);
    const seed = await loom.appendTurn(null, { text: "Start" }, {
      role: "prose",
      author: "ada",
      via: "textile-browser",
    });

    // Model turn: carries generatedBy + the person's actor/via.
    await appendStoryDrafts(loom, seed.id, [{ text: "M" }], {
      actor: "ada",
      via: "textile-browser",
      generatedBy: {
        model: "test-model",
        temperature: 0.7,
        lengthMode: "medium",
        textSplitting: false,
      },
    });
    // Human turn: actor/via but NO generatedBy.
    await appendStoryRevision(loom, seed.id, { text: "H" }, undefined, {
      actor: "ada",
      via: "textile-browser",
    });

    const [modelTurn, humanTurn] = await loom.childrenOf(seed.id);
    expect(modelTurn?.meta?.generatedBy).toEqual({
      model: "test-model",
      temperature: 0.7,
      lengthMode: "medium",
      textSplitting: false,
    });
    expect(modelTurn?.meta?.author).toBe("ada");
    expect(modelTurn?.meta?.via).toBe("textile-browser");
    expect(humanTurn?.meta?.generatedBy).toBeUndefined();
    expect(humanTurn?.meta?.author).toBe("ada");
  });

  it("folds a mixed human+model loom into StoryNodes carrying origin/actor", async () => {
    const looms = createLooms();
    const info = await looms.create(textStoryLoomMeta({ title: "Story" }));
    const loom = await looms.open(info.id);
    const seed = await loom.appendTurn(null, { text: "Start" }, {
      role: "prose",
      author: "ada",
      via: "textile-browser",
    });
    await appendStoryDrafts(loom, seed.id, [{ text: "Model line" }], {
      actor: "ada",
      via: "textile-browser",
      generatedBy: { model: "test-model" },
    });

    const { root } = await projectStoryTree(loom, "Start");
    expect(root.origin).toBe("human");
    expect(root.actor).toBe("ada");
    expect(root.via).toBe("textile-browser");
    expect(root.generatedBy).toBeUndefined();

    const modelChild = root.continuations?.[0];
    expect(modelChild?.origin).toBe("model");
    expect(modelChild?.actor).toBe("ada");
    expect(modelChild?.generatedBy).toEqual({ model: "test-model" });
  });

  it("reads imported turns without identity as unknown, never human", async () => {
    const looms = createLooms();
    const info = await looms.create(textStoryLoomMeta({ title: "Story" }));
    const loom = await looms.open(info.id);
    // Simulate an imported loom: turns carry NO author and NO generatedBy.
    const seed = await loom.appendTurn(null, { text: "Imported seed" }, {
      role: "prose",
    });
    // Simulate an imported MODEL turn: carries generatedBy but no author.
    await loom.appendTurn(seed.id, { text: "Imported model line" }, {
      role: "prose",
      generatedBy: { model: "some-model" },
    });

    const { root } = await projectStoryTree(loom, "Imported seed");
    // Unknowable origin must NOT silently read as human.
    expect(root.origin).toBe("unknown");
    // An imported turn carrying generatedBy still reads as model.
    expect(root.continuations?.[0]?.origin).toBe("model");
  });

  it("keeps a turn as a mark event that survives a reload and un-keeps", async () => {
    const looms = createLooms();
    const info = await looms.create(textStoryLoomMeta({ title: "Story" }));
    const loom = await looms.open(info.id);
    const seed = await loom.appendTurn(null, { text: "Start" }, { role: "prose" });
    await appendStoryDrafts(loom, seed.id, [{ text: "A" }]);
    const [child] = await loom.childrenOf(seed.id);

    // KEEP the child turn.
    await appendKeepMark(loom, child.id, true, {
      actor: "ada",
      via: "textile-browser",
    });

    // Reload: a FRESH loom handle re-folds from the event log, not memory.
    const reopened = await looms.open(info.id);
    const kept = await projectStoryTree(reopened, "Start");
    expect(kept.root.continuations?.[0]?.kept).toBe(true);
    // The mark turn is NOT a story continuation — story flow is unchanged.
    expect(kept.root.continuations?.map((n) => n.text)).toEqual(["A"]);
    expect(kept.root.continuations?.[0]?.continuations).toEqual([]);

    // UN-KEEP: append a second mark; the latest wins, nothing is deleted.
    await appendKeepMark(loom, child.id, false);
    const unkept = await projectStoryTree(await looms.open(info.id), "Start");
    expect(unkept.root.continuations?.[0]?.kept).toBe(false);
  });

  it("annotates a turn as a note event (parent=turn) that survives a reload", async () => {
    const looms = createLooms();
    const info = await looms.create(textStoryLoomMeta({ title: "Story" }));
    const loom = await looms.open(info.id);
    const seed = await loom.appendTurn(null, { text: "Start" }, { role: "prose" });
    await appendStoryDrafts(loom, seed.id, [{ text: "A" }]);
    const [child] = await loom.childrenOf(seed.id);

    const note = await appendAnnotation(loom, child.id, "  keep this one  ", {
      actor: "ada",
      via: "textile-browser",
    });
    // The annotation is a real turn parented to the target turn.
    expect(note.parentId).toBe(child.id);
    expect(note.meta?.role).toBe("annotation");
    expect(note.payload).toEqual({ text: "keep this one" });

    // Reload: the note re-renders on its node from the event log.
    const reloaded = await projectStoryTree(await looms.open(info.id), "Start");
    const annotated = reloaded.root.continuations?.[0];
    expect(annotated?.annotations).toEqual([
      {
        id: note.id,
        text: "keep this one",
        actor: "ada",
        via: "textile-browser",
        createdAt: note.createdAt,
      },
    ]);
    // The note is not a story continuation.
    expect(annotated?.continuations).toEqual([]);
  });

  it("rejects an empty annotation, loudly (never persists a blank note)", async () => {
    const looms = createLooms();
    const info = await looms.create(textStoryLoomMeta({ title: "Story" }));
    const loom = await looms.open(info.id);
    const seed = await loom.appendTurn(null, { text: "Start" }, { role: "prose" });
    await expect(appendAnnotation(loom, seed.id, "   ")).rejects.toThrow(
      "Cannot save an empty annotation",
    );
  });

  it("rejects turns with no readable text field, loudly (never blanks them)", async () => {
    // The generic reader accepts story `text` OR conversation `message`. A
    // payload carrying NEITHER is a shape the reader can't open yet — it must
    // surface loudly, never render as a silent blank turn (NOTHING-SILENT).
    const looms = createLooms();
    const info = await looms.create(textStoryLoomMeta({ title: "Story" }));
    const loom = await looms.open(info.id);
    const unsafeLoom = loom as unknown as {
      appendTurn(
        parentId: string | null,
        payload: unknown,
        meta?: unknown,
      ): Promise<unknown>;
    };

    await unsafeLoom.appendTurn(null, { value: "Start" }, { role: "prose" });

    await expect(projectStoryTree(loom, "Start")).rejects.toThrow(
      "Turn payload has no readable text",
    );
  });
});
