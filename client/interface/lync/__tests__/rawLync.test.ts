import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { createTestLoomClient } from "@deepfates/lync/client/testing";
import { projectRawLyncFile } from "../rawLync";
import { projectStoryTree, type ReadableLoom } from "../storyLoom";
import type {
  ConversationLoomMeta,
  ConversationTurnMeta,
  ConversationTurnPayload,
} from "../storyRuntime";

const fixtureUrl = new URL("./fixtures/corpus-loop.lync", import.meta.url);
const B = "0197e6a0-4a09-7000-8000-000000000002";
const C = "0197e6a0-4a09-7000-8000-000000000003";
const D = "0197e6a0-4a09-7000-8000-000000000004";

describe("raw .lync projection", () => {
  it("uses first-parent navigation while retaining source identity and annotations", () => {
    const projection = projectRawLyncFile(
      readFileSync(fixtureUrl, "utf8"),
      "corpus-loop.lync",
    );
    expect(projection.sourceEventCount).toBe(4);
    expect(projection.annotationCount).toBe(2);
    expect(projection.nonconformingCount).toBe(0);
    expect(projection.warnings).toEqual([]);

    const turns = new Map(projection.snapshot.turns.map((turn) => [turn.id, turn]));
    expect(turns.get(D)?.parentId).toBe(B);
    expect(turns.get(D)?.meta.sourceId).toBe(D);
    expect(turns.get(D)?.meta.sourceParents).toEqual([B, C]);
    expect(turns.get(D)?.meta.extraParentIds).toEqual([C]);
    expect(turns.get(D)?.meta.rawTags?.map((tag) => tag.tag)).toEqual([
      "cooperation",
    ]);
    expect(turns.get(B)?.meta.sourceSelected).toBe(true);
    expect(turns.get(C)?.meta.sourceSelected).toBe(false);
  });

  it("survives Lync snapshot import even when internal turn ids are reminted", async () => {
    const projection = projectRawLyncFile(readFileSync(fixtureUrl, "utf8"));
    const looms = createTestLoomClient<
      ConversationTurnPayload,
      ConversationLoomMeta,
      ConversationTurnMeta
    >().looms;
    const imported = await looms.import(projection.snapshot);
    const loom = await looms.open(imported.id);
    const tree = await projectStoryTree(loom as unknown as ReadableLoom);
    const all = flatten(tree.root);
    const d = all.find((node) => node.sourceId === D);
    expect(d?.id).not.toBe(D);
    expect(d?.sourceParents).toEqual([B, C]);
    expect(d?.extraParentIds).toEqual([C]);
    expect(d?.rawTags?.map((tag) => tag.tag)).toEqual(["cooperation"]);
    expect(all.find((node) => node.sourceId === B)?.kept).toBe(true);
  });

  it("fails closed on garbage and damaged physical lines", () => {
    expect(() => projectRawLyncFile("not-json\n", "broken.lync")).toThrow(
      /broken\.lync:1 garbage/,
    );
    const damaged = {
      ...event("0197e6a0-4a09-7000-8000-000000000011", [], "damaged"),
      digest: `sha256:${"0".repeat(64)}`,
    };
    expect(() => projectRawLyncFile(`${JSON.stringify(damaged)}\n`, "damaged.lync")).toThrow(
      /damaged\.lync:1 damaged/,
    );
  });

  it("fails closed on same-id conflicts", () => {
    const id = "0197e6a0-4a09-7000-8000-000000000021";
    const corpus = [event(id, [], "first"), event(id, [], "different")]
      .map(JSON.stringify)
      .join("\n");
    expect(() => projectRawLyncFile(`${corpus}\n`, "conflict.lync")).toThrow(
      /conflict-variant: same id with different body bytes/,
    );
  });

  it("fails closed on missing parents and cyclic graph obstacles", () => {
    const missing = "0197e6a0-4a09-7000-8000-000000000031";
    const child = event(
      "0197e6a0-4a09-7000-8000-000000000032",
      [missing],
      "orphan",
    );
    expect(() => projectRawLyncFile(`${JSON.stringify(child)}\n`, "orphan.lync")).toThrow(
      /graph dangling: .*needs/,
    );

    const a = "0197e6a0-4a09-7000-8000-000000000041";
    const b = "0197e6a0-4a09-7000-8000-000000000042";
    const cycle = [event(a, [b], "a"), event(b, [a], "b")]
      .map(JSON.stringify)
      .join("\n");
    expect(() => projectRawLyncFile(`${cycle}\n`, "cycle.lync")).toThrow(
      /graph cycle: 0197.*0041 -> 0197.*0042/,
    );
  });

  it("imports accepted nonconforming events but names every warning", () => {
    const input = {
      ...event("0197e6a0-4a09-7000-8000-000000000051", [], "carried"),
      mystery: true,
    };
    const projection = projectRawLyncFile(`${JSON.stringify(input)}\n`, "carried.lync");
    expect(projection.sourceEventCount).toBe(1);
    expect(projection.nonconformingCount).toBe(1);
    expect(projection.warnings).toEqual([
      "carried.lync:1 nonconforming: unknown top-level field mystery",
    ]);
    expect(projection.snapshot.turns.at(-1)?.meta.sourceWarnings).toEqual([
      "unknown top-level field mystery",
    ]);
  });
});

function flatten(node: import("../../types").StoryNode): import("../../types").StoryNode[] {
  return [node, ...(node.continuations ?? []).flatMap(flatten)];
}

function event(id: string, parents: string[], text: string) {
  return {
    v: 1,
    id,
    kind: "lync/artifact",
    at: "2026-07-06T04:10:00Z",
    author: { actor: "test" },
    parents,
    payload: { text },
  };
}
