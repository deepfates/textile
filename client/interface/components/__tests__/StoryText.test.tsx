import { describe, expect, it } from "bun:test";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StoryText } from "../StoryText";
import type { StoryNode } from "../../types";
import type { AuthorshipDisplay } from "../../lync/storyRuntime";

function render(
  path: StoryNode[],
  currentDepth: number,
  authorshipDisplay: AuthorshipDisplay = "ambient",
): string {
  return renderToStaticMarkup(
    <StoryText
      storyTextRef={createRef<HTMLDivElement>()}
      currentPath={path}
      currentDepth={currentDepth}
      isGeneratingAt={() => false}
      authorshipDisplay={authorshipDisplay}
    />,
  );
}

describe("StoryText prose surface", () => {
  const human: StoryNode = {
    id: "h",
    text: "A human seed.",
    continuations: [],
    origin: "human",
    actor: "ada",
    via: "textile-browser",
  };
  const model: StoryNode = {
    id: "m",
    text: " a model continuation.",
    continuations: [],
    origin: "model",
    actor: "ada",
    via: "textile-browser",
    generatedBy: { model: "test-model", temperature: 0.7 },
  };
  const unknown: StoryNode = {
    id: "u",
    text: "An imported turn.",
    continuations: [],
    origin: "unknown",
  };

  it("tags every rendered turn with a machine-legible data-origin", () => {
    const html = render([human, model], 1);
    expect(html).toContain('data-origin="human"');
    expect(html).toContain('data-origin="model"');
  });

  it("tags every rendered turn with a machine-legible data-actor and data-via", () => {
    // Authorship (the PERSON's actor, separate from the controller via) is
    // legible in the DOM per turn, paralleling data-origin — so an outside
    // checker can read who authored each turn without opening the store.
    const html = render([human, model], 1);
    expect(html).toContain('data-actor="ada"');
    expect(html).toContain('data-via="textile-browser"');
  });

  it("carries data-actor on the cursor (next-depth) turn too", () => {
    // The cursor-node branch wraps the frontier turn differently; authorship
    // must ride it just the same, so sibling enumeration can read the actor of
    // whichever continuation is on the path.
    const grace: StoryNode = {
      id: "g",
      text: " grace's turn.",
      continuations: [],
      origin: "human",
      actor: "grace",
      via: "textile-browser",
    };
    const html = render([human, grace], 0);
    expect(html).toContain('data-actor="grace"');
  });

  it("renders NO author byline in the reading column by default (Ambient)", () => {
    const html = render([human, model], 1);
    // Re-homed to the status strip: the prose column stays clean. None of the
    // old byline class, spelled-out label, or detail line appears in the prose.
    expect(html).not.toContain("story-origin");
    expect(html).not.toContain("model · test-model");
    expect(html).not.toContain("origin: model");
    expect(html).not.toContain("via: textile-browser");
  });

  it("renders NO byline and NO tint in Off mode", () => {
    const html = render([human, model], 1, "off");
    expect(html).not.toContain("story-origin");
    expect(html).not.toContain("story-tint");
  });

  it("adds a per-origin prose tint class ONLY in Detail mode", () => {
    const ambient = render([human, model], 1, "ambient");
    expect(ambient).not.toContain("story-tint");

    const detail = render([human, model], 1, "detail");
    expect(detail).toContain("story-tint--human");
    expect(detail).toContain("story-tint--model");
    // Still no caption — Detail tints, it does not spell out under the prose.
    expect(detail).not.toContain("story-origin");
  });

  it("tints an unknown turn in Detail mode too", () => {
    const detail = render([unknown], 0, "detail");
    expect(detail).toContain("story-tint--unknown");
  });
});
