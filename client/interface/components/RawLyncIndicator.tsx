import type { StoryNode } from "../types";

/** Quiet proof that the focused turn still carries its raw corpus context. */
export function RawLyncIndicator({ node }: { node: StoryNode | undefined }) {
  if (!node?.sourceId) return null;
  const extraParents = node.extraParentIds ?? [];
  const tags = node.rawTags ?? [];
  const warnings = node.sourceWarnings ?? [];
  const detail = [
    `source ${node.sourceId}`,
    node.sourceKind,
    node.sourceParents?.length ? `parents: ${node.sourceParents.join(", ")}` : "root event",
    tags.length ? `tags: ${tags.map((tag) => tag.tag).join(", ")}` : null,
    warnings.length ? `nonconforming: ${warnings.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className="story-curation-status" aria-label={detail} title={detail}>
      <span className="story-curation-status__note">
        lync {node.sourceId.slice(-8)}
        {extraParents.length
          ? ` · +${extraParents.length} parent${extraParents.length === 1 ? "" : "s"}`
          : ""}
        {tags.length ? ` · ${tags.map((tag) => tag.tag).join(", ")}` : ""}
        {warnings.length ? ` · ⚠ ${warnings.length}` : ""}
      </span>
    </span>
  );
}
