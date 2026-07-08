import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TreeListMenu } from "../TreeListMenu";

const trees = {
  "story-1": {
    root: {
      id: "root",
      text: "A first line that previews the story action row.",
      continuations: [],
    },
  },
};

describe("TreeListMenu story actions", () => {
  it("renders distinct, named link and thread actions with secondary exports grouped", () => {
    const html = renderToStaticMarkup(
      <TreeListMenu
        trees={trees}
        storyTitles={{ "story-1": "First story" }}
        selectedIndex={2}
        selectedColumn={0}
        sortOrder="recent"
        onToggleSort={() => undefined}
        onSelect={() => undefined}
        onNew={() => undefined}
        onShareStory={() => undefined}
        onShareThread={() => undefined}
        onShareIndex={() => undefined}
        onExportJson={() => undefined}
        onExportThread={() => undefined}
      />,
    );

    expect(html).toContain('aria-label="Index link"');
    expect(html).toContain('aria-label="Story link"');
    expect(html).toContain('aria-label="Thread link"');
    expect(html).toContain('aria-label="More story actions"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Export JSON"');
    expect(html).toContain('aria-label="Export thread"');
    expect(html).toContain('class="story-secondary-actions"');
  });
});
