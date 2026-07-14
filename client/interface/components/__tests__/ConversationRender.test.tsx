import { describe, expect, it } from "bun:test";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTestLoomClient } from "@deepfates/lync/client/testing";
import { StoryText } from "../StoryText";
import { projectStoryTree, type ReadableLoom } from "../../lync/storyLoom";
import type { StoryNode } from "../../types";

/**
 * End-to-end (store → fold → render) proof that a NON-story CONVERSATION loom
 * shows up LEGIBLY in textile's reading surface: each turn's MESSAGE as prose
 * and each turn's ACTOR as machine-legible `data-actor`, in the same
 * GameBoy/StoryText idiom the story flow uses. All SYNTHETIC.
 */

interface ConversationPayload {
  message: string;
}
interface ConversationMeta {
  role: "user" | "assistant";
  author: string;
}

async function seedConversationLoom(): Promise<ReadableLoom> {
  let nextId = 0;
  const looms = createTestLoomClient<
    ConversationPayload,
    { profile: "conversation" },
    ConversationMeta
  >({ createId: () => `turn-${++nextId}`, now: () => 1000 + nextId }).looms;
  const info = await looms.create({ profile: "conversation" });
  const loom = await looms.open(info.id);
  const q = await loom.appendTurn(
    null,
    { message: "Ask the model something." },
    { role: "user", author: "deepfates" },
  );
  await loom.appendTurn(
    q.id,
    { message: "The model answers here." },
    { role: "assistant", author: "some-model-id" },
  );
  return loom as unknown as ReadableLoom;
}

/** Flatten the main (first-child) thread into a StoryText path. */
function mainThread(root: StoryNode): StoryNode[] {
  const path: StoryNode[] = [];
  let node: StoryNode | undefined = root;
  while (node) {
    path.push(node);
    node = node.continuations?.[0];
  }
  return path;
}

describe("Conversation loom in the reading surface", () => {
  it("renders each conversation turn's message and actor legibly", async () => {
    const loom = await seedConversationLoom();
    const { root } = await projectStoryTree(loom, "");
    const path = mainThread(root);

    const html = renderToStaticMarkup(
      <StoryText
        storyTextRef={createRef<HTMLDivElement>()}
        currentPath={path}
        currentDepth={0}
        isGeneratingAt={() => false}
        authorshipDisplay="ambient"
      />,
    );

    // The MESSAGE text of both turns is on screen (not blank).
    expect(html).toContain("Ask the model something.");
    expect(html).toContain("The model answers here.");
    // WHO spoke each turn is legible per turn: the person and the model id.
    expect(html).toContain('data-actor="deepfates"');
    expect(html).toContain('data-actor="some-model-id"');
    // And origin is derived correctly for a conversation loom.
    expect(html).toContain('data-origin="human"');
    expect(html).toContain('data-origin="model"');
  });
});
