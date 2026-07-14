import { useEffect } from "react";

import {
  importConversationLoomText,
  type ImportedConversation,
} from "../lync/storyRuntime";

/**
 * The running-app entry path for a conversation loom: drop a snapshot file
 * (splice's `convertClaudeSessionToLoomFile` output — a session framed as a
 * lync conversation loom) anywhere on the window to import it and open it.
 *
 * Drag-and-drop deliberately lives OUTSIDE the keyboard-driven story grid: it
 * adds no rows to the Stories list and shifts no cursor math, so the base-model
 * story flow is byte-for-byte unchanged. On a successful import the loom is
 * registered in the story index (the catalog subscribes, so it appears in the
 * Stories list) and `onImported` selects it. Every failure is surfaced through
 * `onError` — a malformed or non-conversation file never fails in silence.
 */
export function useConversationImport({
  enabled = true,
  onImported,
  onError,
}: {
  enabled?: boolean;
  onImported: (result: ImportedConversation) => void;
  onError?: (error: unknown) => void;
}): void {
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    // A drop is only meaningful if the drag carries files; allow the drop by
    // preventing the browser's default "open the file" navigation.
    const isFileDrag = (event: DragEvent): boolean =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");

    const handleDragOver = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };

    const handleDrop = (event: DragEvent) => {
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      event.preventDefault();
      void (async () => {
        try {
          const text = await file.text();
          const result = await importConversationLoomText(text);
          onImported(result);
        } catch (error) {
          if (onError) onError(error);
          else console.error("Conversation import failed:", error);
        }
      })();
    };

    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("drop", handleDrop);
    return () => {
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("drop", handleDrop);
    };
  }, [enabled, onImported, onError]);
}
