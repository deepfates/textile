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
  await expect(page.locator(".mode-bar-title")).toHaveText("TURN");
  await shot(page, "02-menu-turn");
  await page.keyboard.press("Escape");

  await page.keyboard.press("Escape");
  await expect(page.locator(".mode-bar-title")).toHaveText("MAP");
  await shot(page, "03-map");
  await page.keyboard.press("Escape");

  await riseToFloor(page);
  await page.keyboard.press("`");
  await expect(page.locator(".mode-bar-title")).toHaveText("FLOOR");
  await page.keyboard.press("Enter");
  await expect(page.locator(".mode-bar-title")).toHaveText("LOOM");
  await growTree(page, 3);

  await riseToFloor(page);
  await shot(page, "04-floor");

  await page.keyboard.press("Backspace");
  await expect(page.locator(".mode-bar-title")).toHaveText("LOOM ACTIONS");
  await shot(page, "05-menu-loom-actions");

  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page.locator(".mode-bar-title")).toHaveText("DELETE LOOM?");
  await shot(page, "06-menu-delete-confirm");
  await page.keyboard.press("Enter");

  await page.keyboard.press("`");
  await expect(page.locator(".mode-bar-title")).toHaveText("FLOOR");
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
  test.setTimeout(240_000);
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
    await expect(page.locator(".mode-bar-title")).toHaveText("FLOOR");
    await page.keyboard.press("Enter"); // new loom → drops into LOOM
    await expect(page.locator(".mode-bar-title")).toHaveText("LOOM");
    await growTree(page, d);
    await riseToFloor(page);
  }

  // THE DIAL SWEEP: six looms, one press at a time. Each frame shows the row
  // sliding under the fixed centre and a different silhouette blooming — plus
  // the wrap-around at the ends (the dial is modular).
  for (let i = 0; i < 6; i += 1) {
    await shotDesktop(page, `v-dial-${String(i).padStart(2, "0")}`);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(240); // let the slide transition settle
  }
  // One mobile frame of the floor, to show the dial on a phone.
  await page.setViewportSize(MOBILE);
  await page.waitForTimeout(140);
  await page.screenshot({ path: `${SHOTS}/v-dial-mobile.mobile.png` });
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

  // THEMES — the floor across palettes (colour/position hierarchy, not size).
  await setTheme(page, {
    mode: "dark",
    paletteLight: "theme-light",
    paletteDark: "theme-outrun",
  });
  await riseToFloor(page);
  await shotDesktop(page, "v-theme-outrun-floor");

  await setTheme(page, {
    mode: "light",
    paletteLight: "theme-blue",
    paletteDark: "theme-black-green",
  });
  await riseToFloor(page);
  await shotDesktop(page, "v-theme-bsod-floor");

  await setTheme(page, {
    mode: "light",
    paletteLight: "theme-aperture",
    paletteDark: "theme-black-green",
  });
  await riseToFloor(page);
  await shotDesktop(page, "v-theme-aperture-floor");
});
