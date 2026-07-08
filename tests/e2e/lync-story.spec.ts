import { Buffer } from "node:buffer";
import { expect, test, type Page } from "@playwright/test";

async function mockGeneration(page: Page, prefix: string) {
  let count = 0;
  await page.route("**/api/generate", async (route) => {
    count += 1;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `data: {"content":" ${prefix} ${count}."}\n\ndata: [DONE]\n\n`,
    });
  });
}

async function captureClipboard(page: Page) {
  await page.addInitScript(() => {
    window.__textileClipboardText = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          window.__textileClipboardText = text;
        },
        readText: async () => window.__textileClipboardText,
      },
    });
  });
}

async function openStoriesDrawer(page: Page) {
  await page.getByRole("button", { name: "SELECT" }).click();
  await page.getByRole("tab", { name: "Stories" }).click();
}

async function readCapturedClipboard(page: Page) {
  return page.evaluate(() => window.__textileClipboardText);
}

function referenceFromPageUrl(page: Page) {
  const encoded = new URL(page.url()).searchParams.get("ref");
  if (!encoded) return null;
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
    kind: string;
    loomId?: string;
    turnId?: string;
  };
}

async function waitForCurrentThreadRef(page: Page) {
  await expect.poll(() => referenceFromPageUrl(page)).toMatchObject({
    kind: "thread",
  });
}

declare global {
  interface Window {
    __textileClipboardText: string;
  }
}

test("same-browser tabs converge on generated story updates without refresh", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const pageOne = await context.newPage();
  await mockGeneration(pageOne, "Same browser sync");

  await pageOne.goto("/");
  await expect(pageOne.locator("body")).toContainText(
    "Once upon a time, in Absalom,",
  );
  await waitForCurrentThreadRef(pageOne);

  const pageTwo = await context.newPage();
  await mockGeneration(pageTwo, "Same browser sync");
  await pageTwo.goto("/");
  await expect(pageTwo.locator("body")).toContainText(
    "Once upon a time, in Absalom,",
  );
  await waitForCurrentThreadRef(pageTwo);

  await pageOne.keyboard.press("Enter");

  await expect(pageOne.locator("body")).toContainText("Same browser sync 1.");
  await expect(pageTwo.locator("body")).toContainText("Same browser sync 1.");
  await context.close();
});

test("stale v0 local-first storage does not block the current v1 app", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.addInitScript(() => {
    window.localStorage.setItem(
      "textile-lync-v0-index-id",
      "automerge:stale-v0-index",
    );
    window.sessionStorage.setItem(
      "textile-lync-v0-story-session",
      JSON.stringify({ "stale-loom": { "stale-turn": 1 } }),
    );
  });

  await mockGeneration(page, "Fresh storage");
  await page.goto("/");

  await expect(page.locator("body")).toContainText(
    "Once upon a time, in Absalom,",
  );
  await waitForCurrentThreadRef(page);
  await expect.poll(() =>
    page.evaluate(() => window.localStorage.getItem("textile-lync-v1-index-id")),
  ).toBeTruthy();
  await expect.poll(() => referenceFromPageUrl(page)).toMatchObject({
    kind: "thread",
  });

  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toContainText("Fresh storage 1.");

  await context.close();
});

test("browser URL follows the current loom and thread focus", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await mockGeneration(page, "URL focus");

  await page.goto("/");
  await expect(page.locator("body")).toContainText(
    "Once upon a time, in Absalom,",
  );
  await waitForCurrentThreadRef(page);

  await expect.poll(() => referenceFromPageUrl(page)).toMatchObject({
    kind: "thread",
  });
  const rootThreadRef = referenceFromPageUrl(page);
  expect(rootThreadRef?.loomId).toBeTruthy();
  expect(rootThreadRef?.turnId).toBeTruthy();

  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toContainText("URL focus 1.");
  await expect.poll(() => referenceFromPageUrl(page)).toMatchObject({
    kind: "thread",
    loomId: rootThreadRef?.loomId,
  });
  const firstThreadRef = referenceFromPageUrl(page);
  expect(firstThreadRef?.turnId).not.toBe(rootThreadRef?.turnId);

  await page.keyboard.press("ArrowRight");
  await expect(page.locator("body")).toContainText("URL focus 2.");
  await expect.poll(() => referenceFromPageUrl(page)?.turnId).not.toBe(
    firstThreadRef?.turnId,
  );

  await context.close();
});

test("a copied story link opens the same loom in another browser context", async ({
  browser,
}) => {
  const owner = await browser.newContext();
  const page = await owner.newPage();
  await captureClipboard(page);
  await mockGeneration(page, "Shared root");

  await page.goto("/");
  await expect(page.locator("body")).toContainText(
    "Once upon a time, in Absalom,",
  );
  await waitForCurrentThreadRef(page);
  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toContainText("Shared root 1.");
  await openStoriesDrawer(page);
  await page
    .getByRole("button", { name: "Copy story link" })
    .first()
    .focus();
  await page.keyboard.press("Enter");

  const storyUrl = await readCapturedClipboard(page);
  expect(storyUrl).toContain("?ref=");

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await mockGeneration(guestPage, "Guest");
  await guestPage.goto(storyUrl);

  await expect(guestPage.locator("body")).toContainText("Shared root 1.");
  await owner.close();
  await guest.close();
});

test("a copied story list link imports the shared index and listed looms", async ({
  browser,
}) => {
  const owner = await browser.newContext();
  const page = await owner.newPage();
  await captureClipboard(page);
  await mockGeneration(page, "Shared index");

  await page.goto("/");
  await expect(page.locator("body")).toContainText(
    "Once upon a time, in Absalom,",
  );
  await waitForCurrentThreadRef(page);
  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toContainText("Shared index 1.");
  await openStoriesDrawer(page);
  await page.getByRole("button", { name: "Copy story list link" }).focus();
  await page.keyboard.press("Enter");

  const indexUrl = await readCapturedClipboard(page);
  expect(indexUrl).toContain("?ref=");

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await mockGeneration(guestPage, "Guest");
  await guestPage.goto(indexUrl);

  await expect(guestPage.locator("body")).toContainText("Shared index 1.");
  await openStoriesDrawer(guestPage);
  await expect(guestPage.locator("body")).toContainText("Story 1");
  await owner.close();
  await guest.close();
});

test("a copied thread link opens the same loom and lands on the intended thread", async ({
  browser,
}) => {
  const owner = await browser.newContext();
  const page = await owner.newPage();
  await captureClipboard(page);
  await mockGeneration(page, "Shared thread");

  await page.goto("/");
  await expect(page.locator("body")).toContainText(
    "Once upon a time, in Absalom,",
  );
  await waitForCurrentThreadRef(page);
  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toContainText("Shared thread 1.");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toContainText("Shared thread 4.");

  await openStoriesDrawer(page);
  await page
    .getByRole("button", { name: "Copy current thread link" })
    .first()
    .focus();
  await page.keyboard.press("Enter");

  const threadUrl = await readCapturedClipboard(page);
  expect(threadUrl).toContain("?ref=");

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await mockGeneration(guestPage, "Guest");
  await guestPage.goto(threadUrl);

  await expect(guestPage.locator("body")).toContainText("Shared thread 1.");
  await expect(guestPage.locator("body")).toContainText("Shared thread 4.");
  await owner.close();
  await guest.close();
});

test("separate browser contexts converge on live updates after opening a shared thread", async ({
  browser,
}) => {
  const owner = await browser.newContext();
  const page = await owner.newPage();
  await mockGeneration(page, "Live shared thread");

  await page.goto("/");
  await expect(page.locator("body")).toContainText(
    "Once upon a time, in Absalom,",
  );
  await waitForCurrentThreadRef(page);
  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toContainText("Live shared thread 1.");
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => referenceFromPageUrl(page)).toMatchObject({
    kind: "thread",
  });
  const threadUrl = page.url();

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await mockGeneration(guestPage, "Guest");
  await guestPage.goto(threadUrl);
  await expect(guestPage.locator("body")).toContainText(
    "Live shared thread 1.",
  );

  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toContainText("Live shared thread 4.");
  await expect(guestPage.locator("body")).toContainText(
    "Live shared thread 4.",
  );

  await owner.close();
  await guest.close();
});

test("a copied thread link after root edit opens the new story loom", async ({
  browser,
}) => {
  const owner = await browser.newContext();
  const page = await owner.newPage();
  await captureClipboard(page);
  await mockGeneration(page, "Root edit share");

  await page.goto("/");
  await expect(page.locator("body")).toContainText(
    "Once upon a time, in Absalom,",
  );
  await waitForCurrentThreadRef(page);
  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toContainText("Root edit share 1.");
  const originalRef = referenceFromPageUrl(page);
  const originalStoryUrl = page.url();
  expect(originalRef?.loomId).toBeTruthy();

  await page.keyboard.press("Backspace");
  await page.locator("textarea").fill("Shared edited opening,");
  await page.getByRole("button", { name: "START" }).click();
  await expect(page.locator("body")).toContainText("Shared edited opening,");
  await expect(page.locator("body")).not.toContainText("Root edit share 1.");
  await expect.poll(() => referenceFromPageUrl(page)?.loomId).not.toBe(
    originalRef?.loomId,
  );

  await openStoriesDrawer(page);
  await page
    .getByRole("button", { name: "Copy current thread link" })
    .first()
    .focus();
  await page.keyboard.press("Enter");

  const threadUrl = await readCapturedClipboard(page);
  expect(threadUrl).toContain("?ref=");

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await mockGeneration(guestPage, "Guest");
  await guestPage.goto(threadUrl);

  await expect(guestPage.locator("body")).toContainText(
    "Shared edited opening,",
  );
  await expect(guestPage.locator("body")).not.toContainText("Root edit share 1.");

  const originalPage = await guest.newPage();
  await mockGeneration(originalPage, "Guest original");
  await originalPage.goto(originalStoryUrl);
  await expect(originalPage.locator("body")).toContainText(
    "Once upon a time, in Absalom,",
  );
  await expect(originalPage.locator("body")).toContainText("Root edit share 1.");
  await expect(originalPage.locator("body")).not.toContainText(
    "Shared edited opening,",
  );
  await owner.close();
  await guest.close();
});

test("editing a node with children creates one revision instead of duplicating it repeatedly", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await mockGeneration(page, "Editable child");

  await page.goto("/");
  await expect(page.locator("body")).toContainText(
    "Once upon a time, in Absalom,",
  );
  await waitForCurrentThreadRef(page);

  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toContainText("Editable child 1.");

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Backspace");
  await page.locator("textarea").fill("Edited child");
  await page.getByRole("button", { name: "START" }).click();

  await expect(page.locator("body")).toContainText("Edited child");
  const threadText = await page.locator("body").innerText();
  const editedMatches = threadText.match(/Edited child/g) ?? [];
  expect(editedMatches.length).toBe(1);

  await context.close();
});

test("editing the story root creates a new story without changing the original loom", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await mockGeneration(page, "Editable root");

  await page.goto("/");
  await expect(page.locator("body")).toContainText(
    "Once upon a time, in Absalom,",
  );
  await waitForCurrentThreadRef(page);

  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toContainText("Editable root 1.");
  const originalRef = referenceFromPageUrl(page);
  const originalStoryUrl = page.url();
  expect(originalRef?.loomId).toBeTruthy();

  await page.keyboard.press("Backspace");
  await page.locator("textarea").fill("Edited opening,");
  await page.getByRole("button", { name: "START" }).click();

  await expect(page.locator("body")).toContainText("Edited opening,");
  await expect(page.locator("body")).not.toContainText("Editable root 1.");
  await expect.poll(() => referenceFromPageUrl(page)?.loomId).not.toBe(
    originalRef?.loomId,
  );

  const threadText = await page.locator("body").innerText();
  const editedMatches = threadText.match(/Edited opening,/g) ?? [];
  expect(editedMatches.length).toBe(1);

  const originalPage = await context.newPage();
  await mockGeneration(originalPage, "Original root");
  await originalPage.goto(originalStoryUrl);
  await expect(originalPage.locator("body")).toContainText(
    "Once upon a time, in Absalom,",
  );
  await expect(originalPage.locator("body")).toContainText("Editable root 1.");
  await expect(originalPage.locator("body")).not.toContainText("Edited opening,");

  await context.close();
});

test("lore-backed story edits survive a browser reload", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await mockGeneration(page, "Reload persistence");

  await page.goto("/");
  await expect(page.locator("body")).toContainText(
    "Once upon a time, in Absalom,",
  );
  await waitForCurrentThreadRef(page);

  await page.keyboard.press("Backspace");
  await page.locator("textarea").fill("Reloaded edited opening,");
  await page.getByRole("button", { name: "START" }).click();
  await expect(page.locator("body")).toContainText(
    "Reloaded edited opening,",
  );
  await expect(page.locator("body")).not.toContainText(
    "Once upon a time, in Absalom,",
  );

  const editedStoryUrl = page.url();
  const editedRef = referenceFromPageUrl(page);
  expect(editedRef?.kind).toBe("thread");
  expect(editedRef?.loomId).toBeTruthy();
  expect(editedRef?.turnId).toBeTruthy();

  await page.reload();

  await expect(page).toHaveURL(editedStoryUrl);
  await expect(page.locator("body")).toContainText(
    "Reloaded edited opening,",
  );
  await expect(page.locator("body")).not.toContainText(
    "Once upon a time, in Absalom,",
  );
  await expect.poll(() => referenceFromPageUrl(page)).toMatchObject(editedRef);

  await openStoriesDrawer(page);
  await expect(page.locator("body")).toContainText("Story 1");

  await context.close();
});

test("generating after a root edit branches from the new story only", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await mockGeneration(page, "Root regen");

  await page.goto("/");
  await expect(page.locator("body")).toContainText(
    "Once upon a time, in Absalom,",
  );
  await waitForCurrentThreadRef(page);

  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toContainText("Root regen 1.");

  await page.keyboard.press("Backspace");
  await page.locator("textarea").fill("Regenerated opening,");
  await page.getByRole("button", { name: "START" }).click();
  await expect(page.locator("body")).toContainText("Regenerated opening,");
  await expect(page.locator("body")).not.toContainText("Root regen 1.");

  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toContainText("Root regen 4.");

  await page.keyboard.press("ArrowRight");
  await expect(page.locator("body")).toContainText("Root regen 5.");

  await page.keyboard.press("ArrowRight");
  await expect(page.locator("body")).toContainText("Root regen 6.");

  await context.close();
});
