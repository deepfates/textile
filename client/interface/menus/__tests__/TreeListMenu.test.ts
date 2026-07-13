import { describe, expect, it } from "bun:test";
import {
  countStoryNodes,
  formatStoryDateLabel,
  getStoryRowPreview,
} from "../TreeListMenu";
import type { StoryNode } from "../../types";

const story = (root: StoryNode) => ({ root });

describe("TreeListMenu row metadata", () => {
  it("counts story nodes across nested continuations", () => {
    expect(
      countStoryNodes({
        id: "root",
        text: "Root",
        origin: "unknown",
        continuations: [
          { id: "a", text: "A", origin: "unknown" },
          {
            id: "b",
            text: "B",
            origin: "unknown",
            continuations: [{ id: "c", text: "C", origin: "unknown" }],
          },
        ],
      }),
    ).toBe(4);
  });

  it("formats edited dates compactly for the current year", () => {
    expect(
      formatStoryDateLabel(
        "2026-07-07T19:46:00.000Z",
        "edited",
        new Date("2026-08-01T00:00:00.000Z"),
      ),
    ).toBe("edited Jul 7");
  });

  it("keeps the year when edited outside the current year", () => {
    expect(
      formatStoryDateLabel(
        "2025-12-31T23:00:00.000Z",
        "created",
        new Date("2026-08-01T00:00:00.000Z"),
      ),
    ).toBe("created Dec 31, 2025");
  });

  it("builds a compact current-story preview with count, date, and text", () => {
    expect(
      getStoryRowPreview({
        tree: story({
          id: "root",
          text: "  The opening line\nwith extra spacing  ",
          origin: "unknown",
          continuations: [{ id: "next", text: "Next", origin: "unknown" }],
        }),
        isCurrent: true,
        metaDateLabel: "opened Jul 7",
      }),
    ).toBe("current · 2 nodes · opened Jul 7 · The opening line with extra spacing");
  });
});
