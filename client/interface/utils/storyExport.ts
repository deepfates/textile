import type { StoryAnnotation, StoryNode } from "../types";

const hasWindow = typeof window !== "undefined";

const sanitizeForFilename = (name: string): string => {
  const fallback = "story";
  if (!name) return fallback;
  const trimmed = name.trim();
  if (!trimmed) return fallback;
  return trimmed
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
};

const triggerDownload = (filename: string, data: string, mimeType: string) => {
  if (!hasWindow) {
    console.warn("Download attempted in a non-browser environment.");
    return;
  }

  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const resolvePrimaryPath = (root: StoryNode): StoryNode[] => {
  const path: StoryNode[] = [];
  let current: StoryNode | undefined = root;

  while (current) {
    path.push(current);
    const continuations = current.continuations ?? [];
    if (!continuations.length) {
      break;
    }

    current = continuations[0];
  }

  return path;
};

export const downloadStoryTreeJson = (
  key: string,
  tree: { root: StoryNode },
): void => {
  const payload = {
    schemaVersion: 1,
    title: key,
    exportedAt: new Date().toISOString(),
    tree: tree.root,
  };

  const filename = `${sanitizeForFilename(key)}-tree.json`;
  const json = JSON.stringify(payload, null, 2);
  triggerDownload(filename, json, "application/json");
};

export const downloadStoryThreadText = (
  key: string,
  path: StoryNode[],
): void => {
  const segments = path
    .map((node) => node.text?.trim())
    .filter((text): text is string => Boolean(text && text.length));
  const content = segments.join("\n\n");
  const filename = `${sanitizeForFilename(key)}-thread.txt`;
  triggerDownload(filename, content, "text/plain");
};

export const getStoryPrimaryPath = (tree: { root: StoryNode }): StoryNode[] =>
  resolvePrimaryPath(tree.root);

/**
 * A single kept turn in the curated export: its own text/origin, the notes the
 * person attached, and the full thread of ancestor text leading to it — so the
 * export is a usable training record, not a bare line out of context.
 */
export interface KeptStoryEntry {
  id: string;
  text: string;
  origin: StoryNode["origin"];
  actor?: string;
  via?: string;
  annotations: StoryAnnotation[];
  thread: Array<{ id: string; text: string; origin: StoryNode["origin"] }>;
}

/**
 * Walk the tree in pre-order and collect every KEPT node (the curated set). The
 * person's swipe (`node.kept === true`) is the only filter; each entry carries
 * its annotations and its root→node thread. Pure — the export path and the
 * tests both call this, so the curated set is defined in ONE place.
 */
export const collectKeptEntries = (root: StoryNode): KeptStoryEntry[] => {
  const entries: KeptStoryEntry[] = [];
  const walk = (node: StoryNode, ancestors: StoryNode[]) => {
    const thread = [...ancestors, node];
    if (node.kept === true) {
      entries.push({
        id: node.id,
        text: node.text,
        origin: node.origin,
        actor: node.actor,
        via: node.via,
        annotations: node.annotations ?? [],
        thread: thread.map((n) => ({ id: n.id, text: n.text, origin: n.origin })),
      });
    }
    for (const child of node.continuations ?? []) walk(child, thread);
  };
  walk(root, []);
  return entries;
};

/** Build the curated-export payload (kept turns + annotations). Pure/testable. */
export const buildKeptStoryExport = (
  key: string,
  tree: { root: StoryNode },
) => ({
  schemaVersion: 1 as const,
  kind: "curated" as const,
  title: key,
  exportedAt: new Date().toISOString(),
  kept: collectKeptEntries(tree.root),
});

/**
 * EXPORT CURATED: download only the KEPT turns (with their annotations) — the
 * curated training set. Reuses the same download path as the other exports. If
 * nothing is kept the caller is told (NOTHING-SILENT); here we still emit an
 * empty curated file so an accidental empty export is visible, not silent.
 */
export const downloadKeptStoryJson = (
  key: string,
  tree: { root: StoryNode },
): void => {
  const payload = buildKeptStoryExport(key, tree);
  const filename = `${sanitizeForFilename(key)}-kept.json`;
  triggerDownload(filename, JSON.stringify(payload, null, 2), "application/json");
};
