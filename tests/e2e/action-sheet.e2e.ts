// ACTION SHEET overlay contract (owner ruling, 2026-07): the per-node action
// menu is "a drawer that pops up from the bottom of the inner viewport,
// overlaid over the existing stuff … It should overlay and still show whatever
// you were at before so you can remember what node you're on." These tests
// assert exactly that: the sheet rises from the bottom edge, is sized to its
// rows (no full-screen air), and the view it acts on stays visible above it.
import { expect, test, type Page } from "@playwright/test";

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

test("turn sheet overlays the loom — story stays visible underneath", async ({
  page,
}) => {
  await page.goto("/");
  await waitForStoryIndex(page);
  await expect(page.locator(".story-text")).toContainText(
    "Once upon a time, in Absalom,",
  );

  await page.keyboard.press("Backspace");

  // The sheet is up, carrying its own title; the mode bar still names the
  // view underneath.
  const sheet = page.getByTestId("action-sheet");
  await expect(sheet).toBeVisible();
  await expect(page.locator(".action-sheet-title")).toHaveText("TURN");
  await expect(page.locator(".mode-bar-title")).toHaveText("LOOM");

  // THE OVERLAY CONTRACT: the story you were on is still visible.
  await expect(page.locator(".story-text")).toBeVisible();
  await expect(page.locator(".story-text")).toContainText(
    "Once upon a time, in Absalom,",
  );

  // Bottom drawer, sized to its rows: flush with the screen's bottom edge,
  // and far short of covering the whole inner viewport (no air). Let the
  // rise animation land before measuring.
  await sheet.evaluate((el) =>
    Promise.all(el.getAnimations().map((a) => a.finished)),
  );
  const screenBox = await page.locator(".terminal-screen").boundingBox();
  const sheetBox = await sheet.boundingBox();
  if (!screenBox || !sheetBox) throw new Error("missing bounding boxes");
  expect(
    Math.abs(sheetBox.y + sheetBox.height - (screenBox.y + screenBox.height)),
  ).toBeLessThanOrEqual(3);
  expect(sheetBox.height).toBeLessThan(screenBox.height * 0.6);

  // All three turn rows are present and tappable.
  await expect(sheet.getByRole("menuitem")).toHaveCount(3);

  // Close: the sheet leaves, the loom remains.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("action-sheet")).toHaveCount(0);
  await expect(page.locator(".story-text")).toBeVisible();
});

test("floor sheets overlay the dial of looms", async ({ page }) => {
  await page.goto("/");
  await waitForStoryIndex(page);

  // Rise to the floor (LOOMS).
  for (let i = 0; i < 16; i += 1) {
    const title =
      (await page.locator(".mode-bar-title").textContent())?.trim() ?? "";
    if (title === "LOOMS") break;
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(90);
  }
  await expect(page.locator(".mode-bar-title")).toHaveText("LOOMS");

  // SELECT opens the FLOOR sheet; the forest dial stays visible under it.
  await page.keyboard.press("`");
  await expect(page.locator(".action-sheet-title")).toHaveText("FLOOR");
  await expect(page.locator(".mode-bar-title")).toHaveText("LOOMS");
  await expect(page.locator(".story-forest")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("action-sheet")).toHaveCount(0);

  // ⌫ opens the per-loom sheet; same overlay contract.
  await page.keyboard.press("Backspace");
  await expect(page.locator(".action-sheet-title")).toHaveText("LOOM ACTIONS");
  await expect(page.locator(".story-forest")).toBeVisible();
});
