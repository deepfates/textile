# Floor→story descend continuity — consult (Fable 5)

*Read-only design consult on making the floor→story descend feel continuous
("the floor slides up out of view and the tree moves up so the root is centred
where my dial selection was"). Pairs with `floor-redesign-consult-fable.md`.*

## The jump is FOUR (five) discontinuities, each a line of code

1. **x-frame snap (root 800→755).** Floor camera is root-centred (`floorViewBox =
   rootX − vbW/2`); the map TREE-centres (`rootOffset = centerX − treeCenter`) in a
   `max(600,…)` canvas left-aligned in a `minWidth:100%` div, and its scroll-chase
   is defeated by `Math.max(0, targetLeft)` — so the map's own "centre the
   highlighted node" intent silently fails exactly when highlighted = root.
2. **y-frame snap (165→87 ≈ 62px).** Floor = dial(56px) + bloom topPad 14; map =
   full slot, padding 8, root at y=0. Dial vanishes in the same frame.
3. **Green-child snap.** `setCurrentLoomId` resets `selectedOptions=[0]`; the map
   paints `continuations[0]` primary. Honest map state, but it materialises in the
   same frame.
4. **Swap-as-cut.** StoryForest unmounts, StoryMinimap mounts with a
   `view-fade` (opacity from 0) — a fade-from-nothing reads as a cut.
5. **(latent) scale pop** on trees bigger than the container (floor scales <1, map
   is always 1) — invisible on desktop, guaranteed at 375px.

## Architecture: a FRAME-HANDOFF CONTRACT, not a merged component

They do NOT need to become one component or share an animated container — because
**both views already draw pixel-identical geometry through the same
`StoryMinimap`** (fit only changes framing). When two cameras draw the same world,
"seamless" = the floor animates its camera to a **handoff frame**, the map opens in
that EXACT frame, and the swap is invisible by construction (mechanically testable
by pixel-diff). Merging into one zoomable component is the platonic end-state but is
major surgery on the deliberate fly-over; the handoff contract delivers the identical
felt result.

**Structural prerequisite:** the floor's minimap must own the FULL slot, with the
dial as an **absolutely-positioned overlay** on top. Then the tree can rise into the
dial's vacated area AND the floor/map viewports become the same box, so the handoff
arithmetic is exact:
`RISE = DIAL_H + FLOOR_TOP_PAD − MAP_VIEWPORT_PAD = 56 + 14 − 8 = 62px`
(derive from shared exported constants; don't hardcode). This is also the truer
model: the floor IS the map with a dial overlaid, one zoom out.

### The four questions
- **Root x:** descended end-state keeps the root at container centre (the floor's
  frame, NOT the standalone map's tree-centred default) — scope it to a
  *descend-entry mode*: give the chase camera the slack to actually centre the root
  (canvas x-pad = `max(padding, viewportW/2)`, initial `scrollLeft = rootCanvasX −
  viewportW/2`). Node rendering/layout/chase logic unchanged; standalone map (START
  from loom) mounts WITHOUT the flag → pixel-identical (parity.e2e.ts proves it).
- **Root y / dial:** dial slides up by RISE and the camera pans up by RISE on the
  SAME clock/easing (one rAF loop writing `transform` and the `viewBox` attribute;
  two clocks shear). x never changes.
- **Auto-child:** don't change the state — DELAY its paint. Descend-entry mounts
  `settled=false` (sibling rendered unvisited), flips true ~150ms post-swap with a
  scoped fill/opacity transition → the map "wakes up." Minibuffer swaps root-line →
  sibling-line at the same settle moment (its position is already continuous).
- **Scale:** constant when the tree fits at 1 (the common case). When floor scale
  <1, ease `scale→1` during the rise (viewBox pans+zooms in one attribute).

## Implementation plan (smallest change first)

**Stage 1 — frame fixes, ZERO animation (~70% of the jump, ship-worthy alone):**
1. `StoryMinimap.tsx`: add `entry?: "descend"`. When set: canvas x-pad =
   `max(padding, viewportW/2)` (measure viewport in the existing first-positioning
   layout-effect; setState re-renders pre-paint, no flash); first positioning sets
   `scrollLeft` to centre root, `scrollTop=0`, skipping the `lastMapNodeId` smooth
   dance; suppress `view-fade`; `settled` flag + delayed sibling paint.
2. `Interface.tsx`: bin `ArrowDown` + `onDescend` set a `mapEntry` flag consumed by
   the map render branch, cleared on any other projection change; pass `entry`.
3. Result: root stays centred, no fade, green child fades in late. Only the 62px
   rise + dial disappearance remain.

**Stage 2 — the motion:**
4. `StoryForest.tsx`: full-slot minimap + absolute dial overlay (CSS: `.story-forest
   { position:relative; overflow:hidden }`, dial `position:absolute; top:0`); floor
   camera gains `DIAL_H` compensation (a `topInset` prop). Verify resting pixels
   unchanged.
5. `Interface.tsx`: `floorPhase: "idle"|"descending"`. `beginDescend`: touch/set
   loom, phase descending, bin keys early-return (300ms guard). On completion:
   `setProjection("map")`, phase idle, `mapEntry="descend"`.
6. One rAF loop (~280ms, fixed cubic ease; `prefers-reduced-motion` → instant swap
   with Stage-1 frames) interpolating dial `translateY(0→−RISE)`, floor viewBox
   `minY` and `scale→1`, via ref (no per-frame React render). x stays fixed.
7. Fix the stale "Up/Down move across them" comment (Interface.tsx:1166).

**Untouched:** bin dispatch grammar, dial slide/clamp, modeRegistry, node rendering,
the standalone map path (`entry` undefined ⇒ dead branches).

## Verify + risks
- **Swap-boundary pixel-diff** (the heart): last pre-swap frame vs first post-swap
  frame — identical within AA tolerance around root pill + minibuffer.
- **Frame sequence** every ~50ms at 375 + 1280: monotonic rigid rise, no lateral
  root drift.
- **Parity**: standalone map pixel-identical to before (proof you didn't touch the
  owner's camera).
- **Live (owner judges):** hitch at swap, rapid dial-then-↓, keys during the guard,
  green-sibling fade reading as "waking" vs "lag", reduced-motion.
- **Risks (ranked):** constant drift across 3 files (→ shared constants + pixel-diff
  tripwire); single-node looms (map's 240×260 ghost-child pose ≠ floor frame — flag,
  test `v01-floor-single-loom`); widened descended margins (owner said sparse ok);
  layout-effect flash; zoom-during-rise on big trees.
- **Follow-up (not now):** ascend symmetry (↑ map→floor = reverse motion); ↵ READ
  (floor→loom) remains a cut, unflagged.

**Files:** StoryMinimap.tsx, StoryForest.tsx, Interface.tsx, terminal.css,
tests/e2e/storybook.e2e.ts.
