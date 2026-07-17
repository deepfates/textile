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
  it("shows every loom as a root-pill (title only as an aria-label, no visible text)", () => {
    const html = render(0);
    expect(html.split("story-forest-pill").length - 1).toBe(2);
    expect(html).toContain('aria-label="Story 1"');
    expect(html).toContain('aria-label="Story 2"');
    // No visible title/tag chrome on the floor.
    expect(html).not.toContain("story-forest-root-label");
    expect(html).not.toContain("story-forest-root-tag");
  });

  it("pins exactly one root as the centered selection", () => {
    const html = render(1);
    expect(html.split('aria-current="true"').length - 1).toBe(1);
  });

  it("translates the row so the selected root lands at the center", () => {
    // FOREST_PITCH 34, selected index 1 → -(1 + 0.5) * 34 = -51px
    const html = render(1);
    expect(html).toContain("translateX(-51px)");
  });

  it("marks the current loom with the map's current treatment", () => {
    const html = render(0); // story b (index 1) is current, not selected
    expect(html).toContain("story-forest-cell current");
  });
});
