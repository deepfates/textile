import { describe, expect, it } from "bun:test";
import { getResponsiveGamepadLayout } from "../useResponsiveGamepadLayout";

describe("getResponsiveGamepadLayout", () => {
  it("keeps landscape detection unchanged", () => {
    expect(getResponsiveGamepadLayout(1024, 600)).toEqual({
      layout: "landscape",
      portraitPhoneHeight: null,
    });
  });

  it("does not phone-tier wider portrait layouts", () => {
    expect(getResponsiveGamepadLayout(700, 1000)).toEqual({
      layout: "portrait",
      portraitPhoneHeight: null,
    });
  });

  it("tiers portrait phone heights for reachable controls", () => {
    expect(getResponsiveGamepadLayout(375, 740)).toEqual({
      layout: "portrait",
      portraitPhoneHeight: "compact",
    });
    expect(getResponsiveGamepadLayout(375, 812)).toEqual({
      layout: "portrait",
      portraitPhoneHeight: "regular",
    });
    expect(getResponsiveGamepadLayout(390, 844)).toEqual({
      layout: "portrait",
      portraitPhoneHeight: "tall",
    });
  });
});
