import {
  parseLyncFiles,
  type LyncEventBody,
  type LyncParseResult,
} from "@deepfates/lync/events";
import type { ConversationLoomSnapshot, ConversationTurnMeta } from "./storyRuntime";
import type { RawLyncTag } from "../types";

export interface RawLyncProjection {
  snapshot: ConversationLoomSnapshot;
  sourceEventCount: number;
  annotationCount: number;
  nonconformingCount: number;
  warnings: string[];
}

/**
 * Read a protocol-level `.lync` file without turning it into a Loom first.
 * Textile's UI is tree-shaped, so navigation follows only parents[0]. Every
 * other parent remains on the turn metadata and is surfaced in the reader.
 * The source event id is carried separately from Textile's imported turn id;
 * curation exporters always target the source id.
 */
export function projectRawLyncFile(
  text: string,
  filename = "Imported Lync corpus",
): RawLyncProjection {
  const bytes = new TextEncoder().encode(text);
  const parsed = parseLyncFiles([{ file: filename, bytes }]);
  assertSafeProjection(parsed);
  const nonconforming = parsed.lines.filter((line) => line.class === "nonconforming");
  const eligible = new Set(parsed.viewEligibleIds);
  const events = parsed.lines
    .map((line) => line.event)
    .filter((event): event is LyncEventBody => Boolean(event && eligible.has(event.id)));

  const annotations = events.filter((event) => event.kind === "lync/annotation");
  const content = events.filter(
    (event) => event.kind !== "lync/annotation" && readableText(event.payload) !== null,
  );
  if (content.length === 0) {
    throw new Error("No readable events in this .lync file (expected payload.text or payload.message).");
  }

  const contentIds = new Set(content.map((event) => event.id));
  const warningsById = new Map(
    nonconforming.flatMap((line) =>
      line.id ? [[line.id, line.nonconformingReasons ?? [line.reason]] as const] : [],
    ),
  );
  const tagsByTarget = clusterTagsByTarget(annotations);
  const selectedIds = selectedSourceIds(annotations);
  const virtualId = `textile-raw-root:${content[0]!.id}`;
  const createdAt = Math.min(...content.map(eventTime));
  const loomId = `textile-raw:${content[0]!.id}`;

  const turns: ConversationLoomSnapshot["turns"] = [
    {
      id: virtualId,
      loomId,
      parentId: null,
      payload: { message: filename, text: filename },
      meta: { role: "corpus", author: "textile", rawVirtual: true },
      createdAt,
    },
  ];

  for (const event of orderByFirstParent(content, contentIds)) {
    const firstParent = event.parents[0];
    const navigationParent = firstParent && contentIds.has(firstParent) ? firstParent : virtualId;
    const meta: ConversationTurnMeta = {
      role: rawRole(event),
      author: event.author.actor,
      via: typeof event.author.via === "string" ? event.author.via : undefined,
      sourceId: event.id,
      sourceKind: event.kind,
      sourceParents: [...event.parents],
      extraParentIds: event.parents.slice(1),
      rawTags: tagsByTarget.get(event.id) ?? [],
      sourceSelected: selectedIds.has(event.id),
      sourceWarnings: warningsById.get(event.id) ?? [],
    };
    turns.push({
      id: event.id,
      loomId,
      parentId: navigationParent,
      payload: { message: event.payload, text: readableText(event.payload)! },
      meta,
      createdAt: eventTime(event),
    });
  }

  return {
    snapshot: {
      loom: {
        id: loomId,
        meta: { profile: "conversation", source: "raw-lync", title: filename },
        createdAt,
      },
      turns,
    },
    sourceEventCount: content.length,
    annotationCount: annotations.length,
    nonconformingCount: nonconforming.length,
    warnings: nonconforming.map(
      (line) => `${line.file}:${line.line} nonconforming: ${line.reason}`,
    ),
  };
}

/** Refuse to build a plausible-looking partial tree from an unsafe union. */
function assertSafeProjection(parsed: LyncParseResult): void {
  const issues: string[] = [];
  for (const line of parsed.lines) {
    if (["garbage", "damaged", "conflict-variant"].includes(line.class)) {
      issues.push(`${line.file}:${line.line} ${line.class}: ${line.reason}`);
    }
  }
  for (const pending of parsed.pending) {
    issues.push(
      `${pending.file}:${pending.line} pending ${pending.id}: missing parent ${pending.missingParent}`,
    );
  }
  if (parsed.pendingOverflowCount > 0) {
    issues.push(`${parsed.pendingOverflowCount} pending events exceeded the parser limit`);
  }
  for (const obstacle of parsed.graphDiagnostics) {
    if (obstacle.class === "cycle") {
      issues.push(`graph cycle: ${(obstacle.ids ?? []).join(" -> ") || "unknown events"}`);
    } else if (obstacle.class === "dangling") {
      issues.push(`graph dangling: ${obstacle.id ?? "event"} needs ${obstacle.missing ?? "a parent"}`);
    } else {
      issues.push(`graph unavailable due to conflict: ${obstacle.id ?? "unknown event"}`);
    }
  }
  const unique = [...new Set(issues)];
  if (unique.length === 0) return;
  const shown = unique.slice(0, 6);
  const more = unique.length > shown.length ? `\n- …and ${unique.length - shown.length} more` : "";
  throw new Error(
    `Cannot import .lync safely; repair or remove these records:\n- ${shown.join("\n- ")}${more}`,
  );
}

function eventTime(event: LyncEventBody): number {
  const parsed = Date.parse(event.at);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rawRole(event: LyncEventBody): string {
  const role = event.payload.role;
  if (typeof role === "string") return role;
  if (event.kind.includes("user")) return "user";
  if (event.kind.includes("assistant")) return "assistant";
  return "artifact";
}

function readableText(payload: Record<string, unknown>): string | null {
  if (typeof payload.text === "string") return payload.text;
  if (typeof payload.message === "string") return payload.message;
  const message = payload.message;
  if (message && typeof message === "object") {
    const content = (message as { content?: unknown }).content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const text = content
        .map((block) =>
          block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string"
            ? (block as { text: string }).text
            : "",
        )
        .filter(Boolean)
        .join("");
      if (text) return text;
    }
  }
  return null;
}

function clusterTagsByTarget(events: LyncEventBody[]): Map<string, RawLyncTag[]> {
  const result = new Map<string, RawLyncTag[]>();
  for (const event of events) {
    if (event.payload.label !== "cluster") continue;
    const value = event.payload.value;
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    if (typeof record.tag !== "string") continue;
    for (const target of event.parents) {
      const bucket = result.get(target) ?? [];
      bucket.push({
        annotationId: event.id,
        label: "cluster",
        tag: record.tag,
        clusterId: typeof record.cluster_id === "number" ? record.cluster_id : undefined,
        rating: typeof record.rating === "string" ? record.rating : undefined,
        actor: event.author.actor,
      });
      result.set(target, bucket);
    }
  }
  return result;
}

function selectedSourceIds(events: LyncEventBody[]): Set<string> {
  const selected = new Set<string>();
  for (const event of events) {
    if (event.payload.label !== "selection" || !Array.isArray(event.payload.chosen)) continue;
    for (const id of event.payload.chosen) if (typeof id === "string") selected.add(id);
  }
  return selected;
}

function orderByFirstParent(events: LyncEventBody[], ids: Set<string>): LyncEventBody[] {
  const pending = new Map(events.map((event) => [event.id, event]));
  const ordered: LyncEventBody[] = [];
  const emitted = new Set<string>();
  while (pending.size > 0) {
    const ready = [...pending.values()].filter((event) => {
      const parent = event.parents[0];
      return !parent || !ids.has(parent) || emitted.has(parent);
    });
    if (ready.length === 0) {
      throw new Error("Cannot project .lync first-parent navigation: the source contains a cycle.");
    }
    ready.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    for (const event of ready) {
      pending.delete(event.id);
      emitted.add(event.id);
      ordered.push(event);
    }
  }
  return ordered;
}
