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

  it("routes every action-overlay (turn / story / floor / delete-confirm) through one 'menu' mode", () => {
    // Title + hint now come from the active Menu descriptor at runtime, so the
    // registry only needs to identify the single unified door.
    const mode = getRegisteredMode({
      screen: "menu",
      projection: "loom",
      drawerTab: "stories",
      cursorOnTabs: false,
      editingModel: false,
    });

    expect(mode.id).toBe("menu");
  });
});
