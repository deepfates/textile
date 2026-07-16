// PARITY CAPTURE — screenshots the surfaces that exist on BOTH main and the
// feat/action-menu branch (loom reading, map, and the drawer's settings /
// models / stories tabs), using only gestures present in both versions, so the
// two runs can be compared for regressions. Generation mocked. Run on each ref:
//   SHOTS_DIR=/path/main   git checkout main            && bunx playwright test parity
//   SHOTS_DIR=/path/branch git checkout feat/action-menu && bunx playwright test parity
import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const SHOTS = process.env.SHOTS_DIR ?? "/tmp/parity";
mkdirSync(SHOTS, { recursive: true });
const DESKTOP = { width: 1280, height: 800 };

async function mockGeneration(page: Page, prefix: string) {
  let count = 0;
  await page.route("**/api/generate", async (route) => {
    count += 1;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `data: {"content":" ${prefix} ${count}, and the path forked again."}\n\ndata: [DONE]\n\n`,
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

async function shot(page: Page, name: string) {
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

test("parity: shared surfaces (loom / map / drawer)", async ({ page }) => {
  test.setTimeout(120_000);
  await mockGeneration(page, "Elian pressed on");
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await waitForStoryIndex(page);

  await growTree(page, 3);
  await shot(page, "p1-loom");

  await page.keyboard.press("Escape");
  await expect(page.locator(".mode-bar-title")).toHaveText("MAP");
  await shot(page, "p2-map");
  await page.keyboard.press("Escape");

  await page.keyboard.press("`");
  await expect(page.locator(".mode-bar-title")).toHaveText("SETTINGS");
  await shot(page, "p3-drawer-settings");

  await page.keyboard.press("ArrowUp"); // to tab strip
  await expect(page.locator(".mode-bar-title")).toHaveText("TABS");
  await page.keyboard.press("ArrowRight"); // Models
  await page.keyboard.press("ArrowDown"); // into rows
  await expect(page.locator(".mode-bar-title")).toHaveText("MODELS");
  await shot(page, "p4-drawer-models");

  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".mode-bar-title")).toHaveText("TABS");
  await page.keyboard.press("ArrowRight"); // Stories
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".mode-bar-title")).toHaveText("STORIES");
  await shot(page, "p5-drawer-stories");
});
