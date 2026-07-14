import { describe, expect, it } from "bun:test";
import { createTestLoomClient } from "@deepfates/lync/client/testing";
import { deriveTurnText, projectStoryTree } from "../storyLoom";
import type { ReadableLoom } from "../storyLoom";

/**
 * The proof that textile can read a NON-story lync loom: a CONVERSATION loom.
 *
 * A conversation turn is shaped like what splice's lync-claude-session import
 * emits — the actor is a person (`"deepfates"`) or a model id, the role is
 * `"user"`/`"assistant"`, and the text lives in `payload.message` (NOT the
 * story `payload.text`). Everything here is SYNTHETIC and hand-made; no real
 * session content is touched.
 */

/** A conversation turn's payload: text lives in `message`, not `text`. */
interface ConversationPayload {
  message: string;
}
/** A conversation turn's meta: the role + the actor identity (provenance). */
interface ConversationMeta {
  role: "user" | "assistant";
  author: string;
}
interface ConversationLoomMeta {
  profile: "conversation";
  title?: string;
}

function createConversationLooms() {
  let nextId = 0;
  return createTestLoomClient<
    ConversationPayload,
    ConversationLoomMeta,
    ConversationMeta
  >({
    createId: () => `turn-${++nextId}`,
    now: () => 1000 + nextId,
  }).looms;
}

/**
 * Hand-build a synthetic conversation loom via the REAL @deepfates/lync API:
 * a user turn, an assistant reply, a user follow-up, an assistant reply. The
 * actor rides in `meta.author` (deepfates for user turns, a model id for
 * assistant turns) exactly the way the story fold already reads provenance.
 */
async function seedConversation() {
  const looms = createConversationLooms();
  const info = await looms.create({ profile: "conversation", title: "Chat" });
  // NOTE: cast to the generic reader type — the reader is payload-agnostic.
  const loom = await looms.open(info.id);

  const q1 = await loom.appendTurn(
    null,
    { message: "What is a loom?" },
    { role: "user", author: "deepfates" },
  );
  const a1 = await loom.appendTurn(
    q1.id,
    { message: "A branching record of turns." },
    { role: "assistant", author: "some-model-id" },
  );
  const q2 = await loom.appendTurn(
    a1.id,
    { message: "Can textile read one?" },
    { role: "user", author: "deepfates" },
  );
  await loom.appendTurn(
    q2.id,
    { message: "Yes — this test proves it." },
    { role: "assistant", author: "some-model-id" },
  );
  return loom as unknown as ReadableLoom;
}

describe("Textile conversation loom (non-story)", () => {
  it("reads payload.message where a story turn would carry payload.text", () => {
    // The single generalization: display text comes from `text` OR `message`.
    expect(deriveTurnText({ message: "hi there" })).toBe("hi there");
    expect(deriveTurnText({ text: "story text" })).toBe("story text");
    // A structured Claude message (string content) still yields its text.
    expect(deriveTurnText({ message: { role: "user", content: "block text" } })).toBe(
      "block text",
    );
    // An array of content blocks concatenates their text.
    expect(
      deriveTurnText({
        message: { content: [{ type: "text", text: "one " }, { type: "text", text: "two" }] },
      }),
    ).toBe("one two");
  });

  it("projects a conversation loom, rendering each turn's ACTOR and MESSAGE", async () => {
    const loom = await seedConversation();
    const { root } = await projectStoryTree(loom, "");

    // Root user turn: message text is read (NOT blank), actor is the person,
    // origin is human.
    expect(root.text).toBe("What is a loom?");
    expect(root.actor).toBe("deepfates");
    expect(root.origin).toBe("human");

    // Assistant reply: message read, actor is the model id, origin is model.
    const reply = root.continuations?.[0];
    expect(reply?.text).toBe("A branching record of turns.");
    expect(reply?.actor).toBe("some-model-id");
    expect(reply?.origin).toBe("model");

    // The conversation threads on down, alternating actors — a navigable loom.
    const followUp = reply?.continuations?.[0];
    expect(followUp?.text).toBe("Can textile read one?");
    expect(followUp?.actor).toBe("deepfates");
    expect(followUp?.origin).toBe("human");

    const finalReply = followUp?.continuations?.[0];
    expect(finalReply?.text).toBe("Yes — this test proves it.");
    expect(finalReply?.actor).toBe("some-model-id");
    expect(finalReply?.origin).toBe("model");
  });

  it("never renders a conversation turn blank (message text always surfaces)", async () => {
    const loom = await seedConversation();
    const { root } = await projectStoryTree(loom, "");
    // Walk the whole thread; every turn has non-empty text and a known actor.
    let node = root as typeof root | undefined;
    let count = 0;
    while (node) {
      expect(node.text.length).toBeGreaterThan(0);
      expect(node.actor).toBeTruthy();
      count += 1;
      node = node.continuations?.[0];
    }
    expect(count).toBe(4);
  });
});
