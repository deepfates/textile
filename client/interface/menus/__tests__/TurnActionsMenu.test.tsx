import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TurnActionsMenu } from "../TurnActionsMenu";
import type { StoryNode } from "../../types";

const node = (kept?: boolean): StoryNode => ({
  id: "n",
  text: "a turn",
  continuations: [],
  origin: "model",
  kept,
});

const render = (n: StoryNode, selected: number) =>
  renderToStaticMarkup(
    <TurnActionsMenu node={n} selected={selected} onSelect={() => {}} />,
  );

describe("TurnActionsMenu", () => {
  it("offers keep, note, and edit on the focused turn", () => {
    const html = render(node(), 0);
    expect(html).toContain("keep");
    expect(html).toContain("note");
    expect(html).toContain("edit");
    // three tappable rows so the whole menu is touch-reachable, not keyboard-only.
    expect(html.split("<button").length - 1).toBe(3);
  });

  it("flips the keep label to un-keep when the turn is already kept", () => {
    expect(render(node(true), 0)).toContain("un-keep");
    expect(render(node(false), 0)).not.toContain("un-keep");
  });

  it("marks the cursor row as selected", () => {
    // selected=2 (edit) — that row, and no other, carries the `selected` class.
    const html = render(node(), 2);
    expect(html.split("menu-item selected").length - 1).toBe(1);
  });
});
