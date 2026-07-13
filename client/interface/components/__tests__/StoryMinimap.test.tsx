import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StoryMinimap } from "../StoryMinimap";
import type { StoryNode } from "../../types";

// A two-node tree: a human seed with a single model continuation. With
// currentDepth 0 the minibuffer narrates the selected sibling (the model
// continuation), so its who-tag reads "model".
const model: StoryNode = {
  id: "m",
  text: "the frontier line",
  continuations: [],
  origin: "model",
  actor: "ada",
  via: "textile-browser",
  generatedBy: { model: "test-model", temperature: 0.7 },
};
const root: StoryNode = {
  id: "root",
  text: "A human seed.",
  continuations: [model],
  origin: "human",
  actor: "ada",
  via: "textile-browser",
};

function render(authorshipDisplay: "on" | "off"): string {
  return renderToStaticMarkup(
    <StoryMinimap
      tree={{ root }}
      currentDepth={0}
      selectedOptions={[0]}
      currentPath={[root, model]}
      inFlight={new Set<string>()}
      generatingInfo={{}}
      isVisible
      lastMapNodeId={null}
      currentNodeId={root.id}
      authorshipDisplay={authorshipDisplay}
    />,
  );
}

describe("StoryMinimap minibuffer authorship", () => {
  it("On: narrates the focused node's who-tag beside the text", () => {
    const html = render("on");
    expect(html).toContain("minimap-minibuffer-who");
    expect(html).toContain("model · ");
    expect(html).toContain("the frontier line");
  });

  it("Off: hides the who-tag but still shows the node text", () => {
    const html = render("off");
    expect(html).not.toContain("minimap-minibuffer-who");
    expect(html).not.toContain("model · ");
    expect(html).toContain("the frontier line");
  });
});
