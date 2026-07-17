# Forest floor / dial — design consultation (Fable 5)

*A read-only design consult by another model (Fable), given the handoff, the real
`StoryForest`/`StoryMinimap`/dispatch/CSS code, and the screenshots of the broken
floor. Verbatim, lightly de-escaped. Pairs with `HANDOFF-floor-grammar-mentalmodel.md`.*

---

## 1. Critique of the mental model

**Sound:** Fixed focal point / moving world is correct perceptual psychology
(recognition-by-shape needs a stable retinal location). One-grammar-per-projection is
sound, and the `bin` dispatch in `Interface.tsx` (≈1170–1232) already implements the
target grammar correctly (◄► dial, ↓ descend, ↵ read, ⌫ loom actions, ` floor menu,
↑ bonk). **The grammar layer is done — this is purely a presentation failure.** (Stale
comment at line 1166 still says "Up/Down move across them.") The SRCL self-diagnosis in
§7 is accurate.

**Missing / wrong:**

1. **"Same place" is necessary but not sufficient — the silhouette must be *wholly
   visible* at a *stable-ish scale*.** Biggest hole. A fingerprint seen through a
   scrolling porthole is not a fingerprint. The map is a **fly-over camera** (scrollable
   canvas, `svgWidth = Math.max(600, …)` at line 275, left-aligned SVG in a
   `minWidth:100%` div at 419 so tree-center lands at 300px regardless of container —
   why the bloom sits left-of-center and drifts per tree — and a scroll-centering
   effect at 296–409 that chases the reading cursor). The floor needs a **specimen
   camera** (whole tree fitted, root pinned). "The floor is the map zoomed out one
   level" must mean *change the camera contract, not just embed the component.* Reusing
   `StoryMinimap` unmodified inherits the wrong camera — that, not the label strip, is
   the root cause of the wandering bloom AND the mobile clip.

2. **The dial has an unacknowledged discontinuity.** Unlike a picker where items are
   identical as they slide, the centered item is radically different (bloomed) from
   bare neighbors. So "nothing re-packs" means the *row* slides continuously while the
   *bloom* swaps in place — an illusion produced by the fixed anchor. Implementation:
   two layers (constant-geometry row + fixed-position crossfading bloom). Test: the swap
   must be instant/fade, never a lateral slide.

3. **"Highlight follows correctly" conflates two marks.** Dial *focus* (which loom is
   centered) vs *current* (the loom you rose from, where START returns) are different
   states needing different visuals. Reuse the map's node-state grammar (lines 549–576):
   current = bright solid, focus = primary fill, other = faint outline. The "CURRENT"
   text tag dies with zero info loss.

4. **Wrap vs clamp unspecified; code contradicts the metaphor.** Dispatch wraps modulo
   (line 1180). A picker clamps; spatial memory argues clamp-with-bonk; wrapping lurches
   the row across its full width at the seam. Recommend clamp. Owner-taste flag.

5. **The bloom currently lies about state.** `StoryForest` passes `currentDepth=0,
   selectedOptions=[0], currentPath=[root]` → every bloom paints child-0 green (in every
   screenshot) as if a within-tree selection exists. It doesn't; that green node is pure
   noise and always marks child 0 regardless of where you left off. Honest bloom: root
   highlighted, no selected sibling.

6. Over-claimed but harmless: latent-natives/universality prose doesn't bear on the
   floor. "Dial as the idiom for siblings everywhere" is scope-creep bait — nail it here
   first.

---

## 2. The redesign

**One sentence:** Delete the text strip; make the dial a row of loom-pills drawn in the
map's own node idiom at a small fixed pitch, sliding under a fixed center; and give
`StoryMinimap` a `fit="floor"` camera (whole tree in a computed viewBox, root pinned
top-center, scroll disabled) so the bloom is a fixed, fully-visible silhouette hanging
beneath the centered pill — on 375px first.

**DOM / structure:**
```
<div class="story-forest">                     (column, flex:1)
  <svg class="story-forest-dial">              (fixed height ~56px, width 100%, overflow hidden)
    <g transform="translate(centerPx - (sel+0.5)*PITCH, 0)"
       style="transition: transform 180ms ease">
      one <rect> per loom, NODE_WIDTH=14, rx=2   ← the map's pill, verbatim
      + one full-height transparent <rect> per cell as tap target
    </g>
  </svg>
  <div class="story-forest-bloom">             (flex:1, min-height:0)
    <StoryMinimap key={sel.id} fit="floor" ... />   (root pinned top-center; own minibuffer)
  </div>
</div>
```
No border between dial and bloom (remove `.story-forest-floor` `border-bottom`, CSS
line 860 — it's what makes two grid areas). One visual field: a row of pills with a tree
hanging from the centered one.

**Dial row (roots as countable nodes):**
- Kill `FOREST_CELL=220` (sized for text). Pill pitch ≈ 32–40px (map's `LANE_WIDTH` is
  30 — match it so the floor reads as the map's sibling row one level up). ~9–11 siblings
  visible on 375px → you can count them. Neighbors clip at edges (honest; optional mask
  fade, ship without first).
- Node states reuse the map's CSS vars (lines 837–842): focus(centered)=selected
  treatment (`--primary-color` fill, stroke 1.5); current(rose-from)=current treatment
  (`--surface-color` fill, opacity 1); other=unvisited (`--background-color`, opacity
  ~0.4, stroke 0.8). focus==current → both.
- **Recommended fingerprint bonus:** pill *height* encodes loom size (node count / root
  text length) via `MIN/MAX_NODE_HEIGHT`, bottom-aligned on a baseline → the collapsed
  row is a recognizable *skyline*, not uniform tape. `trees[id]` is in hand at
  Interface.tsx:1677.
- **Why nothing re-packs:** row is constant geometry (N pills, fixed pitch, one `<g>`);
  dialing only changes `translateX`. Bloom is a separate fixed-position layer keyed by
  `sel.id`, crossfades in place (existing `view-fade`), never slides.
- **Two layers' semantics:** dial pill = loom-as-node (forest sibling); bloom root pill
  just below = the loom's first turn. Parent above, subtree below = the map's geometry,
  one zoom up. Don't attempt pixel-exact overlap (heights/scales differ per tree);
  proximity on the same center line carries the "blooms beneath it" read.

**Bloom — `fit="floor"` (fitting, not restyling):**
- viewBox, root-pinned: `rootX=coords[root].x`, `halfW=max(rootX−minX, maxX−rootX)+pad`,
  `viewBox=[rootX−halfW, −pad, 2·halfW, maxY+MAX_NODE_HEIGHT+pad]`, svg at 100%/100% with
  `preserveAspectRatio="xMidYMin meet"`. Symmetric-about-root viewBox → root at horizontal
  center for every tree, by math not scroll. `meet` fits the whole silhouette. Floor scale
  at container px (ResizeObserver/layout effect, expand halfW/height so scale ≤ 1 —
  "shrink to fit, never magnify").
- In floor mode skip: the `Math.max(600,…)` min-width, the `minWidth:100%` canvas div, the
  scroll `useLayoutEffect`, and viewport `overflow:auto` (add `.minimap-viewport.floor {
  overflow:hidden }`).
- Keep the minibuffer (already the in-idiom one-line preview; the only text on the floor —
  correct). Titles vanish from the floor; recognition by content, not title.
- Honest props: `currentPath=[root]`, `currentDepth=0`, stop forcing `selectedOptions=[0]`
  — pass a sentinel (e.g. `[-1]`) so no child paints selected; verify the
  `|| continuations[0]` fallback (lines 251–257) doesn't re-default to child 0 — the floor
  variant may need an explicit "no selection → null" path.

**Remove (exact inventory):**
- `StoryForest.tsx`: the `<button>` row `.story-forest-root-label`/`-tag` (59–79), the
  on-floor `title` use, `FOREST_CELL=220`.
- `terminal.css`: `.story-forest-root*` (885–917); `.story-forest-floor` `border-bottom`
  (860); 2.5rem strip height (858) → dial-svg height; center marker
  `.story-forest-floor::after` (864–873) — remove first (a fixed highlighted pill *is* the
  marker), re-add only if slides feel unanchored.
- Nothing changes in the `bin` dispatch, `modeRegistry` (the `◄►: DIAL • ↓: FLY • ↵: READ`
  hint stays), or `StoryMinimap` node rendering.

**Mobile-first numbers:** design at 375px, desktop inherits. Dial ~56px; bloom gets the
rest (~300px on mobile) which the fit-viewBox fills by construction — the mobile clip is
*impossible* in this camera (no overflowing canvas to clip). No `@media` fork for the
floor.

---

## 3. Prototype order + risks

**Order (each verifiable with `SHOTS_DIR=… bunx playwright test storybook`, mobile first):**
1. **`fit="floor"` camera alone** (old strip still in place): every fixture tree (1-node,
   deep, wide, Absalom set) wholly visible, root dead-center, 375px? Highest risk/value.
   Watch the `isSingleNode` branch (hardcoded 240×260 canvas, `SINGLE_NODE_SVG_WIDTH`,
   `SINGLE_NODE_Y`) — floor viewBox must adopt or bypass it; fixture `v01-floor-single-loom`.
2. **Pill dial** replacing the strip; sweep `v-dial-00…05`, confirm the centered pill never
   moves a pixel (diff the PNGs — the fixed point is now mechanically testable).
3. **The seam:** dial rapidly; row slide continuous, bloom swap is fade-in-place, no lateral
   motion, minibuffer no layout shift.

**Risks:**
- **viewBox scaling scales strokes** — at ~0.5 the 0.8px edges → 0.4px, may go faint. Fix:
  `vector-effect:non-scaling-stroke` via a floor-only rule on `.minimap-node`, or floor the
  scale. Check on a real phone.
- **Silhouette scale varies per tree** (wide tree shrinks) — slightly weakens the
  fingerprint. Cap-at-1 contains it. Strictly-constant-scale alternative (fixed forest-wide
  scale + horizontal clip) is worse — a clipped silhouette isn't a silhouette.
- **`selectedOptions=[-1]` sentinel** may trip `continuations[0]` fallback → verify; may
  need a 3-line "no selected sibling" path (not a node restyle).
- **N large:** pill row legible to a few dozen; past that, edge-clip hides the count. That's
  the find-at-scale problem (§8) — don't pretend to solve it, don't add pagination chrome.
- **Wrap→clamp** changes felt behavior; if owner wants wrap, keep modulo but render ghost
  copies at both ends to avoid the lurch (extra complexity). Recommend clamp + bonk (one
  line, Interface.tsx 1179–1186).

**Critical files:** `StoryForest.tsx` (pill dial + honest props), `StoryMinimap.tsx`
(`fit="floor"` camera; nodes untouched), `terminal.css` (delete text rules/border/marker;
add dial + `.minimap-viewport.floor`), `Interface.tsx` (dispatch stays; optional
wrap→clamp; stale comment), `tests/e2e/storybook.e2e.ts` (mobile sweep + fixed-point
pixel-diff).
