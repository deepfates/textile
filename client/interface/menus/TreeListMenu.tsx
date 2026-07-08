import { TreeListProps } from "../types";
import {
  orderKeysByStorySort,
  type StorySortOption,
} from "../utils/storyMeta";
import { Row } from "../components/Row";
import type { StoryNode } from "../types";

const SORT_LABELS: Record<StorySortOption, string> = {
  recent: "Recent",
  oldest: "Oldest",
};

const SaveIcon = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    width="16"
    height="16"
    viewBox="0 0 16 16"
  >
    <path
      d="M3 2h7l3 3v9H3V2zm1 1v10h8V5.5L9.5 3H4zm2 5h4v5H6V8zm0-4h4v2H6V4z"
      fill="currentColor"
    />
  </svg>
);

const PrintIcon = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    width="16"
    height="16"
    viewBox="0 0 16 16"
  >
    <path
      d="M4 2h8v3h2l1 2v4h-3v3H4v-3H1V7l1-2h2V2zm1 1v2h6V3H5zm8 5H3v3h1V8h8v3h1V8zm-3 5v-2H6v2h4z"
      fill="currentColor"
    />
  </svg>
);

const LinkIcon = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    width="16"
    height="16"
    viewBox="0 0 16 16"
  >
    <path
      d="M6.2 10.7 5 11.9a2.3 2.3 0 0 1-3.3-3.3l2.4-2.4a2.3 2.3 0 0 1 3.3 0l.7.7-.9.9-.7-.7a1 1 0 0 0-1.5 0L2.6 9.5A1 1 0 1 0 4 10.9l1.2-1.2.9.9zm3.6-5.4L11 4.1a2.3 2.3 0 1 1 3.3 3.3l-2.4 2.4a2.3 2.3 0 0 1-3.3 0l-.7-.7.9-.9.7.7a1 1 0 0 0 1.5 0l2.4-2.4A1 1 0 1 0 12 5.1L10.8 6.3l-.9-.9zM5.6 9.5l3.9-3.9.9.9-3.9 3.9-.9-.9z"
      fill="currentColor"
    />
  </svg>
);

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function countStoryNodes(node: StoryNode): number {
  return 1 + (node.continuations ?? []).reduce(
    (total, child) => total + countStoryNodes(child),
    0,
  );
}

export function formatStoryDateLabel(
  isoDate: string | undefined,
  action = "edited",
  now = new Date(),
): string | null {
  if (!isoDate) return null;

  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return null;

  const month = MONTH_LABELS[date.getUTCMonth()];
  const day = date.getUTCDate();
  const sameYear = date.getUTCFullYear() === now.getUTCFullYear();
  return sameYear
    ? `${action} ${month} ${day}`
    : `${action} ${month} ${day}, ${date.getUTCFullYear()}`;
}

export function getStoryRowPreview({
  tree,
  isCurrent,
  metaDateLabel,
}: {
  tree: { root: StoryNode };
  isCurrent: boolean;
  metaDateLabel?: string | null;
}): string {
  const nodeCount = countStoryNodes(tree.root);
  const metadata = [
    isCurrent ? "current" : null,
    `${nodeCount} ${nodeCount === 1 ? "node" : "nodes"}`,
    metaDateLabel,
  ].filter(Boolean);
  const text = (tree.root.text ?? "").trim().replace(/\s+/g, " ").slice(0, 60);

  return [...metadata, text].join(" · ");
}

/**
 * Stories list.  Mirrors the Models-tab row layout:
 *   row 0 — Sort pick (Recent / A→Z / Z→A)
 *   row 1 — + New Story action
 *   row 2+ — each existing story as an action row whose trailing slot
 *            carries sub-actions (copy links / export JSON / export thread)
 * The cursor is (rowIndex, columnIndex) — column 0 is the story body,
 * columns 1+ are the sub-actions in order.
 */
export const TreeListMenu = ({
  trees,
  storyTitles,
  selectedIndex,
  selectedColumn,
  sortOrder,
  currentStoryKey,
  storyMeta,
  onToggleSort,
  onSelect,
  onNew,
  onShareStory,
  onShareThread,
  onShareIndex,
  onExportJson,
  onExportThread,
  onHighlight,
}: TreeListProps) => {
  const orderedKeys = orderKeysByStorySort(trees, sortOrder);
  const hasShare = Boolean(onShareStory);
  const hasThreadShare = Boolean(onShareThread);
  const hasIndexShare = Boolean(onShareIndex);
  const hasJson = Boolean(onExportJson);
  const hasThread = Boolean(onExportThread);
  const shareColumn = hasShare ? 1 : -1;
  const threadShareColumn = hasThreadShare ? 1 + (hasShare ? 1 : 0) : -1;
  const jsonColumn = hasJson
    ? 1 + (hasShare ? 1 : 0) + (hasThreadShare ? 1 : 0)
    : -1;
  const threadColumn = hasThread
    ? 1 + (hasShare ? 1 : 0) + (hasThreadShare ? 1 : 0) + (hasJson ? 1 : 0)
    : -1;

  return (
    <div className="menu-content">
      <Row
        kind="pick"
        label="Sort"
        value={SORT_LABELS[sortOrder]}
        selected={selectedIndex === 0 && selectedColumn === 0}
        onActivate={() => {
          onToggleSort?.(1);
          onHighlight?.(0, 0);
        }}
        trailing={
          hasIndexShare ? (
            <div className="story-action-cluster" role="group">
              <button
                type="button"
                className={`story-action${
                  selectedIndex === 0 && selectedColumn === 1
                    ? " selected"
                    : ""
                }`}
                aria-label="Copy story list link"
                onClick={(event) => {
                  event.stopPropagation();
                  onShareIndex?.();
                  onHighlight?.(0, 1);
                }}
                onFocus={() => onHighlight?.(0, 1)}
              >
                <LinkIcon />
              </button>
            </div>
          ) : undefined
        }
      />
      <Row
        kind="action"
        label="New Story"
        glyph="+"
        selected={selectedIndex === 1 && selectedColumn === 0}
        onActivate={() => {
          onNew?.();
          onHighlight?.(1, 0);
        }}
      />
      {orderedKeys.map((key, index) => {
        const tree = trees[key];
        const rowIndex = index + 2;
        const bodySelected =
          selectedIndex === rowIndex && selectedColumn === 0;
        const shareSelected =
          hasShare &&
          selectedIndex === rowIndex &&
          selectedColumn === shareColumn;
        const threadShareSelected =
          hasThreadShare &&
          selectedIndex === rowIndex &&
          selectedColumn === threadShareColumn;
        const jsonSelected =
          hasJson &&
          selectedIndex === rowIndex &&
          selectedColumn === jsonColumn;
        const threadSelected =
          hasThread &&
          selectedIndex === rowIndex &&
          selectedColumn === threadColumn;

        const trailing =
          hasShare || hasThreadShare || hasJson || hasThread ? (
            <div className="story-action-cluster" role="group">
              {hasShare ? (
                <button
                  type="button"
                  className={`story-action${shareSelected ? " selected" : ""}`}
                  aria-label="Copy story link"
                  onClick={(event) => {
                    event.stopPropagation();
                    onShareStory?.(key);
                    onHighlight?.(rowIndex, shareColumn);
                  }}
                  onFocus={() => onHighlight?.(rowIndex, shareColumn)}
                >
                  <LinkIcon />
                </button>
              ) : null}
              {hasThreadShare ? (
                <button
                  type="button"
                  className={`story-action${
                    threadShareSelected ? " selected" : ""
                  }`}
                  aria-label="Copy current thread link"
                  onClick={(event) => {
                    event.stopPropagation();
                    onShareThread?.(key);
                    onHighlight?.(rowIndex, threadShareColumn);
                  }}
                  onFocus={() => onHighlight?.(rowIndex, threadShareColumn)}
                >
                  <LinkIcon />
                </button>
              ) : null}
              {hasJson ? (
                <button
                  type="button"
                  className={`story-action${jsonSelected ? " selected" : ""}`}
                  aria-label="Export story as JSON"
                  onClick={(event) => {
                    event.stopPropagation();
                    onExportJson?.(key);
                    onHighlight?.(rowIndex, jsonColumn);
                  }}
                  onFocus={() => onHighlight?.(rowIndex, jsonColumn)}
                >
                  <SaveIcon />
                </button>
              ) : null}
              {hasThread ? (
                <button
                  type="button"
                  className={`story-action${threadSelected ? " selected" : ""}`}
                  aria-label="Export current thread"
                  onClick={(event) => {
                    event.stopPropagation();
                    onExportThread?.(key);
                    onHighlight?.(rowIndex, threadColumn);
                  }}
                  onFocus={() => onHighlight?.(rowIndex, threadColumn)}
                >
                  <PrintIcon />
                </button>
              ) : null}
            </div>
          ) : undefined;

        const title = storyTitles?.[key] ?? key;
        const isCurrent = key === currentStoryKey;
        const meta = storyMeta?.[key];
        const metaDateLabel = meta?.updatedAt
          ? formatStoryDateLabel(meta.updatedAt, "edited")
          : meta?.lastActiveAt
            ? formatStoryDateLabel(meta.lastActiveAt, "opened")
            : formatStoryDateLabel(meta?.createdAt, "created");
        const preview = getStoryRowPreview({
          tree,
          isCurrent,
          metaDateLabel,
        });

        return (
          <Row
            key={key}
            kind="action"
            label={title}
            preview={preview}
            stacked
            trailing={trailing}
            selected={bodySelected}
            className={[
              "story-menu-item",
              isCurrent ? "story-menu-item--current" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onActivate={() => {
              onSelect(key);
              onHighlight?.(rowIndex, 0);
            }}
          />
        );
      })}
    </div>
  );
};
