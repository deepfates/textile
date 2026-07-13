import type React from "react";
import type { StoryNode } from "../types";
import type { AuthorshipDisplay } from "../lync/storyRuntime";

interface StoryTextProps {
  storyTextRef: React.RefObject<HTMLDivElement>;
  currentPath: StoryNode[];
  currentDepth: number;
  isGeneratingAt: (nodeId: string) => boolean;
  /**
   * How loudly authorship touches the reader. Only "detail" tints the prose
   * (model turns read faintly recessed); "off"/"ambient" leave it UNTOUCHED —
   * the reading column stays clean by default. The taste call lives in the
   * SELECT:CONFIG dial, never baked into the reading surface.
   */
  authorshipDisplay: AuthorshipDisplay;
}

export function StoryText({
  storyTextRef,
  currentPath,
  currentDepth,
  isGeneratingAt,
  authorshipDisplay,
}: StoryTextProps) {
  const tint = authorshipDisplay === "detail";
  return (
    <div ref={storyTextRef} className="story-text">
      {currentPath.map((segment, index) => {
        const isCurrentDepth = index === currentDepth;
        const isNextDepth = index === currentDepth + 1;
        const isLoading = isGeneratingAt(segment.id);

        const spanClasses = ["story-node"];
        if (isNextDepth) {
          spanClasses.push("cursor-node");
        } else if (isCurrentDepth) {
          spanClasses.push("text-theme-text");
        } else if (index < currentDepth) {
          spanClasses.push("text-theme-text", "opacity-80");
        } else {
          spanClasses.push("text-theme-text", "opacity-55");
        }
        if (isLoading) {
          spanClasses.push("opacity-50");
        }
        // Detail mode only: a subtle per-origin tint so model turns read faintly
        // recessed. Theme-var color-mix, no caption — prose text is unchanged in
        // every other mode.
        if (tint) {
          spanClasses.push(`story-tint--${segment.origin}`);
        }

        if (isNextDepth) {
          const match = segment.text.match(/^([\s\S]*?)(\s*)$/);
          const body = match?.[1] ?? segment.text;
          const tail = match?.[2] ?? "";
          return (
            <span key={segment.id} data-node-id={segment.id}>
              <span
                className={spanClasses.join(" ")}
                data-origin={segment.origin}
              >
                {body}
              </span>
              {tail}
            </span>
          );
        }
        return (
          <span
            key={segment.id}
            data-node-id={segment.id}
            data-origin={segment.origin}
            className={spanClasses.join(" ")}
          >
            {segment.text}
          </span>
        );
      })}
    </div>
  );
}
