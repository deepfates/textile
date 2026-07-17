// STORYBOOK CAPTURE — not assertion tests; these drive the real app through the
// forest-floor / action-menu screens AND their degrees of freedom (how many
// looms, tree shape, dial position, curation state, theme, viewport) and save a
// PNG of each, so a human can review exactly what the UI looks like. Generation
// is mocked (deterministic, no model latency). Run:
//   SHOTS_DIR=/path bunx playwright test storybook
import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const SHOTS =
  process.env.SHOTS_DIR ??
  "/private/tmp/claude-501/-Users-deepfates-Hacking-github-deepfates/a35b51a3-c8bb-47e0-b152-7f414b8e492d/scratchpad/screens";
mkdirSync(SHOTS, { recursive: true });

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 375, height: 812 };

async function mockGeneration(page: Page, prefix: string) {
  let count = 0;
  await page.route("**/api/generate", async (route) => {
    count += 1;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `data: {"content":" ${prefix} ${count}, and the path forked again into shadow."}\n\ndata: [DONE]\n\n`,
    });
  });
}

async function waitForStoryIndex(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.localStorage.getItem("textile-lync-v1-index-id"),
      ),
    )
    .toBeTruthy();
  await expect(page.locator(".gamepad-main")).toHaveAttribute(
    "data-story-ready",
    "true",
  );
}

async function settled(page: Page) {
  await expect(page.locator(".navigation-dot.loading")).toHaveCount(0);
}

async function title(page: Page) {
  return (await page.locator(".mode-bar-title").textContent())?.trim() ?? "";
}

async function shotDesktop(page: Page, name: string) {
  await page.setViewportSize(DESKTOP);
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${SHOTS}/${name}.desktop.png` });
}

// Capture at both viewports (state doesn't change on resize).
async function shot(page: Page, name: string) {
  await shotDesktop(page, name);
  await page.setViewportSize(MOBILE);
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${SHOTS}/${name}.mobile.png` });
  await page.setViewportSize(DESKTOP);
  await page.waitForTimeout(60);
}

async function riseToFloor(page: Page) {
  for (let i = 0; i < 16; i += 1) {
    if ((await title(page)) === "LOOMS") return;
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(90);
  }
  await expect(page.locator(".mode-bar-title")).toHaveText("LOOMS");
}

// Grow a tree of a given DEPTH in the current loom (each Enter fans a few mocked
// continuations; descend and repeat). Depth varies the silhouette.
async function growTree(page: Page, cycles = 3) {
  for (let i = 0; i < cycles; i += 1) {
    await page.keyboard.press("Enter");
    await settled(page);
    if (i < cycles - 1) {
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(120);
    }
  }
}

async function setTheme(
  page: Page,
  prefs: { mode: string; paletteLight: string; paletteDark: string },
) {
  await page.evaluate(
    (p) => localStorage.setItem("textile-theme-preferences", JSON.stringify(p)),
    prefs,
  );
  await page.reload();
  await waitForStoryIndex(page);
}

// ---------------------------------------------------------------------------
// 1) The base screens — one canonical instance of each state.
// ---------------------------------------------------------------------------
test("storybook: every forest-floor / menu screen", async ({ page }) => {
  test.setTimeout(120_000);
  await mockGeneration(page, "Elian pressed deeper into Absalom");
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await waitForStoryIndex(page);

  await growTree(page, 3);
  await shot(page, "01-loom");

  await page.keyboard.press("Backspace");
  // The action menu is a bottom SHEET: it carries its own title while the mode
  // bar keeps naming the view underneath, and the story stays visible.
  await expect(page.locator(".action-sheet-title")).toHaveText("TURN");
  await expect(page.locator(".mode-bar-title")).toHaveText("LOOM");
  await expect(page.locator(".story-text")).toBeVisible();
  await shot(page, "02-menu-turn");
  await page.keyboard.press("Escape");

  await page.keyboard.press("Escape");
  await expect(page.locator(".mode-bar-title")).toHaveText("MAP");
  await shot(page, "03-map");
  await page.keyboard.press("Escape");

  await riseToFloor(page);
  await page.keyboard.press("`");
  await expect(page.locator(".action-sheet-title")).toHaveText("FLOOR");
  await page.keyboard.press("Enter");
  await expect(page.locator(".mode-bar-title")).toHaveText("LOOM");
  await growTree(page, 3);

  await riseToFloor(page);
  await shot(page, "04-floor");

  await page.keyboard.press("Backspace");
  await expect(page.locator(".action-sheet-title")).toHaveText("LOOM ACTIONS");
  // The floor's dial stays visible under the sheet.
  await expect(page.locator(".story-forest")).toBeVisible();
  await shot(page, "05-menu-loom-actions");

  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page.locator(".action-sheet-title")).toHaveText("DELETE LOOM?");
  await shot(page, "06-menu-delete-confirm");
  await page.keyboard.press("Enter");

  await page.keyboard.press("`");
  await expect(page.locator(".action-sheet-title")).toHaveText("FLOOR");
  await shot(page, "07-menu-floor");
  await page.keyboard.press("Escape");

  await page.keyboard.press("Enter");
  await expect(page.locator(".mode-bar-title")).toHaveText("LOOM");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page.locator(".mode-bar-title")).toHaveText("EDIT");
  await shot(page, "08-edit");
});

// ---------------------------------------------------------------------------
// 2) Degrees of freedom — MANY looms of different shapes, the whole dial sweep,
//    curation state, and several themes.
// ---------------------------------------------------------------------------
test("storybook: dial sweep through many looms + variation", async ({
  page,
}) => {
  test.setTimeout(360_000);
  await mockGeneration(page, "A road out of Absalom");
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await waitForStoryIndex(page);

  // The initial single loom → floor with exactly one root (dial with nothing).
  await growTree(page, 2);
  await riseToFloor(page);
  await shot(page, "v01-floor-single-loom");

  // Five more looms of DIFFERENT depths so each has a distinct silhouette.
  const depths = [4, 1, 3, 1, 2];
  for (const d of depths) {
    await page.keyboard.press("`");
    await expect(page.locator(".action-sheet-title")).toHaveText("FLOOR");
    await page.keyboard.press("Enter"); // new loom → drops into LOOM
    await expect(page.locator(".mode-bar-title")).toHaveText("LOOM");
    await growTree(page, d);
    await riseToFloor(page);
  }

  // THE DIAL SWEEP — MOBILE-FIRST: six looms, one press at a time, captured at
  // 375px first (the form factor that matters) and desktop. Each frame shows
  // the row sliding under the fixed centre and a different silhouette blooming
  // in place. The dial CLAMPS at the ends (spatial memory — leftmost stays
  // leftmost; past the end bonks, no wrap).
  //
  // THE FIXED-POINT PROOF (mechanical, not eyeballed): at every dial position,
  // (a) the centred pill's midline sits on the dial's midline and its baseline
  // holds still (DOM geometry), and (b) a pixel crop of the centred pill's
  // constant bottom band is BYTE-IDENTICAL across all positions — the focal
  // point literally never moves a pixel; only the row and the bloom change.
  const bands: Buffer[] = [];
  let anchor: { cx: number; bottom: number } | null = null;
  const pillGeometry = () =>
    page.evaluate(() => {
      const dial = document
        .querySelector(".story-forest-dial")!
        .getBoundingClientRect();
      const pill = document
        .querySelector(".story-forest-cell.selected .story-forest-pill")!
        .getBoundingClientRect();
      return {
        dialCx: dial.left + dial.width / 2,
        cx: pill.left + pill.width / 2,
        bottom: pill.bottom,
      };
    });
  for (let i = 0; i < 6; i += 1) {
    const name = `v-dial-${String(i).padStart(2, "0")}`;
    await page.setViewportSize(MOBILE);
    await page.waitForTimeout(260); // let the slide transition settle
    const geom = await pillGeometry();
    // Centred on the dial's midline…
    expect(Math.abs(geom.cx - geom.dialCx)).toBeLessThanOrEqual(1);
    // …and at the exact same point as every other position.
    anchor ??= geom;
    expect(Math.abs(geom.cx - anchor.cx)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(geom.bottom - anchor.bottom)).toBeLessThanOrEqual(0.5);
    // The constant band: every pill is ≥16px tall and bottom-aligned, and the
    // selected fill/stroke are theme constants, so this crop must not vary.
    bands.push(
      await page.screenshot({
        clip: { x: geom.cx - 12, y: geom.bottom - 14, width: 24, height: 12 },
      }),
    );
    await page.screenshot({ path: `${SHOTS}/${name}.mobile.png` });
    await shotDesktop(page, name);
    await page.keyboard.press("ArrowRight");
  }
  bands.forEach((band, i) => {
    expect(
      band.equals(bands[0]),
      `fixed point broken: centred pill band differs at dial position ${i}`,
    ).toBe(true);
  });
  // CLAMP: that last ArrowRight was pressed at the right end — it must bonk,
  // not wrap back to the start.
  await page.setViewportSize(MOBILE);
  await page.waitForTimeout(260);
  const endLabel = await page
    .locator(".story-forest-cell.selected")
    .getAttribute("aria-label");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(260);
  await expect(page.locator(".story-forest-cell.selected")).toHaveAttribute(
    "aria-label",
    endLabel ?? "",
  );
  await page.setViewportSize(DESKTOP);

  // CURATION state — keep + annotate a turn, then read it back so the ✓/✎
  // indicators show on the focused turn.
  await page.keyboard.press("Enter"); // read the focused loom
  await expect(page.locator(".mode-bar-title")).toHaveText("LOOM");
  await page.keyboard.press("ArrowDown"); // onto a real turn
  await page.waitForTimeout(120);
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Enter"); // keep (row 0) → closes
  await page.waitForTimeout(120);
  await page.keyboard.press("Backspace");
  await page.keyboard.press("ArrowDown"); // note (row 1)
  await page.keyboard.press("Enter"); // NOTE overlay
  await expect(page.locator(".mode-bar-title")).toHaveText("NOTE");
  await page.locator("textarea").fill("this line actually lands");
  await page.getByRole("button", { name: "START" }).click(); // save
  await expect(page.locator(".mode-bar-title")).toHaveText("LOOM");
  // The "Note saved ✓" notice briefly takes the strip (and hides the cluster to
  // avoid overlap); wait for it to clear so the persistent ✓ kept / ✎ note
  // indicator is what we actually capture.
  await expect(page.locator(".story-curation-status")).toBeVisible({
    timeout: 8000,
  });
  await shot(page, "v-curation-kept-and-noted");

  // THEMES — the floor across every palette (colour/position hierarchy, not
  // size), each at both viewports. theme-light is the default already covered
  // by 04-floor / v-dial-*.
  const themes: Array<{
    name: string;
    prefs: { mode: string; paletteLight: string; paletteDark: string };
  }> = [
    {
      name: "outrun",
      prefs: {
        mode: "dark",
        paletteLight: "theme-light",
        paletteDark: "theme-outrun",
      },
    },
    {
      name: "bsod",
      prefs: {
        mode: "light",
        paletteLight: "theme-blue",
        paletteDark: "theme-black-green",
      },
    },
    {
      name: "aperture",
      prefs: {
        mode: "light",
        paletteLight: "theme-aperture",
        paletteDark: "theme-black-green",
      },
    },
    {
      name: "phosphor",
      prefs: {
        mode: "dark",
        paletteLight: "theme-light",
        paletteDark: "theme-black-green",
      },
    },
    {
      name: "nerv",
      prefs: {
        mode: "dark",
        paletteLight: "theme-light",
        paletteDark: "theme-nerv",
      },
    },
  ];
  for (const { name, prefs } of themes) {
    await setTheme(page, prefs);
    await riseToFloor(page);
    await shot(page, `v-theme-${name}-floor`);
  }
});
