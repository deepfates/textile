import { Buffer } from "node:buffer";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createMemoryEventStore } from "@deepfates/lync/memory-log";
import { createLyncLooms } from "@deepfates/lync/looms";

// Build a SYNTHETIC conversation-loom snapshot file (splice's session→loom
// adapter shape: turns carry payload.message + payload.text, meta.role/author),
// written to a temp JSON file so the keyboard "Import conversation" picker can
// pick it. All synthetic — no real session content.
async function writeSyntheticConversationFile(opts: {
  title: string;
  seed: string;
  reply: string;
  model?: string;
}): Promise<string> {
  const model = opts.model ?? "claude-synthetic-e2e";
  const store = createMemoryEventStore();
  let n = 0;
  const looms = createLyncLooms<
    { message: unknown; text: string },
    { profile: "conversation"; source: string; title: string },
    { role: string; author: string }
  >({
    store,
    author: { actor: "splice/claude-session-import@0.1" },
    createId: () => `e2e-conv-${++n}`,
    now: () => 3000 + n,
  });
  const info = await looms.create({
    profile: "conversation",
    source: "claude-session",
    title: opts.title,
  });
  const loom = await looms.open(info.id);
  const q = await loom.appendTurn(
    null,
    { message: { role: "user", content: opts.seed }, text: opts.seed },
    { role: "user", author: "deepfates" },
  );
  await loom.appendTurn(
    q.id,
    {
      message: { role: "assistant", model, content: [{ type: "text", text: opts.reply }] },
      text: opts.reply,
    },
    { role: "assistant", author: model },
  );
  const snapshot = await loom.export();
  loom.close();
  const dir = mkdtempSync(join(tmpdir(), "textile-conv-"));
  const file = join(dir, "conversation.json");
  writeFileSync(file, JSON.stringify(snapshot), "utf8");
  return file;
}

// Drive the keyboard from the loom view to the Stories-drawer "Import
// conversation" action (row 1, column 1) without touching the mouse.
async function focusImportConversationByKeyboard(page: Page) {
  await page.keyboard.press("`");
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".mode-bar-title")).toHaveText("TABS");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Stories" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Enter"); // drop into rows (row 0: Sort)
  await expect(page.locator(".navbar-minibuffer")).toContainText("Sort");
  await page.keyboard.press("ArrowDown"); // row 1: + New Story
  await expect(page.locator(".navbar-minibuffer")).toContainText("+ New Story");
  await page.keyboard.press("ArrowRight"); // row 1, column 1: Import conversation
  await expect(page.locator(".navbar-minibuffer")).toContainText(
    "Import conversation",
  );
}

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

// Capture export downloads at the source: the app builds each export as a Blob
// and hands it to URL.createObjectURL, so stash those Blobs to read their exact
// bytes later. Mirrors captureClipboard; survives reloads (init scripts re-run).
async function captureDownloads(page: Page) {
  await page.addInitScript(() => {
    window.__textileDownloads = [];
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (obj: Blob | MediaSource) => {
      if (obj instanceof Blob) window.__textileDownloads.push(obj);
      return original(obj);
    };
  });
}


// After a generation, wait for it to fully settle before the next input. Each
// appended turn re-renders the tree progressively (loom.subscribe fires per
// turn-added), so a keypress issued too early runs against a stale, partially
// built tree captured in the keyboard handler's React closure — bonking sibling
// navigation or editing the wrong node under load. The loading dots are driven
// by generatingInfo, which is only cleared after the whole batch is committed to
// the tree, so waiting for them to disappear pins the tree to its final shape.
async function waitForGenerationSettled(page: Page) {
  await expect(page.locator(".navigation-dot.loading")).toHaveCount(0);
}

// Press ArrowDown to move the loom cursor one level deeper, and wait for the
// descent to actually land before doing anything else. The keyboard handler
// reads currentDepth from a React closure, so a keypress fired before the depth
// change has re-rendered would act on the stale (shallower) node — under load
// this makes a following Enter generate a hidden sibling of the root, or a
// Backspace edit the wrong node. Descending onto a leaf clears the cursor node
// (there is no deeper segment yet), which deterministically signals the depth
// change committed and the handler closure refreshed.
async function descendToLeaf(page: Page) {
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".cursor-node")).toHaveCount(0);
}

async function readCapturedClipboard(page: Page) {
  return page.evaluate(() => window.__textileClipboardText);
}

function referenceFromPageUrl(page: Page) {
  return referenceFromUrl(page.url());
}

function referenceFromUrl(url: string) {
  const encoded = new URL(url).searchParams.get("ref");
  if (!encoded) return null;
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
    kind: string;
    loomId?: string;
    turnId?: string;
  };
}

async function waitForStoryIndex(page: Page) {
  await expect.poll(() =>
    page.evaluate(() => window.localStorage.getItem("textile-lync-v1-index-id")),
  ).toBeTruthy();
  await expect(page.locator(".gamepad-main")).toHaveAttribute(
    "data-story-ready",
    "true",
  );
}

declare global {
  interface Window {
    __textileClipboardText: string;
    __textileDownloads: Blob[];
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
  await waitForStoryIndex(pageOne);

  const pageTwo = await context.newPage();
  await mockGeneration(pageTwo, "Same browser sync");
  await pageTwo.goto("/");
  await expect(pageTwo.locator("body")).toContainText(
    "Once upon a time, in Absalom,",
  );
  await waitForStoryIndex(pageTwo);

  await pageOne.keyboard.press("Enter");

  await expect(pageOne.locator("body")).toContainText("Same browser sync 1.");
  await expect(pageTwo.locator("body")).toContainText("Same browser sync 1.");
  await context.close();
});

test("enter from the Stories tab strip drops into rows on the New Story path", async ({
  page,
}) => {
  await mockGeneration(page, "Keyboard story path");
  await page.goto("/");
  await expect(page.locator("body")).toContainText(
    "Once upon a time, in Absalom,",
  );

  await page.keyboard.press("`");
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".mode-bar-title")).toHaveText("TABS");
  await expect(page.locator(".mode-bar-hint")).toContainText("↵/↓: ROWS");

  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Stories" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".navbar-minibuffer")).toContainText("tabs");

  await page.keyboard.press("Enter");
  await expect(page.locator(".mode-bar-title")).toHaveText("STORIES");
  await expect(page.locator(".navbar-minibuffer")).toContainText("Sort");

  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".navbar-minibuffer")).toContainText("+ New Story");
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
  await waitForStoryIndex(page);
  expect(referenceFromPageUrl(page)).toBeNull();

  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toContainText("Fresh storage 1.");

  await context.close();
});

test("fresh load, story navigation, and story switching keep a clean local URL", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await captureClipboard(page);
  await mockGeneration(page, "Clean URL");

  await page.goto("/");
  await expect(page.locator("body")).toContainText(
    "Once upon a time, in Absalom,",
  );
  await waitForStoryIndex(page);
  await expect(page).toHaveURL(/\/$/);
  expect(referenceFromPageUrl(page)).toBeNull();

  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toContainText("Clean URL 1.");
  await waitForGenerationSettled(page);
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("body")).toContainText("Clean URL 2.");
  await expect(page).toHaveURL(/\/$/);
  expect(referenceFromPageUrl(page)).toBeNull();

  await openStoriesDrawer(page);
  await page.getByRole("button", { name: /New Story/ }).click();
  await expect(page.locator("body")).toContainText(
    "Once upon a time, in Absalom,",
  );
  await expect(page).toHaveURL(/\/$/);
  expect(referenceFromPageUrl(page)).toBeNull();

  await openStoriesDrawer(page);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toContainText("Clean URL 1.");
  await expect(page).toHaveURL(/\/$/);
  expect(referenceFromPageUrl(page)).toBeNull();

  await openStoriesDrawer(page);
  await page
    .getByRole("button", { name: "Thread link" })
    .first()
    .focus();
  await page.keyboard.press("Enter");
  const threadUrl = await readCapturedClipboard(page);
  expect(referenceFromUrl(threadUrl)).toMatchObject({ kind: "thread" });
  await page.keyboard.press("Escape");

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
  await waitForStoryIndex(page);
  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toContainText("Shared root 1.");
  await openStoriesDrawer(page);
  await page
    .getByRole("button", { name: "Story link" })
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
  await waitForStoryIndex(page);
  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toContainText("Shared index 1.");
  await openStoriesDrawer(page);
  await page.getByRole("button", { name: "Index link" }).focus();
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
  await waitForStoryIndex(page);
  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toContainText("Shared thread 1.");
  await waitForGenerationSettled(page);
  await descendToLeaf(page);
  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toContainText("Shared thread 4.");

  await openStoriesDrawer(page);
  await page
    .getByRole("button", { name: "Thread link" })
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
  await captureClipboard(page);
  await mockGeneration(page, "Live shared thread");

  await page.goto("/");
  await expect(page.locator("body")).toContainText(
    "Once upon a time, in Absalom,",
  );
  await waitForStoryIndex(page);
  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toContainText("Live shared thread 1.");
  await waitForGenerationSettled(page);
  await page.keyboard.press("ArrowDown");
  await openStoriesDrawer(page);
  await page
    .getByRole("button", { name: "Thread link" })
    .first()
    .focus();
  await page.keyboard.press("Enter");
  const threadUrl = await readCapturedClipboard(page);
  expect(referenceFromUrl(threadUrl)).toMatchObject({ kind: "thread" });

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await mockGeneration(guestPage, "Guest");
  await guestPage.goto(threadUrl);
  await expect(guestPage.locator("body")).toContainText(
    "Live shared thread 1.",
  );

  // Close the owner's Stories drawer so Enter drives generation on the loom
  // instead of being swallowed by drawer navigation.
  await page.keyboard.press("Escape");
  await expect(page.locator(".menu-content")).toHaveCount(0);

  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toContainText("Live shared thread 4.");
  await expect(guestPage.locator("body")).toContainText(
    "Live shared thread 4.",
  );

  await owner.close();
  await guest.close();
});

// Native semantics (see storyLoom.test.ts "projects root revisions without
// dropping generated children"): a root edit revises the seed IN PLACE within
// the same loom, keeping the existing continuations. It does NOT fork a new
// loom, so a thread link copied afterwards still resolves to the same loom now
// carrying the revised seed text.
test("a copied thread link after a root edit reopens the same edited loom", async ({
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
  await waitForStoryIndex(page);
  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toContainText("Root edit share 1.");
  await openStoriesDrawer(page);
  await page
    .getByRole("button", { name: "Story link" })
    .first()
    .focus();
  await page.keyboard.press("Enter");
  const originalStoryUrl = await readCapturedClipboard(page);
  const originalRef = referenceFromUrl(originalStoryUrl);
  expect(originalRef?.loomId).toBeTruthy();
  await page.keyboard.press("Escape");
  await expect(page.locator(".menu-content")).toHaveCount(0);

  await page.keyboard.press("Backspace");
  await page.locator("textarea").fill("Shared edited opening,");
  await page.getByRole("button", { name: "START" }).click();
  await expect(page.locator(".edit-textarea")).toHaveCount(0);
  await expect(page.locator("body")).toContainText("Shared edited opening,");
  // The revision replaces the visible seed text within the same loom.
  await expect(page.locator("body")).not.toContainText(
    "Once upon a time, in Absalom,",
  );

  await openStoriesDrawer(page);
  await page
    .getByRole("button", { name: "Thread link" })
    .first()
    .focus();
  await page.keyboard.press("Enter");

  const threadUrl = await readCapturedClipboard(page);
  expect(threadUrl).toContain("?ref=");
  // Same loom, not a forked one.
  expect(referenceFromUrl(threadUrl)?.loomId).toBe(originalRef?.loomId);

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await mockGeneration(guestPage, "Guest");
  await guestPage.goto(threadUrl);

  await expect(guestPage.locator("body")).toContainText(
    "Shared edited opening,",
  );
  await expect(guestPage.locator("body")).not.toContainText(
    "Once upon a time, in Absalom,",
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
  await waitForStoryIndex(page);

  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toContainText("Editable child 1.");

  await waitForGenerationSettled(page);
  await descendToLeaf(page);
  await page.keyboard.press("Backspace");
  await page.locator("textarea").fill("Edited child");
  await page.getByRole("button", { name: "START" }).click();

  // Wait for the edit to commit and the overlay to close so we count the
  // rendered thread text, not the still-open EDIT textarea (whose value
  // toContainText would otherwise match while innerText ignores it).
  await expect(page.locator(".edit-textarea")).toHaveCount(0);
  await expect(page.locator("body")).toContainText("Edited child");
  const threadText = await page.locator("body").innerText();
  const editedMatches = threadText.match(/Edited child/g) ?? [];
  expect(editedMatches.length).toBe(1);

  await context.close();
});

// Native semantics: editing the root revises the seed IN PLACE within the same
// loom (no fork). The revised text replaces the visible seed and reopening the
// same story link shows the revision, while the existing continuation is kept.
test("editing the story root revises the seed in place within the same loom", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await captureClipboard(page);
  await mockGeneration(page, "Editable root");

  await page.goto("/");
  await expect(page.locator("body")).toContainText(
    "Once upon a time, in Absalom,",
  );
  await waitForStoryIndex(page);

  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toContainText("Editable root 1.");
  await openStoriesDrawer(page);
  await page
    .getByRole("button", { name: "Story link" })
    .first()
    .focus();
  await page.keyboard.press("Enter");
  const originalStoryUrl = await readCapturedClipboard(page);
  const originalRef = referenceFromUrl(originalStoryUrl);
  expect(originalRef?.loomId).toBeTruthy();
  await page.keyboard.press("Escape");
  await expect(page.locator(".menu-content")).toHaveCount(0);

  await page.keyboard.press("Backspace");
  await page.locator("textarea").fill("Edited opening,");
  await page.getByRole("button", { name: "START" }).click();
  await expect(page.locator(".edit-textarea")).toHaveCount(0);

  await expect(page.locator("body")).toContainText("Edited opening,");
  // The revision replaces the visible seed text; the generated child is kept.
  await expect(page.locator("body")).not.toContainText(
    "Once upon a time, in Absalom,",
  );
  await expect(page.locator("body")).toContainText("Editable root 1.");
  expect(referenceFromPageUrl(page)).toBeNull();

  const threadText = await page.locator("body").innerText();
  const editedMatches = threadText.match(/Edited opening,/g) ?? [];
  expect(editedMatches.length).toBe(1);

  // Reopening the SAME story link shows the in-place revision, not the seed.
  const reopened = await context.newPage();
  await mockGeneration(reopened, "Reopened root");
  await reopened.goto(originalStoryUrl);
  await expect(reopened.locator("body")).toContainText("Edited opening,");
  await expect(reopened.locator("body")).not.toContainText(
    "Once upon a time, in Absalom,",
  );
  expect(referenceFromUrl(originalStoryUrl)?.loomId).toBe(originalRef?.loomId);

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
  await waitForStoryIndex(page);

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
  expect(referenceFromPageUrl(page)).toBeNull();

  await page.reload();

  await expect(page).toHaveURL(editedStoryUrl);
  await expect(page.locator("body")).toContainText(
    "Reloaded edited opening,",
  );
  await expect(page.locator("body")).not.toContainText(
    "Once upon a time, in Absalom,",
  );
  expect(referenceFromPageUrl(page)).toBeNull();

  await openStoriesDrawer(page);
  await expect(page.locator("body")).toContainText("Story 1");

  await context.close();
});

// Native semantics: a root edit revises the seed in place and KEEPS the
// existing continuation; generating again adds fresh siblings under the same
// (revised) root and navigates onto the new branch.
test("generating after a root edit continues from the revised root", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await mockGeneration(page, "Root regen");

  await page.goto("/");
  await expect(page.locator("body")).toContainText(
    "Once upon a time, in Absalom,",
  );
  await waitForStoryIndex(page);

  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toContainText("Root regen 1.");
  await waitForGenerationSettled(page);

  await page.keyboard.press("Backspace");
  await page.locator("textarea").fill("Regenerated opening,");
  await page.getByRole("button", { name: "START" }).click();
  await expect(page.locator(".edit-textarea")).toHaveCount(0);
  await expect(page.locator("body")).toContainText("Regenerated opening,");
  // The revision replaces the visible seed but keeps the generated child.
  await expect(page.locator("body")).not.toContainText(
    "Once upon a time, in Absalom,",
  );
  // The kept continuation sits one level below the (revised) root, so it is the
  // cursor node while we are at depth 0.
  await expect(page.locator(".cursor-node")).toHaveText("Root regen 1.");

  // Descend into the kept continuation and generate from it — the new branch
  // grows under the revised root (a fresh numbered turn), not a forked story.
  await descendToLeaf(page);
  await page.keyboard.press("Enter");
  await expect(page.locator(".cursor-node")).toHaveText("Root regen 4.");

  await context.close();
});

// ---------------------------------------------------------------------------
// Two-way co-authoring convergence proof.
//
// The existing multiplayer test above ("separate browser contexts converge on
// live updates after opening a shared thread") is ONE-DIRECTIONAL: the owner
// writes and the guest reads. This test proves the shared loom is genuinely
// TWO-WAY — two independent browser contexts, each a distinct author, BOTH
// append turns to ONE shared loom, and the honest replayable scene converges:
//   * no turn is lost (both authors' concurrent turns survive union-by-id),
//   * both contexts converge to the SAME tree (identical node-id set), and
//   * every turn carries honest per-turn authorship — origin (human vs model)
//     and the PERSON's actor are correct in BOTH contexts, so the guest never
//     sees the owner's turn as its own (never a false "you") and vice versa.
// The lync sync is REAL (against the dev relay); only model generation is
// mocked, so the numbered turn text is deterministic per author.

// Bind a browser context to a named human author BEFORE the app boots. lync
// captures the author at client construction, reading this localStorage key
// (see storyRuntime AUTHOR_NAME_STORAGE_KEY); setting it in an init script
// guarantees every turn this context writes is stamped with the person.
async function setAuthorName(page: Page, name: string) {
  await page.addInitScript((authorName) => {
    window.localStorage.setItem("textile-lync-v1-author-name", authorName);
  }, name);
}

interface AuthoredNode {
  nodeId: string | null;
  origin: string | null;
  actor: string | null;
  via: string | null;
  text: string;
}

// Read the current reading-column path with per-turn authorship straight from
// the DOM. `data-origin`/`data-actor`/`data-via` are the machine-legible
// authorship attributes the prose spans carry, so an outside checker reads who
// authored each visible turn without opening the store.
async function readAuthoredPath(page: Page): Promise<AuthoredNode[]> {
  return page.evaluate(() => {
    const spans = Array.from(
      document.querySelectorAll(".story-text [data-origin]"),
    );
    return spans.map((el) => ({
      nodeId:
        el.closest("[data-node-id]")?.getAttribute("data-node-id") ?? null,
      origin: el.getAttribute("data-origin"),
      actor: el.getAttribute("data-actor"),
      via: el.getAttribute("data-via"),
      text: (el.textContent ?? "").trim(),
    }));
  });
}

// The deepest turn on the current path (the selected frontier turn).
async function frontierNode(page: Page): Promise<AuthoredNode | undefined> {
  const path = await readAuthoredPath(page);
  return path.at(-1);
}

async function toRootDepth(page: Page) {
  // ArrowUp walks the cursor toward the root; it clamps at depth 0.
  for (let i = 0; i < 4; i += 1) await page.keyboard.press("ArrowUp");
}

// Enumerate every child of the root with its authorship. At depth 0 the
// navigation dots ARE the root's children (getOptionsAtDepth(0) === root
// continuations); each dot is one child, and ArrowLeft/ArrowRight moves the
// selected child onto the reading path, where readAuthoredPath can read its
// origin/actor. Returns one entry per root child.
async function collectRootChildren(page: Page): Promise<AuthoredNode[]> {
  await toRootDepth(page);
  const dots = page.locator(".navigation-dots .navigation-dot:not(.loading)");
  await expect.poll(async () => dots.count()).toBeGreaterThan(0);
  const count = await dots.count();
  // Move to the leftmost sibling (ArrowLeft clamps at index 0).
  for (let i = 0; i < count; i += 1) await page.keyboard.press("ArrowLeft");
  const nodes: AuthoredNode[] = [];
  for (let i = 0; i < count; i += 1) {
    const node = await frontierNode(page);
    if (node) nodes.push(node);
    if (i < count - 1) {
      const before = node?.nodeId;
      await page.keyboard.press("ArrowRight");
      // Wait for the sibling swap to re-render before reading the next one.
      await expect
        .poll(async () => (await frontierNode(page))?.nodeId)
        .not.toBe(before);
    }
  }
  return nodes;
}

test("two independent authors co-write one shared loom and converge with honest per-turn authorship", async ({
  browser,
}) => {
  // --- Owner "Ada": seed a story and generate three continuations. ----------
  const owner = await browser.newContext();
  const adaPage = await owner.newPage();
  await setAuthorName(adaPage, "Ada");
  await captureClipboard(adaPage);
  await mockGeneration(adaPage, "Ada writes");

  await adaPage.goto("/");
  await expect(adaPage.locator("body")).toContainText(
    "Once upon a time, in Absalom,",
  );
  await waitForStoryIndex(adaPage);

  await adaPage.keyboard.press("Enter");
  await expect(adaPage.locator("body")).toContainText(/Ada writes \d\./);
  await waitForGenerationSettled(adaPage);

  // Share the whole loom so the guest opens the SAME loom (not a copy).
  await openStoriesDrawer(adaPage);
  await adaPage.getByRole("button", { name: "Story link" }).first().focus();
  await adaPage.keyboard.press("Enter");
  const storyUrl = await readCapturedClipboard(adaPage);
  const sharedRef = referenceFromUrl(storyUrl);
  expect(sharedRef?.loomId).toBeTruthy();
  await adaPage.keyboard.press("Escape");
  await expect(adaPage.locator(".menu-content")).toHaveCount(0);

  // --- Guest "Grace": open the shared loom; converge on Ada's turns. --------
  const guest = await browser.newContext();
  const gracePage = await guest.newPage();
  await setAuthorName(gracePage, "Grace");
  await mockGeneration(gracePage, "Grace writes");
  await gracePage.goto(storyUrl);
  await expect(gracePage.locator("body")).toContainText(
    "Once upon a time, in Absalom,",
  );
  await expect(gracePage.locator("body")).toContainText(/Ada writes \d\./);

  // Both contexts start from the SAME three-child state before co-authoring.
  expect(await collectRootChildren(adaPage)).toHaveLength(3);
  expect(await collectRootChildren(gracePage)).toHaveLength(3);

  // --- The two-way beat: BOTH authors append CONCURRENTLY to the root. ------
  // Root already has children, so each Enter appends exactly one turn. The two
  // appends race through the REAL relay; union-by-id must keep both.
  await toRootDepth(adaPage);
  await toRootDepth(gracePage);
  await Promise.all([
    adaPage.keyboard.press("Enter"),
    gracePage.keyboard.press("Enter"),
  ]);
  await waitForGenerationSettled(adaPage);
  await waitForGenerationSettled(gracePage);

  // --- Convergence: no turn lost; both converge to the SAME five-turn tree. -
  const adaChildren = await collectRootChildren(adaPage);
  const graceChildren = await collectRootChildren(gracePage);

  // Ada's four turns (three initial + one concurrent) plus Grace's one turn.
  expect(adaChildren).toHaveLength(5);
  expect(graceChildren).toHaveLength(5);

  // Same tree via union-by-id: identical set of node ids in both contexts.
  const idSet = (nodes: AuthoredNode[]) =>
    new Set(nodes.map((n) => n.nodeId));
  const adaIds = idSet(adaChildren);
  const graceIds = idSet(graceChildren);
  expect(adaIds.size).toBe(5);
  expect([...adaIds].sort()).toEqual([...graceIds].sort());

  // --- Honest per-turn authorship in BOTH contexts. -------------------------
  // Every co-authored root child is a model turn stamped with the PERSON who
  // ran it. Ada authored four; Grace authored one. This holds identically in
  // each context — so Ada's context reads Grace's turn as Grace's (not a false
  // "you"), and Grace's context reads Ada's four as Ada's.
  for (const [label, children] of [
    ["ada-context", adaChildren],
    ["grace-context", graceChildren],
  ] as const) {
    const byAda = children.filter((n) => n.actor === "Ada");
    const byGrace = children.filter((n) => n.actor === "Grace");
    expect(byAda, label).toHaveLength(4);
    expect(byGrace, label).toHaveLength(1);
    for (const node of children) {
      expect(node.origin, `${label} origin`).toBe("model");
      expect(node.via, `${label} via`).toBe("textile-browser");
    }
    expect(byAda.map((n) => n.text).sort()).toEqual([
      "Ada writes 1.",
      "Ada writes 2.",
      "Ada writes 3.",
      "Ada writes 4.",
    ]);
    expect(byGrace.map((n) => n.text)).toEqual(["Grace writes 1."]);
  }

  // --- The human seed is honestly Ada's in BOTH contexts. -------------------
  // Origin human vs model is real (the seed is human; the continuations are
  // model), and the guest sees the seed authored by Ada, never falsely "you".
  for (const page of [adaPage, gracePage]) {
    await toRootDepth(page);
    const path = await readAuthoredPath(page);
    const seed = path.find((n) => n.text.includes("Once upon a time"));
    expect(seed?.origin).toBe("human");
    expect(seed?.actor).toBe("Ada");
    expect(seed?.via).toBe("textile-browser");
  }

  await owner.close();
  await guest.close();
});

test("keyboard-reachable Import conversation opens a synthetic conversation loom", async ({
  page,
}) => {
  await mockGeneration(page, "Keyboard import");
  await page.goto("/");
  await expect(page.locator("body")).toContainText(
    "Once upon a time, in Absalom,",
  );
  await waitForStoryIndex(page);

  const file = await writeSyntheticConversationFile({
    title: "Synthetic Keyboard Chat",
    seed: "Reached by keyboard alone?",
    reply: "Yes — d-pad to Import, Enter opens the picker.",
  });

  // Navigate to the Import action with the d-pad only (no mouse), then Enter
  // opens the OS file picker — proving the action is keyboard-reachable.
  await focusImportConversationByKeyboard(page);
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.keyboard.press("Enter"),
  ]);
  await chooser.setFiles(file);

  // The import lands: the notice reports it (NOTHING-SILENT) and the loom is
  // selected.
  await expect(page.locator(".navbar-minibuffer")).toContainText(
    'Imported "Synthetic Keyboard Chat"',
  );

  // Close the drawer and confirm the conversation opened + renders its turns.
  await page.keyboard.press("Escape");
  await expect(page.locator("body")).toContainText("Reached by keyboard alone?");
});

test("a shared conversation ?ref= link opens the conversation in another context", async ({
  browser,
}) => {
  const owner = await browser.newContext();
  const page = await owner.newPage();
  await captureClipboard(page);
  await mockGeneration(page, "Conv share");

  await page.goto("/");
  await expect(page.locator("body")).toContainText(
    "Once upon a time, in Absalom,",
  );
  await waitForStoryIndex(page);

  const file = await writeSyntheticConversationFile({
    title: "Shared Conversation",
    seed: "Does a conversation share by URL?",
    reply: "It opens like a story link now.",
  });

  // Import a conversation via the keyboard picker so it lives in the running app.
  await focusImportConversationByKeyboard(page);
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.keyboard.press("Enter"),
  ]);
  await chooser.setFiles(file);
  await expect(page.locator(".navbar-minibuffer")).toContainText(
    'Imported "Shared Conversation"',
  );

  // Build the CONVERSATION's own share URL with the same app code the "Story
  // link" action uses (createStoryShareUrl → referenceToUrl), targeting the
  // conversation entry specifically (not the default lore story).
  await page.keyboard.press("Escape");
  const convUrl = await page.evaluate(async () => {
    const mod = await import("/client/interface/lync/storyRuntime.ts");
    const entries = await mod.listStoryEntries();
    const conv = entries.find(
      (e: { kind?: string }) => e.kind === "conversation",
    );
    if (!conv) throw new Error("conversation not registered in the index");
    return mod.createStoryShareUrl(conv.ref.loomId) as string;
  });
  expect(convUrl).toContain("?ref=");
  // Sanity: the shared ref points at the conversation, not a story loom.
  expect(referenceFromUrl(convUrl)?.kind).toBe("loom");

  // A fresh context opening that URL sees the conversation (the widened guard in
  // importStoryReferenceFromUrl opens it instead of throwing).
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await mockGeneration(guestPage, "Guest conv");
  await guestPage.goto(convUrl);
  await expect(guestPage.locator("body")).toContainText(
    "Does a conversation share by URL?",
  );
  // And it is registered as a conversation in the guest, not a story.
  const guestKind = await guestPage.evaluate(async (loomId) => {
    const mod = await import("/client/interface/lync/storyRuntime.ts");
    const entries = await mod.listStoryEntries();
    return entries.find(
      (e: { ref: { loomId: string } }) => e.ref.loomId === loomId,
    )?.kind;
  }, referenceFromUrl(convUrl)?.loomId ?? "");
  expect(guestKind).toBe("conversation");

  await owner.close();
  await guest.close();
});

// The archive-instrument curation loop (dee-arch annotate-half): KEEP the
// current turn with the keyboard, ANNOTATE it, reload — both re-render from the
// loom's own event log, not memory — then EXPORT KEPT emits exactly that turn
// plus its note. All synthetic.
test("keyboard KEEP + ANNOTATE persist across reload and Export KEPT emits the kept set", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await mockGeneration(page, "Curate");
  await captureDownloads(page);

  await page.goto("/");
  await expect(page.locator("body")).toContainText(
    "Once upon a time, in Absalom,",
  );
  await waitForStoryIndex(page);

  // KEEP the current (focused) turn — a mark event on the loom. Its kept state
  // is narrated for the FOCUSED turn in the status strip, not stuck on the
  // reading column.
  await page.keyboard.press("k");
  await expect(page.locator(".navbar-minibuffer")).toContainText(
    "Kept this turn",
  );
  await expect(page.locator(".story-curation-status__kept")).toBeVisible();

  // ANNOTATE it — prompt-driven note, persisted as an annotation event, shown
  // for the focused turn in the same status line.
  page.once("dialog", (dialog) => dialog.accept("training-worthy seed"));
  await page.keyboard.press("n");
  await expect(page.locator(".navbar-minibuffer")).toContainText("Note saved");
  await expect(page.locator(".story-curation-status__note")).toContainText(
    "training-worthy seed",
  );

  // Reload: BOTH the kept state and the note re-render from the event log for
  // the focused turn (not from memory).
  await page.reload();
  await expect(page.locator(".story-curation-status__kept")).toBeVisible();
  await expect(page.locator(".story-curation-status__note")).toContainText(
    "training-worthy seed",
  );

  // EXPORT KEPT: the curated file carries only the kept turn + its annotation.
  // On the desktop viewport the secondary actions render inline (the mobile
  // "More" disclosure is hidden), so the button is directly clickable.
  await openStoriesDrawer(page);
  const exportButton = page.getByRole("button", { name: "Export KEPT" }).first();
  await expect(exportButton).toBeVisible();
  // Click the rendered Export KEPT button and read the exact bytes it hands to
  // the download path. (A direct element click sidesteps a coordinate artifact
  // in the automation harness; it exercises the same onClick → export path.)
  const exportText = await page.evaluate(async () => {
    const button = [...document.querySelectorAll("button")].find(
      (candidate) =>
        (candidate.getAttribute("aria-label") ?? "") === "Export KEPT",
    );
    if (!button) return null;
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const blob = window.__textileDownloads.at(-1);
    return blob ? await blob.text() : null;
  });
  expect(exportText).not.toBeNull();
  const payload = JSON.parse(exportText ?? "{}") as {
    kind: string;
    kept: { text: string; annotations: { text: string }[] }[];
  };
  expect(payload.kind).toBe("curated");
  expect(payload.kept).toHaveLength(1);
  expect(payload.kept[0].text).toBe("Once upon a time, in Absalom,");
  expect(payload.kept[0].annotations.map((note) => note.text)).toEqual([
    "training-worthy seed",
  ]);

  await context.close();
});
