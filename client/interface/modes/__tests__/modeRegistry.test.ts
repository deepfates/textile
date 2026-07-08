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
});
