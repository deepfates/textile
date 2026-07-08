import { describe, expect, it } from "bun:test";
import { devHmrClientOptions } from "../vite";

describe("devHmrClientOptions", () => {
  it("uses Vite defaults for a plain localhost dev run", () => {
    expect(devHmrClientOptions({})).toEqual({});
  });

  it("keeps HTTPS proxy HMR settings on Replit", () => {
    expect(devHmrClientOptions({ REPL_ID: "abc123" })).toEqual({
      clientPort: 443,
      protocol: "wss",
    });
  });

  it("treats legacy Replit markers as proxied dev hosts", () => {
    expect(devHmrClientOptions({ REPL_SLUG: "textile" })).toEqual({
      clientPort: 443,
      protocol: "wss",
    });
    expect(devHmrClientOptions({ REPLIT_DB_URL: "https://example.test" })).toEqual({
      clientPort: 443,
      protocol: "wss",
    });
  });
});
