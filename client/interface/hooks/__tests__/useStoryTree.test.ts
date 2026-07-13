import { describe, expect, it } from "bun:test";
import { loomRef, type LoomReference } from "@deepfates/lync";
import { createTestLoomClient } from "@deepfates/lync/client/testing";
import { textStoryLoomMeta } from "@deepfates/lync/profiles/text-story";
import {
  chooseInitialStoryKey,
  INITIAL_STORY,
  loadReachableStoryEntries,
} from "../useStoryTree";
import type {
  StoryEntryMeta,
  StoryLoomMeta,
  StoryTurnMeta,
  StoryTurnPayload,
} from "../../lync/storyTypes";

describe("loadReachableStoryEntries", () => {
  type LoomOnlyReference = Extract<LoomReference, { kind: "loom" }>;
  const testLoomRef = (loomId: string) => loomRef(loomId) as LoomOnlyReference;

  it("skips unreachable index entries while keeping reachable stories", async () => {
    let nextId = 0;
    const client = createTestLoomClient<
      StoryTurnPayload,
      StoryLoomMeta,
      StoryTurnMeta,
      StoryEntryMeta
    >({
      createId: () => `id-${++nextId}`,
      now: () => nextId,
    });
    const info = await client.looms.create(
      textStoryLoomMeta({ title: "Reachable story" }),
    );
    const loom = await client.looms.open(info.id);
    await loom.appendTurn(null, { text: "Reachable opening" }, { role: "prose" });
    const skipped: string[] = [];

    const loaded = await loadReachableStoryEntries(
      [
        {
          ref: testLoomRef("memory:missing"),
          title: "Broken story",
          addedAt: 1,
        },
        {
          ref: testLoomRef(info.id),
          title: "Reachable listing",
          addedAt: 2,
        },
      ],
      (loomId) => client.looms.open(loomId),
      INITIAL_STORY.root.text,
      (loomId) => skipped.push(loomId),
    );

    expect(skipped).toEqual(["memory:missing"]);
    expect(loaded.orderedIds).toEqual([info.id]);
    expect(Object.keys(loaded.loomsById)).toEqual([info.id]);
    expect(loaded.titles).toEqual({ [info.id]: "Reachable listing" });
    expect(loaded.trees[info.id].root.text).toBe("Reachable opening");

    await client.close();
  });
});

describe("chooseInitialStoryKey", () => {
  const loaded = {
    orderedIds: ["story-a", "story-b"],
    trees: {
      "story-a": { root: { id: "a", text: "A", continuations: [] } },
      "story-b": { root: { id: "b", text: "B", continuations: [] } },
    },
  };

  it("boots the most recently active story instead of index order", () => {
    expect(
      chooseInitialStoryKey(loaded, null, null, {
        "story-a": {
          key: "story-a",
          createdAt: "2026-07-01T00:00:00.000Z",
          lastActiveAt: "2026-07-02T00:00:00.000Z",
        },
        "story-b": {
          key: "story-b",
          createdAt: "2026-07-01T00:00:00.000Z",
          lastActiveAt: "2026-07-05T00:00:00.000Z",
          openCount: 3,
        },
      }),
    ).toBe("story-b");
  });

  it("keeps explicit focus above metadata recency", () => {
    expect(
      chooseInitialStoryKey(loaded, null, "story-a", {
        "story-b": {
          key: "story-b",
          createdAt: "2026-07-01T00:00:00.000Z",
          lastActiveAt: "2026-07-05T00:00:00.000Z",
        },
      }),
    ).toBe("story-a");
  });
});
