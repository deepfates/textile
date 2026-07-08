import { describe, expect, it } from "bun:test";
import {
  createStoryIndexShareUrl,
  createStoryFocusShareUrl,
  createLocalStoryUrl,
  createStoryShareUrl,
  createStoryThreadShareUrl,
  getStoryReferenceFromLocation,
  reduceLyncSyncStatus,
} from "../storyRuntime";

describe("story runtime references", () => {
  it("creates loom reference URLs without carrying stale parameters", () => {
    const location = new URL("https://textile.test/?old=1#stale");

    const url = new URL(createStoryShareUrl("loom-1", location));

    expect([...url.searchParams.keys()]).toEqual(["ref"]);
    expect(url.hash).toBe("");
    expect(getStoryReferenceFromLocation(url)).toEqual({
      v: 1,
      kind: "loom",
      loomId: "loom-1",
    });
  });

  it("creates index reference URLs", () => {
    const location = new URL("https://textile.test/?draft=old");

    const url = new URL(createStoryIndexShareUrl("index-1", location));

    expect([...url.searchParams.keys()]).toEqual(["ref"]);
    expect(getStoryReferenceFromLocation(url)).toEqual({
      v: 1,
      kind: "index",
      indexId: "index-1",
    });
  });

  it("creates thread reference URLs", () => {
    const location = new URL("https://textile.test/");

    const url = new URL(createStoryThreadShareUrl("loom-1", "turn-1", location));

    expect(getStoryReferenceFromLocation(url)).toEqual({
      v: 1,
      kind: "thread",
      loomId: "loom-1",
      turnId: "turn-1",
    });
  });

  it("creates focus URLs as loom or thread references", () => {
    const location = new URL("https://textile.test/");

    expect(getStoryReferenceFromLocation(
      new URL(createStoryFocusShareUrl("loom-1", null, location)),
    )).toEqual({
      v: 1,
      kind: "loom",
      loomId: "loom-1",
    });
    expect(getStoryReferenceFromLocation(
      new URL(createStoryFocusShareUrl("loom-1", "turn-1", location)),
    )).toEqual({
      v: 1,
      kind: "thread",
      loomId: "loom-1",
      turnId: "turn-1",
    });
  });

  it("creates clean local URLs by removing only story references", () => {
    const location = new URL("https://textile.test/read?draft=1&ref=abc#turn");

    const url = new URL(createLocalStoryUrl(location));

    expect(url.pathname).toBe("/read");
    expect(url.searchParams.get("draft")).toBe("1");
    expect(url.searchParams.has("ref")).toBe(false);
    expect(url.hash).toBe("");
  });
});

describe("Lync sync status", () => {
  const initial = {
    state: "local-only" as const,
    detail: "initial",
  };

  it("reports connected only after a socket open event", () => {
    expect(reduceLyncSyncStatus(initial, { type: "connecting" })).toEqual({
      state: "reconnecting",
      detail: "Connecting to the Lync relay.",
    });

    expect(reduceLyncSyncStatus(initial, { type: "connected" })).toEqual({
      state: "connected",
      detail: "Lync relay connected.",
    });
  });

  it("reports reconnecting when the relay disconnects", () => {
    expect(reduceLyncSyncStatus(initial, { type: "disconnected" })).toEqual({
      state: "reconnecting",
      detail: "Lync relay unavailable; retrying.",
    });
  });

  it("reports local-only honestly for offline or unsupported runtimes", () => {
    expect(
      reduceLyncSyncStatus(initial, {
        type: "local-only",
        detail: "Browser is offline; stories are local only.",
      }),
    ).toEqual({
      state: "local-only",
      detail: "Browser is offline; stories are local only.",
    });
  });
});
