import { describe, expect, it } from "bun:test";
import { resolveLyncAuthMode } from "../lync";

describe("lync server config", () => {
  it("defaults websocket sync auth to site access", () => {
    expect(resolveLyncAuthMode(undefined)).toBe("site-access");
    expect(resolveLyncAuthMode("")).toBe("site-access");
    expect(resolveLyncAuthMode("api")).toBe("site-access");
  });

  it("can make /lync a public stock Automerge sync endpoint", () => {
    expect(resolveLyncAuthMode("public")).toBe("public");
    expect(resolveLyncAuthMode(" PUBLIC ")).toBe("public");
  });
});

