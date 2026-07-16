import { describe, expect, it } from "bun:test";

import { getRegisteredMode } from "../modeRegistry";

describe("modeRegistry", () => {
  it("advertises Enter and ArrowDown as row-entry keys from drawer tabs", () => {
    const mode = getRegisteredMode({
      screen: "drawer",
      projection: "loom",
      drawerTab: "stories",
      cursorOnTabs: true,
      editingModel: false,
    });

    expect(mode.id).toBe("drawer-tabs");
    expect(mode.hint).toContain("↵/↓: ROWS");
  });

  it("labels the shelf (root bin) and advertises open + actions", () => {
    const mode = getRegisteredMode({
      screen: null,
      projection: "bin",
      drawerTab: "stories",
      cursorOnTabs: false,
      editingModel: false,
    });

    expect(mode.id).toBe("bin");
    expect(mode.title).toBe("LOOMS");
    expect(mode.hint).toContain("◄►: DIAL");
    expect(mode.hint).toContain("⌫: ACTIONS");
  });

  it("shows the per-story action menu as its own mode", () => {
    const mode = getRegisteredMode({
      screen: "story-actions",
      projection: "bin",
      drawerTab: "stories",
      cursorOnTabs: false,
      editingModel: false,
    });

    expect(mode.id).toBe("story-actions");
  });
});
