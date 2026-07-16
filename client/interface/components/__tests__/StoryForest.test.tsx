import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { StoryForest, type ForestStory } from "../StoryForest";

const stories = [
  { id: "a", title: "Story 1", tree: { root: { id: "a0", text: "once", continuations: [] } }, isCurrent: false },
  { id: "b", title: "Story 2", tree: { root: { id: "b0", text: "twice", continuations: [] } }, isCurrent: true },
] as unknown as ForestStory[];

const render = (selected: number) =>
  renderToStaticMarkup(
    <StoryForest
      stories={stories}
      selected={selected}
      onFocus={() => {}}
      onDescend={() => {}}
    />,
  );

describe("StoryForest", () => {
  it("shows every story as a root on the dial", () => {
    const html = render(0);
    expect(html).toContain("Story 1");
    expect(html).toContain("Story 2");
  });

  it("pins exactly one root as the centered selection", () => {
    const html = render(1);
    expect(html.split("story-forest-root selected").length - 1).toBe(1);
  });

  it("translates the row so the selected root lands at the center", () => {
    // FOREST_CELL 220, selected index 1 → -(1 + 0.5) * 220 = -330px
    const html = render(1);
    expect(html).toContain("translateX(-330px)");
  });

  it("marks the current story", () => {
    const html = render(0);
    expect(html).toContain("story-forest-root-tag");
  });
});
