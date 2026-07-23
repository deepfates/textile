# textile design vision — DRAFT

*Agent-facing brief. DRAFT: the intentions and constraints below are collected from
the owner's own statements, commits, and design evidence; the open questions at
the end are his to rule on. Read this before touching any interface surface.
Canonical implementation detail lives beside the code, including
`docs/floor-descend-continuity-consult-fable.md` for floor/dial behavior and
`docs/srcl-migration-notes.md` for the styling map. Raw consultation and handoff
notes are source evidence, not additional operating manuals.*

## What textile is

A tactile, handheld interface for looms — trees of text where each node is a turn
and each branch is a road-not-taken. Born NYE 2024 as loompad: "loom in bed, like a
Game Boy… a book, except it branches." Talks to base models via the completions
API; the model is a simulator, not an assistant. Lineage: janus's loom, cyborgism.

The larger bet: textile is an instrument for pathfinding through latent-space
multiverses, and the grammar (not the feature set) is the transferable asset. It
generalizes by holding any *multiverse* (text, conversations, images, worlds), NOT
by holding any *computation* — the second kind of universality dilutes the grip and
is explicitly rejected. Mobile ("loom in bed", 375px) is the primary form factor.

## Intentions (the why behind every rule)

1. **Attention is the scarce resource.** The multiverse is unbounded; the interface
   is an attention-shaping machine. Keep the decision surface tiny at every moment:
   one thread to read, a few siblings to choose, one tree bloomed at a time, a
   handful of verbs.
2. **Controls, data, and task share one geometry.** The GameBoy vocabulary — d-pad
   + A + B + START + SELECT — never grows. The d-pad maps the tree's degrees of
   freedom; expressive range comes from switching projections, never from adding
   buttons or chrome.
3. **Recognition by shape, not by reading.** You find things by silhouette and
   position (a tree's shape is a fingerprint), backed by a one-line minibuffer
   preview. This is the spatial-memory bet the whole console rests on, and it is
   why focal points must be FIXED: a fingerprint is only recognizable if it appears
   in the same place every time.
4. **The constraint is emotional, not just functional.** Apple IIc amber phosphor,
   GameBoy thumb-memory: nostalgic constraint wrapped around a frontier substrate
   domesticates the multiverse. That is why the discipline stays strict even when a
   label "would help."

## Hard constraints (violations are defects, not taste)

- **SRCL single-size discipline** (restored in PR #70, "One monospace size, one
  grid"): one monospace typeface at ONE size, everything on the character grid.
  Hierarchy is colour and position, NEVER font size. No avatars, no badges, no
  caption strips. sacred.computer's own words: secondary text is "differentiated
  through positioning and subtle colour shifts rather than size reduction." The
  only permitted `font-size` declarations are the two glyph-in-button `calc()`
  sizes. Ticket dee-7pc9 tracks finishing the full srcl migration (or formally
  retiring the plan) — `terminal.css` is still the original custom layer.
- **Themes swap palette + font over identical bones.** Six theme classes today
  (Highlight / BSOD / Aperture / Phosphor / NERV / Outrun) × light/dark/system ×
  font choice. New surfaces must be drawn entirely in the existing CSS variables so
  every theme works for free. (Known debt: README says 14 themes; `theme.ts` names
  three that don't exist.)
- **One grammar PER PROJECTION.** Within a projection (loom / map / bin-floor /
  menu) the d-pad meaning is fixed; across projections it may differ; START/SELECT
  switch projections. Never overload a key contextually inside one projection.
- **The map's node viz is the owner's deliberate design** — its node style and
  layout are not to be redesigned. Fitting/embedding it (cameras, viewBox,
  containers) is fair game; restyling nodes is not.
- **The dial idiom for sibling choice:** the selected item is pinned at a fixed
  focal point and the world moves under it (iOS picker). The dial CLAMPS at the
  ends with a bonk — it does not wrap (owner-ratified, commit 8f93e14: "clamps at
  the ends (spatial memory), not wraps").
- **Nothing silent** (fleet law): imports, saves, deletes, generation failures all
  surface loudly and in-idiom. No native `prompt()`/`confirm()` dialogs — confirm
  destructive acts through the menu door with the safe row pre-selected.
- **When in doubt, remove chrome.** Any impulse toward a text label, a font-size
  change, or a new grid area is almost always wrong here.

## Interaction grammar (current, main + feat/action-menu)

Controls sit at the BOTTOM of the device; interaction gravity is bottom-anchored —
overlays and transient surfaces should respect where the thumbs are.

- **loom** (reading): ↵ generate, ↑↓ depth, ◄► siblings, ⌫ act on the focused
  turn, ↑ at root rises to the floor, START→map, SELECT→config drawer.
- **map** (fly-over): d-pad walks the tree, ⌫ edits the highlighted node, START
  returns to loom, minibuffer previews.
- **floor / bin** (the forest): looms as sibling roots on a baseline; ◄► dial
  through a fixed centre, only the selected root blooms; ↓ descend into its map,
  ↵ read, ⌫ loom actions, SELECT floor actions, ↑ inert (bonk).
- **menu** (the one door): every action-set (turn / loom / floor / delete-confirm)
  is a `Menu` descriptor rendered by one `ActionMenu`; ↕ moves, ↵ chooses,
  ⌫/START cancels. Rows are real buttons (touch-tappable).
- **Bonk:** navigation that hits a wall animates a directional bounce — the
  interface says no physically, not with text.

## Open taste questions for the owner (each with concrete options)

1. **Per-node menu placement (PR #74).** Ruled in principle — bottom drawer
   overlaying the story — but the exact treatment is open:
   (a) bottom sheet inside `.terminal-screen`, story dimmed but visible above;
   (b) bottom sheet + the focused turn's text kept fully bright as context;
   (c) minimal one-row strip just above the controls, ◄► to move between verbs.
2. **Glow.** Phosphor-era CRTs glowed; `terminal.css` currently has no
   text-shadow/glow anywhere. Options: (a) none, stay flat (quiet default);
   (b) subtle glow on the active/green text only, per-theme variable;
   (c) full CRT treatment (glow + scanlines) as one opt-in theme, bones unchanged.
3. **Radial map.** An old unmerged branch (`codex/implement-radial-tiny-tree-interface`,
   "rotate minimap into radial tree") exists. Options: (a) discard — the flextree
   map is the deliberate viz; (b) revive as a third projection for large trees;
   (c) revive only as the floor's zoomed-out forest view.
4. **Conversation speaker separators.** Imported conversation looms interleave
   speakers; the SRCL law forbids size/badge markers. Options: (a) colour only
   (authorship palette, already partly built via `AuthorshipIndicator`/authorship
   display); (b) position — indent or gutter-glyph per speaker on the grid;
   (c) blank-line separation only, speakers unmarked (maximally quiet).
5. **READER vs EXPORT telos.** Is textile primarily a reading prosthesis (curated,
   allowed to forget-from-view) with export as a harvest, or an export engine
   (nothing forgotten anywhere)? Leaning READER per the handoff doc, but unratified
   — it decides single-user leanings and what "nothing-silent" binds.
6. **Dial fingerprint bonus.** Should floor pills encode loom size as pill height
   (a skyline you can recognize), or stay uniform? Options: (a) uniform pills;
   (b) height = node count; (c) height = root text length.

## Ledger pointers

Styling: dee-7pc9 (srcl migration). Floor lane: tex-q82u (mobile minimap clip),
tex-cptz (retire drawer stories tab), tex-i2c8 (root-contextual ↑ hint),
tex-ozit (recognition preview). Unsolved and explicitly not to be faked with
chrome: find-at-scale (finding one loom among hundreds on a d-pad).
