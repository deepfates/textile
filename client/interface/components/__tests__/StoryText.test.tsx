import { describe, expect, it } from "bun:test";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StoryText } from "../StoryText";
import type { StoryNode } from "../../types";

function render(path: StoryNode[], currentDepth: number): string {
  return renderToStaticMarkup(
    <StoryText
      storyTextRef={createRef<HTMLDivElement>()}
      currentPath={path}
      currentDepth={currentDepth}
      isGeneratingAt={() => false}
    />,
  );
}

describe("StoryText origin marker", () => {
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

  it("distinguishes a model frontier turn with the quiet theme-var channel", () => {
    const html = render([human, model], 1);
    // The single quiet byline uses an origin-specific modifier class (theme-var
    // color) and spells out actor/via/origin in the accessible label.
    expect(html).toContain("story-origin--model");
    expect(html).toContain("model · test-model");
    expect(html).toContain("origin: model");
    expect(html).toContain("author: ada");
    expect(html).toContain("via: textile-browser");
  });

  it("distinguishes a human frontier turn from a model one", () => {
    const html = render([model, human], 1);
    expect(html).toContain("story-origin--human");
    expect(html).not.toContain("story-origin--model");
  });

  it("marks an unknown-origin frontier turn as unknown, not human", () => {
    const html = render([unknown], 0);
    expect(html).toContain("story-origin--unknown");
    expect(html).toContain("origin: unknown");
    expect(html).not.toContain("story-origin--human");
  });
});
