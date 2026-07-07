import type React from "react";
import type { StoryNode } from "../types";

interface StoryTextProps {
  storyTextRef: React.RefObject<HTMLDivElement>;
  currentPath: StoryNode[];
  currentDepth: number;
  isGeneratingAt: (nodeId: string) => boolean;
}

export function StoryText({
  storyTextRef,
  currentPath,
  currentDepth,
  isGeneratingAt,
}: StoryTextProps) {
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

        if (isNextDepth) {
          const match = segment.text.match(/^([\s\S]*?)(\s*)$/);
          const body = match?.[1] ?? segment.text;
          const tail = match?.[2] ?? "";
          return (
            <span key={segment.id} data-node-id={segment.id}>
              <span className={spanClasses.join(" ")}>{body}</span>
              {tail}
            </span>
          );
        }
        return (
          <span
            key={segment.id}
            data-node-id={segment.id}
            className={spanClasses.join(" ")}
          >
            {segment.text}
          </span>
        );
      })}
    </div>
  );
}
