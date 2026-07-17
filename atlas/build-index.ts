// SCREEN ATLAS index builder — reads the JSON sidecars the atlas spec wrote
// next to each PNG in atlas/out/ and composes atlas/index.html: a contact
// sheet grouped by screen area, desktop + mobile variants side by side,
// click any thumbnail for full size. Pure static HTML, no dependencies —
// open it with a browser or feed it to an agent.
//
// Run: bun atlas/build-index.ts   (or via `bun run atlas`)
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.SHOTS_DIR ?? join(HERE, "out");
const INDEX = join(HERE, "index.html");

interface Shot {
  group: string;
  id: string;
  title: string;
  description: string;
  seq: number;
  viewport: "desktop" | "mobile";
  theme: string;
  file: string;
}

const sidecars = readdirSync(OUT).filter((f) => f.endsWith(".json"));
if (sidecars.length === 0) {
  console.error(`No sidecar manifests in ${OUT} — run the atlas spec first.`);
  process.exit(1);
}

const shots: Shot[] = sidecars.map((f) =>
  JSON.parse(readFileSync(join(OUT, f), "utf8")),
);

// Loud verification: every referenced PNG exists and is non-trivial.
const missing: string[] = [];
for (const shot of shots) {
  const path = join(OUT, shot.file);
  try {
    const size = statSync(path).size;
    if (size < 6_000) missing.push(`${shot.file} suspiciously small (${size}B)`);
  } catch {
    missing.push(`${shot.file} MISSING`);
  }
}
if (missing.length) {
  console.error("Atlas verification failed:\n  " + missing.join("\n  "));
  process.exit(1);
}

// Group shots by (group, id) → one card per state with its viewport variants.
const GROUP_ORDER = [
  "loom",
  "curation",
  "edit",
  "map",
  "drawer",
  "conversation",
  "themes",
];
const GROUP_BLURB: Record<string, string> = {
  loom: "The story view — reading, branching, generating, and everything that can go wrong.",
  curation: "KEEP and ANNOTATE on the focused turn — the archive-instrument loop.",
  edit: "The EDIT overlay — revising the seed or any turn in place.",
  map: "The minimap projection — the tree seen from above.",
  drawer: "The config drawer — tab strip, Settings, Stories, Models, model editor.",
  conversation: "Imported conversation looms and the receiving side of share links.",
  themes: "The same mid-story loom in every palette.",
};

const byState = new Map<string, Shot[]>();
for (const shot of shots) {
  const key = `${shot.group}::${shot.id}`;
  byState.set(key, [...(byState.get(key) ?? []), shot]);
}
const states = [...byState.values()]
  .map((variants) =>
    variants.sort((a, b) => (a.viewport === "desktop" ? -1 : 1) - (b.viewport === "desktop" ? -1 : 1)),
  )
  .sort((a, b) => a[0].seq - b[0].seq);

const groups = new Map<string, Shot[][]>();
for (const variants of states) {
  const g = variants[0].group;
  groups.set(g, [...(groups.get(g) ?? []), variants]);
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const sections = GROUP_ORDER.filter((g) => groups.has(g))
  .concat([...groups.keys()].filter((g) => !GROUP_ORDER.includes(g)))
  .map((g) => {
    const cards = groups
      .get(g)!
      .map((variants) => {
        const head = variants[0];
        const imgs = variants
          .map(
            (s) => `
        <a class="thumb ${s.viewport}" href="out/${esc(s.file)}" target="_blank" title="${esc(s.viewport)} — click for full size">
          <img loading="lazy" src="out/${esc(s.file)}" alt="${esc(head.title)} (${esc(s.viewport)})" />
          <span class="vp">${esc(s.viewport)}</span>
        </a>`,
          )
          .join("");
        return `
      <div class="card" id="${esc(head.id)}">
        <div class="card-head">
          <span class="seq">${String(head.seq).padStart(2, "0")}</span>
          <h3>${esc(head.title)}</h3>
          <span class="theme-tag">${esc(head.theme)}</span>
        </div>
        <p>${esc(head.description)}</p>
        <div class="thumbs">${imgs}</div>
      </div>`;
      })
      .join("\n");
    return `
    <section id="group-${esc(g)}">
      <h2>${esc(g.toUpperCase())}</h2>
      <p class="blurb">${esc(GROUP_BLURB[g] ?? "")}</p>
      <div class="grid">${cards}</div>
    </section>`;
  })
  .join("\n");

const nav = GROUP_ORDER.filter((g) => groups.has(g))
  .map((g) => `<a href="#group-${esc(g)}">${esc(g)}</a>`)
  .join(" · ");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>textile — screen atlas</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; }
  body { background: #0a0f0a; color: #b8e0b8; font-family: ui-monospace, "SF Mono", Menlo, monospace; padding: 2rem; }
  header { margin-bottom: 2rem; }
  h1 { font-size: 1.3rem; letter-spacing: 0.12em; color: #7CFC9A; }
  .meta { color: #5f8a5f; font-size: 0.8rem; margin-top: 0.4rem; }
  nav { margin-top: 0.8rem; font-size: 0.85rem; }
  nav a { color: #9adcb0; }
  section { margin: 2.5rem 0; }
  h2 { font-size: 1rem; letter-spacing: 0.2em; color: #7CFC9A; border-bottom: 1px solid #1d3320; padding-bottom: 0.4rem; }
  .blurb { color: #6fa07a; font-size: 0.8rem; margin: 0.5rem 0 1rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 1.2rem; }
  .card { border: 1px solid #1d3320; background: #0d140d; padding: 0.9rem; border-radius: 4px; }
  .card-head { display: flex; align-items: baseline; gap: 0.6rem; }
  .seq { color: #4a6b4a; font-size: 0.75rem; }
  .card h3 { font-size: 0.95rem; color: #d5f5d5; flex: 1; }
  .theme-tag { font-size: 0.65rem; color: #4a6b4a; white-space: nowrap; }
  .card p { font-size: 0.78rem; color: #86b18c; margin: 0.45rem 0 0.8rem; line-height: 1.45; }
  .thumbs { display: flex; gap: 0.8rem; align-items: flex-start; }
  .thumb { position: relative; display: block; border: 1px solid #234227; border-radius: 3px; overflow: hidden; }
  .thumb:hover { border-color: #7CFC9A; }
  .thumb.desktop { flex: 1 1 72%; min-width: 0; }
  .thumb.mobile { flex: 1 1 26%; min-width: 0; }
  .thumb img { display: block; width: 100%; height: auto; }
  .vp { position: absolute; bottom: 0; right: 0; background: #0a0f0acc; color: #7CFC9A; font-size: 0.6rem; padding: 0.15rem 0.4rem; }
  footer { margin-top: 3rem; color: #4a6b4a; font-size: 0.7rem; }
</style>
</head>
<body>
<header>
  <h1>TEXTILE — SCREEN ATLAS</h1>
  <div class="meta">${states.length} states · ${shots.length} screenshots · generated ${new Date().toISOString()} · deterministic fixtures, generation mocked (no live model calls)</div>
  <nav>${nav}</nav>
</header>
${sections}
<footer>Rebuild with <code>bun run atlas</code> — walks the app with Playwright against mocked generation, shoots every state, recomposes this sheet.</footer>
</body>
</html>
`;

writeFileSync(INDEX, html);
console.log(
  `Atlas: ${states.length} states, ${shots.length} shots → ${INDEX}`,
);
