import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { StoryShelf, type ShelfStory } from "../StoryShelf";

const stories: ShelfStory[] = [
  { id: "a", title: "Story 1", isCurrent: false },
  { id: "b", title: "Story 2", isCurrent: true },
];

const render = (selected: number) =>
  renderToStaticMarkup(
    <StoryShelf stories={stories} selected={selected} onOpen={() => {}} />,
  );

describe("StoryShelf", () => {
  it("renders one tappable row per story — every loom is a sibling", () => {
    const html = render(0);
    expect(html).toContain("Story 1");
    expect(html).toContain("Story 2");
    expect(html.split("<button").length - 1).toBe(2);
  });

  it("marks the current story so you can tell where you rose from", () => {
    const html = render(0);
    expect(html.split("story-menu-item--current").length - 1).toBe(1);
  });

  it("marks only the cursor row as selected", () => {
    const html = render(1);
    expect(html.split("menu-item story-menu-item selected").length - 1).toBe(1);
  });
});
