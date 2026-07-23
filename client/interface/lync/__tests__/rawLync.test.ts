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
    expect(projection.diagnosticCount).toBe(0);

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
});

function flatten(node: import("../../types").StoryNode): import("../../types").StoryNode[] {
  return [node, ...(node.continuations ?? []).flatMap(flatten)];
}
