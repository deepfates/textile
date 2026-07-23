import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { projectRawLyncFile } from "../client/interface/lync/rawLync";
import { buildRawLyncSelectionEvents } from "../client/interface/utils/storyExport";
import type { StoryNode } from "../client/interface/types";

const curareRoot = process.env.CURARE_ROOT;
const spliceRoot = process.env.SPLICE_ROOT;
if (!curareRoot || !spliceRoot) {
  throw new Error("Set CURARE_ROOT and SPLICE_ROOT to current source checkouts.");
}

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(
  here,
  "../client/interface/lync/__tests__/fixtures/corpus-loop.lync",
);
const D = "0197e6a0-4a09-7000-8000-000000000004";
const A = "0197e6a0-4a09-7000-8000-000000000002";
const B = "0197e6a0-4a09-7000-8000-000000000003";
const source = readFileSync(fixturePath, "utf8")
  .split("\n")
  .filter((line) => line && !line.includes('"kind":"lync/annotation"'))
  .join("\n");

const curareModule = (await import(
  pathToFileURL(resolve(curareRoot, "src/lync.ts")).href
)) as {
  serializeClusterAnnotations: (inputs: Array<Record<string, unknown>>) => string;
};
const currentCurareOutput = curareModule.serializeClusterAnnotations([
  {
    clusterId: 7,
    tag: "cooperation",
    parents: [D],
    at: "2026-07-06T04:10:04Z",
    size: 1,
    rating: "high",
    basis: "cross-repo acceptance",
  },
]);
const selectionTree: { root: StoryNode } = {
  root: {
    id: "virtual",
    text: "corpus",
    origin: "unknown",
    continuations: [
      {
        id: "internal-a",
        sourceId: A,
        text: "A",
        origin: "model",
        kept: true,
        keepMark: {
          id: "0197e6a0-4a09-7000-8000-000000000006",
          createdAt: Date.parse("2026-07-06T04:10:05Z"),
          actor: "researcher",
          via: "textile-browser",
        },
        continuations: [],
      },
      { id: "internal-b", sourceId: B, text: "B", origin: "model", continuations: [] },
    ],
  },
};
const currentTextileOutput = buildRawLyncSelectionEvents(selectionTree)
  .map((event) => JSON.stringify(event))
  .join("\n");
const corpus = `${source}\n${currentTextileOutput}\n${currentCurareOutput}`;

const projected = projectRawLyncFile(corpus, "corpus-loop.lync");
const d = projected.snapshot.turns.find((turn) => turn.meta.sourceId === D);
if (d?.meta.extraParentIds?.length !== 1) throw new Error("Textile lost D's extra DAG parent.");
if (d.meta.rawTags?.[0]?.tag !== "cooperation") throw new Error("Textile lost Curare's tag.");

const temp = mkdtempSync(join(tmpdir(), "textile-corpus-loop-"));
try {
  const input = join(temp, "corpus-loop.lync");
  const output = join(temp, "training");
  writeFileSync(input, corpus);
  const splice = spawnSync(
    "npm",
    ["run", "start", "--", "lync", "training", "--source", input, "--out-dir", output, "--render", "messages"],
    { cwd: resolve(spliceRoot), encoding: "utf8" },
  );
  if (splice.status !== 0) {
    throw new Error(`Splice rejected the corpus:\n${splice.stdout}\n${splice.stderr}`);
  }
  console.log("Textile projected current Curare output; current Splice training export accepted it.");
  console.log(splice.stdout.trim());
} finally {
  if (process.env.KEEP_CORPUS_LOOP_OUTPUT !== "1") rmSync(temp, { recursive: true });
  else console.log(`Kept acceptance output at ${temp}`);
}
