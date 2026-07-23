import { useEffect, useRef, useState, type ReactElement } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
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

const ThreadLinkIcon = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    width="16"
    height="16"
    viewBox="0 0 16 16"
  >
    <path
      d="M3 2h8a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H8.8l-3.1 3.1V9H3a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm0 1.3A.7.7 0 0 0 2.3 4v3a.7.7 0 0 0 .7.7h4v1.2l1.3-1.2H11a.7.7 0 0 0 .7-.7V4a.7.7 0 0 0-.7-.7H3zm6.4 7.1h1.9l1.3 1.2v-1.2h.4a.7.7 0 0 0 .7-.7V6.5h1.3v3.2a2 2 0 0 1-1.3 1.9v3.1l-3.1-3h-1.4v-1.3z"
      fill="currentColor"
    />
  </svg>
);

const ImportIcon = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    width="16"
    height="16"
    viewBox="0 0 16 16"
  >
    <path
      d="M7.4 1.5h1.2v6.1l2-2 .85.85L8 10.9 4.55 6.45l.85-.85 2 2V1.5zM2.5 10h1.2v3.3h8.6V10h1.2v4.5H2.5V10z"
      fill="currentColor"
    />
  </svg>
);

const KeepIcon = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    width="16"
    height="16"
    viewBox="0 0 16 16"
  >
    <path
      d="M4 2h8v12l-4-2.6L4 14V2zm1 1v9.2l3-1.95 3 1.95V3H5z"
      fill="currentColor"
    />
  </svg>
);

const MoreIcon = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    width="16"
    height="16"
    viewBox="0 0 16 16"
  >
    <path
      d="M3.5 9.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zm4.5 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zm4.5 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z"
      fill="currentColor"
    />
  </svg>
);

interface StoryActionButtonProps {
  label: string;
  icon: ReactElement;
  selected: boolean;
  secondary?: boolean;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onFocus: () => void;
}

const StoryActionButton = ({
  label,
  icon,
  selected,
  secondary,
  onClick,
  onFocus,
}: StoryActionButtonProps) => (
  <button
    type="button"
    className={[
      "story-action",
      secondary ? "story-action--secondary" : "",
      selected ? "selected" : "",
    ]
      .filter(Boolean)
      .join(" ")}
    aria-label={label}
    title={label}
    onClick={onClick}
    onFocus={onFocus}
  >
    {icon}
    <span className="story-action-label">{label}</span>
  </button>
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
 *   row 0 — Sort pick (Recent / A→Z / Z→A); column 1 is the Index-link action
 *   row 1 — + New Story action; column 1 is the Import-conversation action
 *   row 2+ — each existing story as an action row whose trailing slot
 *            carries sub-actions (copy links / export JSON / export thread)
 * The cursor is (rowIndex, columnIndex) — column 0 is the story body,
 * columns 1+ are the sub-actions in order. Rows 0 and 1 keep their existing
 * indices (the e2e row math depends on it); Import rides row 1 as a trailing
 * action, adding NO new row.
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
  onImportConversation,
  onShareStory,
  onShareThread,
  onShareIndex,
  onExportJson,
  onExportThread,
  onExportKept,
  onHighlight,
}: TreeListProps) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const ignoreMoreClickRef = useRef(false);
  const selectedPositionRef = useRef({ selectedColumn, selectedIndex });
  const [openSecondaryKey, setOpenSecondaryKey] = useState<string | null>(null);
  const orderedKeys = orderKeysByStorySort(trees, sortOrder);
  const hasImport = Boolean(onImportConversation);
  const hasShare = Boolean(onShareStory);
  const hasThreadShare = Boolean(onShareThread);
  const hasIndexShare = Boolean(onShareIndex);
  const hasJson = Boolean(onExportJson);
  const hasThread = Boolean(onExportThread);
  const hasKept = Boolean(onExportKept);
  const shareColumn = hasShare ? 1 : -1;
  const threadShareColumn = hasThreadShare ? 1 + (hasShare ? 1 : 0) : -1;
  const jsonColumn = hasJson
    ? 1 + (hasShare ? 1 : 0) + (hasThreadShare ? 1 : 0)
    : -1;
  const threadColumn = hasThread
    ? 1 + (hasShare ? 1 : 0) + (hasThreadShare ? 1 : 0) + (hasJson ? 1 : 0)
    : -1;
  const keptColumn = hasKept
    ? 1 +
      (hasShare ? 1 : 0) +
      (hasThreadShare ? 1 : 0) +
      (hasJson ? 1 : 0) +
      (hasThread ? 1 : 0)
    : -1;

  useEffect(() => {
    if (!openSecondaryKey) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpenSecondaryKey(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenSecondaryKey(null);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openSecondaryKey]);

  useEffect(() => {
    const previous = selectedPositionRef.current;
    const selectionChanged =
      previous.selectedIndex !== selectedIndex ||
      previous.selectedColumn !== selectedColumn;

    selectedPositionRef.current = { selectedColumn, selectedIndex };

    if (selectionChanged && selectedColumn === 0) {
      setOpenSecondaryKey(null);
    }
  }, [selectedColumn, selectedIndex]);

  return (
    <div className="menu-content" ref={menuRef}>
      <Row
        kind="pick"
        label="Sort"
        value={SORT_LABELS[sortOrder]}
        selected={selectedIndex === 0 && selectedColumn === 0}
        onActivate={() => {
          setOpenSecondaryKey(null);
          onToggleSort?.(1);
          onHighlight?.(0, 0);
        }}
        trailing={
          hasIndexShare ? (
            <div className="story-action-cluster" role="group">
              <StoryActionButton
                label="Index link"
                icon={<LinkIcon />}
                selected={selectedIndex === 0 && selectedColumn === 1}
                onClick={(event) => {
                  event.stopPropagation();
                  setOpenSecondaryKey(null);
                  onShareIndex?.();
                  onHighlight?.(0, 1);
                }}
                onFocus={() => onHighlight?.(0, 1)}
              />
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
          setOpenSecondaryKey(null);
          onNew?.();
          onHighlight?.(1, 0);
        }}
        trailing={
          hasImport ? (
            <div className="story-action-cluster" role="group">
              <StoryActionButton
                label="Import Lync"
                icon={<ImportIcon />}
                selected={selectedIndex === 1 && selectedColumn === 1}
                onClick={(event) => {
                  event.stopPropagation();
                  setOpenSecondaryKey(null);
                  onImportConversation?.();
                  onHighlight?.(1, 1);
                }}
                onFocus={() => onHighlight?.(1, 1)}
              />
            </div>
          ) : undefined
        }
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
        const keptSelected =
          hasKept &&
          selectedIndex === rowIndex &&
          selectedColumn === keptColumn;

        const secondarySelected = Boolean(
          jsonSelected || threadSelected || keptSelected,
        );
        const secondaryOpen = openSecondaryKey === key;
        const secondaryActionsId = `story-secondary-actions-${rowIndex}`;
        const toggleSecondaryActions = () => {
          setOpenSecondaryKey((openKey) => (openKey === key ? null : key));
        };
        const secondaryActions =
          hasJson || hasThread || hasKept ? (
            <div
              id={secondaryActionsId}
              className="story-secondary-actions"
            >
              {hasJson ? (
                <StoryActionButton
                  label="Export JSON"
                  icon={<SaveIcon />}
                  selected={Boolean(jsonSelected)}
                  secondary
                  onClick={(event) => {
                    event.stopPropagation();
                    onExportJson?.(key);
                    onHighlight?.(rowIndex, jsonColumn);
                    setOpenSecondaryKey(null);
                  }}
                  onFocus={() => onHighlight?.(rowIndex, jsonColumn)}
                />
              ) : null}
              {hasThread ? (
                <StoryActionButton
                  label="Export thread"
                  icon={<PrintIcon />}
                  selected={Boolean(threadSelected)}
                  secondary
                  onClick={(event) => {
                    event.stopPropagation();
                    onExportThread?.(key);
                    onHighlight?.(rowIndex, threadColumn);
                    setOpenSecondaryKey(null);
                  }}
                  onFocus={() => onHighlight?.(rowIndex, threadColumn)}
                />
              ) : null}
              {hasKept ? (
                <StoryActionButton
                  label="Export KEPT"
                  icon={<KeepIcon />}
                  selected={Boolean(keptSelected)}
                  secondary
                  onClick={(event) => {
                    event.stopPropagation();
                    onExportKept?.(key);
                    onHighlight?.(rowIndex, keptColumn);
                    setOpenSecondaryKey(null);
                  }}
                  onFocus={() => onHighlight?.(rowIndex, keptColumn)}
                />
              ) : null}
            </div>
          ) : null;

        const trailing =
          hasShare || hasThreadShare || secondaryActions ? (
            <div className="story-action-cluster" role="group">
              {hasShare ? (
                <StoryActionButton
                  label="Story link"
                  icon={<LinkIcon />}
                  selected={Boolean(shareSelected)}
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpenSecondaryKey(null);
                    onShareStory?.(key);
                    onHighlight?.(rowIndex, shareColumn);
                  }}
                  onFocus={() => onHighlight?.(rowIndex, shareColumn)}
                />
              ) : null}
              {hasThreadShare ? (
                <StoryActionButton
                  label="Thread link"
                  icon={<ThreadLinkIcon />}
                  selected={Boolean(threadShareSelected)}
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpenSecondaryKey(null);
                    onShareThread?.(key);
                    onHighlight?.(rowIndex, threadShareColumn);
                  }}
                  onFocus={() => onHighlight?.(rowIndex, threadShareColumn)}
                />
              ) : null}
              {secondaryActions ? (
                <div
                  className={`story-action-more${
                    secondarySelected ? " selected" : ""
                  }${secondaryOpen ? " is-open" : ""}`}
                  onPointerDown={(event) => {
                    const summary = (event.target as Element).closest(
                      ".story-action-more-summary",
                    );
                    if (!summary || event.pointerType === "mouse") return;
                    event.preventDefault();
                    event.stopPropagation();
                    ignoreMoreClickRef.current = true;
                    toggleSecondaryActions();
                  }}
                  onClick={(event) => {
                    const summary = (event.target as Element).closest(
                      ".story-action-more-summary",
                    );
                    event.stopPropagation();
                    if (ignoreMoreClickRef.current) {
                      ignoreMoreClickRef.current = false;
                      return;
                    }
                    if (summary) {
                      toggleSecondaryActions();
                    }
                  }}
                >
                  <button
                    type="button"
                    className="story-action story-action-more-summary"
                    aria-label="More story actions"
                    aria-expanded={secondaryOpen}
                    aria-controls={secondaryActionsId}
                    title="More story actions"
                    onFocus={() => {
                      if (jsonSelected) {
                        onHighlight?.(rowIndex, jsonColumn);
                      } else if (threadSelected) {
                        onHighlight?.(rowIndex, threadColumn);
                      } else if (keptSelected) {
                        onHighlight?.(rowIndex, keptColumn);
                      }
                    }}
                  >
                    <MoreIcon />
                    <span className="story-action-label">More</span>
                  </button>
                  {secondaryActions}
                </div>
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
              setOpenSecondaryKey(null);
              onSelect(key);
              onHighlight?.(rowIndex, 0);
            }}
          />
        );
      })}
    </div>
  );
};
