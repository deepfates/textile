import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ActionMenu, type MenuAction } from "../ActionMenu";

const render = (actions: MenuAction[], selected: number) =>
  renderToStaticMarkup(
    <ActionMenu actions={actions} selected={selected} onSelect={() => {}} />,
  );

const turnActions: MenuAction[] = [
  { id: "keep", label: "keep" },
  { id: "note", label: "note" },
  { id: "edit", label: "edit" },
];

describe("ActionMenu", () => {
  it("renders one tappable row per action", () => {
    const html = render(turnActions, 0);
    expect(html).toContain("keep");
    expect(html).toContain("note");
    expect(html).toContain("edit");
    expect(html.split("<button").length - 1).toBe(3);
  });

  it("marks only the cursor row as selected", () => {
    const html = render(turnActions, 2);
    expect(html.split("menu-item selected").length - 1).toBe(1);
  });

  it("is data-driven — the same menu works for any object's actions", () => {
    // A future object type (e.g. a story) supplies its own list; nothing about
    // the menu is turn-specific.
    const html = render(
      [
        { id: "open", label: "open" },
        { id: "delete", label: "delete" },
      ],
      1,
    );
    expect(html).toContain("open");
    expect(html).toContain("delete");
    expect(html.split("<button").length - 1).toBe(2);
  });
});
