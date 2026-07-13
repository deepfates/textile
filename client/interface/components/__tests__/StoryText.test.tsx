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

  it("leaves the reading prose fully untouched by authorship", () => {
    // A loom is a cursor tool: you learn who wrote a node in the map minibuffer,
    // never from the prose. No byline, no tint, no origin caption in the column.
    const html = render([human, model, unknown], 1);
    expect(html).not.toContain("story-origin");
    // No prose tint and no authorship chip in the reading column. Matched by
    // regex so this assertion does not itself reintroduce those class literals.
    expect(html).not.toMatch(/story-(tint|authorship)/);
    expect(html).not.toContain("model · test-model");
    expect(html).not.toContain("origin: model");
    expect(html).not.toContain("via: textile-browser");
  });
});
