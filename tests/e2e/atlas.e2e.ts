// SCREEN ATLAS — not assertion tests. This walks every reachable screen of the
// app × every meaningful state (fresh seed, branches, deep path, long text,
// generating, errors, offline, curation, edit overlay, map, every drawer tab,
// model editor, conversation import, share links, all six theme palettes) with
// DETERMINISTIC fixtures (generation is mocked — no live model calls), captures
// a PNG of each at desktop + phone viewports, and writes a JSON sidecar per
// shot so `bun atlas/build-index.ts` can compose the contact sheet.
//
// Run the whole thing with:   bun run atlas
// Shots land in atlas/out/, the sheet at atlas/index.html.
//
// Every capture asserts a state-specific DOM condition FIRST (a blank frame is
// a lie) and then checks the PNG buffer is non-trivial. Failures are loud.
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createMemoryEventStore } from "@deepfates/lync/memory-log";
import { createLyncLooms } from "@deepfates/lync/looms";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = process.env.SHOTS_DIR ?? join(HERE, "..", "..", "atlas", "out");
mkdirSync(SHOTS, { recursive: true });

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 375, height: 812 };

// ---------------------------------------------------------------------------
// Shot bookkeeping: every capture writes <file>.png + <file>.json so the index
// builder needs no knowledge of this spec — the manifest IS the sidecars.
// ---------------------------------------------------------------------------
interface ShotMeta {
  group: string;
  id: string;
  title: string;
  description: string;
  seq: number;
}

async function capture(
  page: Page,
  meta: ShotMeta,
  opts: {
    viewports?: ("desktop" | "mobile")[];
    theme?: string;
    verify?: Locator;
    // Re-establish the wanted state before each viewport's frame — viewport
    // churn can occasionally knock overlay state (e.g. the drawer) loose.
    ensure?: () => Promise<void>;
  } = {},
) {
  const viewports = opts.viewports ?? ["desktop", "mobile"];
  if (opts.verify) await expect(opts.verify).toBeVisible();
  for (const viewport of viewports) {
    await page.setViewportSize(viewport === "desktop" ? DESKTOP : MOBILE);
    await page.waitForTimeout(300);
    if (opts.ensure) await opts.ensure();
    const base = `${String(meta.seq).padStart(2, "0")}-${meta.id}.${viewport}`;
    const path = join(SHOTS, `${base}.png`);
    // A 1280×800 all-white/all-black PNG compresses to ~2-5KB; any real frame
    // of this UI (text + chrome) is far larger. A blank right after a resize
    // is usually a paint race — retry briefly, then fail LOUD (a silent blank
    // in the atlas is a lie).
    let buffer = await page.screenshot({ path });
    for (let retry = 0; retry < 3 && buffer.length < 6_000; retry += 1) {
      await page.waitForTimeout(500);
      buffer = await page.screenshot({ path });
    }
    if (buffer.length < 6_000) {
      throw new Error(
        `Blank-frame: ${base}.png is only ${buffer.length} bytes after retries`,
      );
    }
    writeFileSync(
      join(SHOTS, `${base}.json`),
      JSON.stringify(
        {
          ...meta,
          viewport,
          theme: opts.theme ?? "dark (black-green)",
          file: `${base}.png`,
        },
        null,
        2,
      ),
    );
  }
  await page.setViewportSize(DESKTOP);
  // Viewport churn re-renders the app; the window keydown listener re-attaches
  // between renders and a keypress fired into that gap is silently lost. Give
  // the tree time to settle — and every state-changing press after a capture
  // still goes through pressUntil, which retries until the state visibly moved.
  await page.waitForTimeout(400);
}

// Press a key and verify the app visibly reacted; retry on a swallowed press.
// The keydown listener detaches/re-attaches across re-renders (React effect),
// so a single press is not guaranteed to land — this makes gestures reliable.
async function pressUntil(
  page: Page,
  key: string,
  reacted: () => Promise<boolean>,
  tries = 5,
) {
  for (let i = 0; i < tries; i += 1) {
    await page.keyboard.press(key);
    for (let poll = 0; poll < 10; poll += 1) {
      if (await reacted()) return;
      await page.waitForTimeout(120);
    }
  }
  throw new Error(`pressUntil(${key}): app never reached the expected state`);
}

async function modeIs(page: Page, title: string) {
  return (
    ((await page.locator(".mode-bar-title").textContent()) ?? "").trim() ===
    title
  );
}

// ---------------------------------------------------------------------------
// Driving helpers (proven selectors/waits lifted from lync-story.e2e.ts)
// ---------------------------------------------------------------------------
async function mockGeneration(page: Page, prefix: string, text?: string) {
  let count = 0;
  await page.route("**/api/generate", async (route) => {
    count += 1;
    const content = text ?? ` ${prefix} ${count}, and the path forked again.`;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({ content })}\n\ndata: [DONE]\n\n`,
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

async function boot(
  page: Page,
  opts: {
    prefix?: string;
    genText?: string;
    theme?: { mode: string; paletteLight: string; paletteDark: string };
  } = {},
) {
  await page.addInitScript(
    (prefs) =>
      localStorage.setItem("textile-theme-preferences", JSON.stringify(prefs)),
    opts.theme ?? {
      mode: "dark",
      paletteLight: "theme-light",
      paletteDark: "theme-black-green",
    },
  );
  await mockGeneration(page, opts.prefix ?? "The forest answered", opts.genText);
  await page.goto("/");
  await expect(page.locator("body")).toContainText(
    "Once upon a time, in Absalom,",
  );
  await waitForStoryIndex(page);
}

async function descendToLeaf(page: Page) {
  await pressUntil(
    page,
    "ArrowDown",
    async () => (await page.locator(".cursor-node").count()) === 0,
  );
}

// Grow N levels deep: Enter generates a child, ArrowDown descends onto it.
async function growDeep(page: Page, levels: number) {
  for (let i = 0; i < levels; i += 1) {
    await page.keyboard.press("Enter");
    await settled(page);
    if (i < levels - 1) {
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(150);
    }
  }
}

// Fan N siblings at the current depth (each Enter appends one continuation).
// Verified per press: the sibling dot count must grow, else the press retries.
async function fanSiblings(page: Page, n: number) {
  for (let i = 0; i < n; i += 1) {
    const before = await page.locator(".navigation-dot").count();
    await pressUntil(
      page,
      "Enter",
      async () => (await page.locator(".navigation-dot").count()) > before,
    );
    await settled(page);
  }
}

async function openDrawer(page: Page) {
  await pressUntil(page, "`", async () => !(await modeIs(page, "LOOM")));
}

// Synthetic conversation snapshot (splice's session→loom shape) written to a
// temp file for the keyboard Import picker. All synthetic, no real sessions.
async function writeSyntheticConversationFile(opts: {
  title: string;
  turns: { role: "user" | "assistant"; text: string }[];
}): Promise<string> {
  const store = createMemoryEventStore();
  let n = 0;
  const looms = createLyncLooms<
    { message: unknown; text: string },
    { profile: "conversation"; source: string; title: string },
    { role: string; author: string }
  >({
    store,
    author: { actor: "splice/claude-session-import@0.1" },
    createId: () => `atlas-conv-${++n}`,
    now: () => 3000 + n,
  });
  const info = await looms.create({
    profile: "conversation",
    source: "claude-session",
    title: opts.title,
  });
  const loom = await looms.open(info.id);
  let parent: string | null = null;
  for (const turn of opts.turns) {
    const message =
      turn.role === "user"
        ? { role: "user", content: turn.text }
        : {
            role: "assistant",
            model: "claude-synthetic-atlas",
            content: [{ type: "text", text: turn.text }],
          };
    const appended = await loom.appendTurn(
      parent,
      { message, text: turn.text },
      {
        role: turn.role,
        author: turn.role === "user" ? "deepfates" : "claude-synthetic-atlas",
      },
    );
    parent = appended.id;
  }
  const snapshot = await loom.export();
  loom.close();
  const dir = mkdtempSync(join(tmpdir(), "textile-atlas-conv-"));
  const file = join(dir, "conversation.json");
  writeFileSync(file, JSON.stringify(snapshot), "utf8");
  return file;
}

async function importConversation(page: Page, file: string) {
  // Feed the hidden file input the "Import conversation" action drives —
  // same import path, no OS-picker race.
  await openDrawer(page);
  await page.getByRole("tab", { name: "Stories" }).click();
  await expect(
    page.getByRole("button", { name: "Import conversation" }),
  ).toBeVisible();
  await page.setInputFiles('[data-testid="import-conversation-input"]', file);
}

// ---------------------------------------------------------------------------
// GROUP: loom — the story view and everything that can happen on it
// ---------------------------------------------------------------------------
test("atlas: loom states", async ({ page }) => {
  await boot(page);
  await capture(page, {
    group: "loom",
    id: "loom-fresh-seed",
    title: "Fresh seed",
    description:
      "First boot: the lore seed alone, no branches yet. LOOM mode bar, sibling dots empty.",
    seq: 1,
  });

  // Branches: siblings fanned at the root's child depth (with text splitting
  // on, one Enter can yield a chain, so the dot count is >= the fan count).
  await fanSiblings(page, 3);
  expect(await page.locator(".navigation-dot").count()).toBeGreaterThanOrEqual(3);
  await capture(page, {
    group: "loom",
    id: "loom-branches",
    title: "Branches at one depth",
    description:
      "Three sibling continuations at the same depth — navigation dots show the fan; ◄► walks it.",
    seq: 2,
  });

  // Deep path: descend and keep generating.
  await descendToLeaf(page);
  await growDeep(page, 3);
  await capture(page, {
    group: "loom",
    id: "loom-deep-path",
    title: "Deep path",
    description:
      "Several levels descended into one thread — story column accumulates the chosen path.",
    seq: 3,
  });
});

test("atlas: loom long text", async ({ page }) => {
  const LONG =
    " The caravan pressed on through the salt flats for eleven days, and the chronicler wrote down everything: the color of the brine pools at dawn, the names the drovers gave each dune, the way the youngest guard hummed off-key when the wind rose. None of it seemed important until the map burned, and then every remembered detail became a road." +
    " They rebuilt the route from memory alone, arguing over wells and way-stones, and the argument itself became the map: drawn in the margins of a ration ledger, annotated in three hands, wrong in places that only mattered later.";
  await boot(page, { genText: LONG });
  await fanSiblings(page, 1);
  await descendToLeaf(page);
  await capture(page, {
    group: "loom",
    id: "loom-long-text",
    title: "Long generated text",
    description:
      "A long continuation (text splitting on): prose fills the column and the reader scrolls.",
    seq: 4,
  });
});

test("atlas: loom generating (in flight)", async ({ page }) => {
  await page.addInitScript((prefs) => {
    localStorage.setItem("textile-theme-preferences", JSON.stringify(prefs));
  }, { mode: "dark", paletteLight: "theme-light", paletteDark: "theme-black-green" });
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/generate", async (route) => {
    await gate;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `data: {"content":" The gate finally opened."}\n\ndata: [DONE]\n\n`,
    });
  });
  await page.goto("/");
  await expect(page.locator("body")).toContainText(
    "Once upon a time, in Absalom,",
  );
  await waitForStoryIndex(page);
  await pressUntil(
    page,
    "Enter",
    async () => (await page.locator(".navigation-dot.loading").count()) > 0,
  );
  await capture(page, {
    group: "loom",
    id: "loom-generating",
    title: "Generation in flight",
    description:
      "Mid-generation: the loading navigation dot pulses while the model streams. Captured with the mock held open.",
    seq: 5,
  });
  release();
  await settled(page);
});

test("atlas: loom error and empty-generation states", async ({ page }) => {
  await page.addInitScript((prefs) => {
    localStorage.setItem("textile-theme-preferences", JSON.stringify(prefs));
  }, { mode: "dark", paletteLight: "theme-light", paletteDark: "theme-black-green" });
  // First response: HTTP 500 → loud error in the navigation bar.
  let mode: "error" | "empty" = "error";
  await page.route("**/api/generate", async (route) => {
    if (mode === "error") {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "model backend exploded (atlas fixture)" }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: `data: {"content":""}\n\ndata: [DONE]\n\n`,
      });
    }
  });
  await page.goto("/");
  await expect(page.locator("body")).toContainText(
    "Once upon a time, in Absalom,",
  );
  await waitForStoryIndex(page);

  await pressUntil(
    page,
    "Enter",
    async () => (await page.locator(".navigation-bar .text-red-500").count()) > 0,
  );
  await capture(page, {
    group: "loom",
    id: "loom-generation-error",
    title: "Generation error",
    description:
      "The /api/generate call failed (HTTP 500): the error message lands in the navigation bar, red, aria-live.",
    seq: 6,
    // error text renders in the navigation bar
  }, { verify: page.locator(".navigation-bar .text-red-500") });

  // Fresh page state for the second failure mode (the 500 above can leave the
  // generation machinery mid-flight; the route mock survives the reload).
  mode = "empty";
  await page.reload();
  await expect(page.locator("body")).toContainText(
    "Once upon a time, in Absalom,",
  );
  await waitForStoryIndex(page);
  await pressUntil(
    page,
    "Enter",
    async () => (await page.locator(".navbar-minibuffer").count()) > 0,
  );
  await capture(page, {
    group: "loom",
    id: "loom-empty-generation",
    title: "Empty generation notice",
    description:
      "The model returned zero content: the empty-generation notice explains instead of silently doing nothing.",
    seq: 7,
  });
});

test("atlas: loom offline", async ({ page, context }) => {
  await boot(page);
  await context.setOffline(true);
  await pressUntil(
    page,
    "Enter",
    async () => (await page.locator(".navigation-bar .text-red-500").count()) > 0,
  );
  await capture(page, {
    group: "loom",
    id: "loom-offline",
    title: "Offline generation attempt",
    description:
      "Generating while offline: the offline error is shown rather than a silent hang.",
    seq: 8,
  });
  await context.setOffline(false);
});

// ---------------------------------------------------------------------------
// GROUP: curation — keep marks and annotations on the focused turn
// ---------------------------------------------------------------------------
test("atlas: curation states", async ({ page }) => {
  await boot(page, { prefix: "A turn worth keeping" });
  await pressUntil(
    page,
    "k",
    async () => (await page.locator(".story-curation-status__kept").count()) > 0,
  );
  await capture(page, {
    group: "curation",
    id: "curation-kept",
    title: "Turn KEPT",
    description:
      "Pressed K on the focused turn: quiet 'kept' chip in the status strip (state of FOCUS, not a badge on every turn).",
    seq: 9,
  });

  // page.on (not once): pressUntil may retry a swallowed press, and every
  // prompt needs answering.
  page.on("dialog", (dialog) => {
    void dialog.accept("training-worthy seed; keep the salt-flat imagery");
  });
  await pressUntil(
    page,
    "n",
    async () => (await page.locator(".story-curation-status__note").count()) > 0,
  );
  await capture(page, {
    group: "curation",
    id: "curation-annotated",
    title: "Kept + annotated",
    description:
      "Pressed N and typed a note: annotation joins the kept chip in the focused-turn status line.",
    seq: 10,
  });
});

// ---------------------------------------------------------------------------
// GROUP: edit — the EDIT overlay
// ---------------------------------------------------------------------------
test("atlas: edit overlay", async ({ page }) => {
  await boot(page);
  await pressUntil(page, "Backspace", () => modeIs(page, "EDIT"));
  await capture(page, {
    group: "edit",
    id: "edit-seed",
    title: "Editing the seed",
    description:
      "Backspace on the root opens the EDIT overlay over the seed text. START saves, SELECT cancels.",
    seq: 11,
  });
  await pressUntil(page, "Escape", () => modeIs(page, "LOOM")); // START: save (no changes)
  await settled(page);

  await fanSiblings(page, 1);
  // Descend until the FOCUSED turn is model-authored (the authorship chip
  // narrates origin), so Backspace verifiably edits a generated turn.
  await pressUntil(
    page,
    "ArrowDown",
    async () =>
      (await page.locator(".story-authorship-status--model").count()) > 0,
  );
  await pressUntil(page, "Backspace", () => modeIs(page, "EDIT"));
  await expect(page.locator("textarea")).not.toHaveValue(
    /Once upon a time, in Absalom,$/,
  );
  await capture(page, {
    group: "edit",
    id: "edit-generated-turn",
    title: "Editing a generated turn",
    description:
      "EDIT overlay on a generated continuation — revision-in-place, children kept.",
    seq: 12,
  });
});

// ---------------------------------------------------------------------------
// GROUP: map — the minimap projection
// ---------------------------------------------------------------------------
test("atlas: map states", async ({ page }) => {
  await boot(page);
  await pressUntil(page, "Escape", () => modeIs(page, "MAP"));
  await capture(page, {
    group: "map",
    id: "map-single-node",
    title: "Map: single node",
    description:
      "The map projection of a fresh story: one node, the single-node affordance ring.",
    seq: 13,
  });
  await pressUntil(page, "Escape", () => modeIs(page, "LOOM")); // back to loom

  // Build a tree with real shape: 3 branches at depth 1, then a spine.
  await fanSiblings(page, 3);
  await descendToLeaf(page);
  await growDeep(page, 3);
  await pressUntil(page, "Escape", () => modeIs(page, "MAP"));
  await expect(page.locator(".minimap-node")).not.toHaveCount(0);
  await capture(page, {
    group: "map",
    id: "map-branched-tree",
    title: "Map: branched tree",
    description:
      "Map of a grown story: a 3-way fan then a deep spine — cursor node highlighted, minibuffer narrates.",
    seq: 14,
  });
});

test("atlas: map with kept turns", async ({ page }) => {
  await boot(page);
  await fanSiblings(page, 2);
  await pressUntil(
    page,
    "k",
    async () => (await page.locator(".story-curation-status__kept").count()) > 0,
  ); // keep the root (focused turn)
  await pressUntil(page, "Escape", () => modeIs(page, "MAP"));
  await capture(page, {
    group: "map",
    id: "map-kept-turns",
    title: "Map with kept turns",
    description:
      "Map view of a story whose root is KEPT. NOTE: on main the map does not yet mark kept nodes — curation is invisible here (fix/map-curation-indicator exists as an unmerged branch).",
    seq: 15,
  });
});

// ---------------------------------------------------------------------------
// GROUP: drawer — tabs strip, settings, stories, models, model editor
// ---------------------------------------------------------------------------
test("atlas: drawer tour", async ({ page }) => {
  await boot(page);

  // Viewport churn can knock the drawer closed mid-capture, so every shot
  // carries an `ensure` that walks back to the wanted drawer state.
  const ensureDrawerOpen = async () => {
    if (await modeIs(page, "LOOM")) {
      await pressUntil(page, "`", async () => !(await modeIs(page, "LOOM")));
    }
  };
  const ensureTabs = async () => {
    await ensureDrawerOpen();
    if (!(await modeIs(page, "TABS"))) {
      await pressUntil(page, "ArrowUp", () => modeIs(page, "TABS"));
    }
  };
  const ensureTab = async (label: string, mode: string) => {
    await ensureDrawerOpen();
    if (!(await modeIs(page, mode))) {
      await page.getByRole("tab", { name: label }).click();
      await expect(page.locator(".mode-bar-title")).toHaveText(mode);
    }
  };

  await ensureTabs();
  await capture(
    page,
    {
      group: "drawer",
      id: "drawer-tabs",
      title: "Drawer: tab strip",
      description:
        "SELECT opens the drawer; cursor on the tab strip (Settings / Models / Stories), ◄► to move, ↵ to drop into rows.",
      seq: 16,
    },
    { ensure: ensureTabs },
  );

  // SETTINGS tab (cursor is already on Settings — drop into its rows)
  const ensureSettings = () => ensureTab("Settings", "SETTINGS");
  await ensureSettings();
  await capture(
    page,
    {
      group: "drawer",
      id: "drawer-settings",
      title: "Drawer: Settings",
      description:
        "Settings rows — theme, font, generation parameters. ↵ cycles a row's value.",
      seq: 17,
    },
    { ensure: ensureSettings },
  );

  // STORIES tab with a populated list: make a second story first.
  await ensureTab("Stories", "STORIES");
  await page.getByText("New Story", { exact: false }).first().click();
  await waitForStoryIndex(page); // creating a story closes the drawer
  const ensureStories = () => ensureTab("Stories", "STORIES");
  await ensureStories();
  await capture(
    page,
    {
      group: "drawer",
      id: "drawer-stories",
      title: "Drawer: Stories",
      description:
        "The loom list: every story with its actions (open, share, export, delete), Sort row, + New Story, Import conversation.",
      seq: 18,
    },
    { ensure: ensureStories },
  );

  // MODELS tab
  const ensureModels = () => ensureTab("Models", "MODELS");
  await ensureModels();
  await capture(
    page,
    {
      group: "drawer",
      id: "drawer-models",
      title: "Drawer: Models",
      description: "Model roster — ↵ edits a model, ⌫ deletes, plus New model.",
      seq: 19,
    },
    { ensure: ensureModels },
  );

  // MODEL EDITOR
  const ensureModelEditor = async () => {
    if (await modeIs(page, "EDIT MODEL")) return;
    await ensureModels();
    // Click the first model row (its accessible name carries the "…tok · T=…"
    // config summary) — row activation opens the editor.
    await page.getByRole("button", { name: /tok · T=/ }).first().click();
    await expect(page.locator(".mode-bar-title")).toHaveText("EDIT MODEL");
  };
  await ensureModelEditor();
  await capture(
    page,
    {
      group: "drawer",
      id: "drawer-model-editor",
      title: "Model editor",
      description:
        "Editing one model's config: id, label, params — field-by-field with the d-pad.",
      seq: 20,
    },
    { ensure: ensureModelEditor },
  );
});

// ---------------------------------------------------------------------------
// GROUP: conversation — imported conversation loom + share/read views
// ---------------------------------------------------------------------------
test("atlas: conversation import and share view", async ({ page, browser }) => {
  await boot(page, { prefix: "Conversation atlas" });
  const file = await writeSyntheticConversationFile({
    title: "Atlas Synthetic Chat",
    turns: [
      { role: "user", text: "What does the forest floor look like from above?" },
      {
        role: "assistant",
        text: "Like a map that grew instead of being drawn: every conversation a trunk, every branch a place someone chose differently.",
      },
      { role: "user", text: "And from inside?" },
      {
        role: "assistant",
        text: "From inside it is just the next sentence, waiting.",
      },
    ],
  });
  await importConversation(page, file);
  await expect(page.locator(".navbar-minibuffer")).toContainText(
    'Imported "Atlas Synthetic Chat"',
  );
  await pressUntil(page, "Escape", () => modeIs(page, "LOOM"));
  await expect(page.locator("body")).toContainText(
    "What does the forest floor look like from above?",
  );
  await capture(page, {
    group: "conversation",
    id: "conversation-imported",
    title: "Imported conversation",
    description:
      "A synthetic Claude-session conversation opened as a loom: user/assistant turns with honest authorship.",
    seq: 21,
  });

  // Share URL → fresh context (the receiving/read side of a share).
  const convUrl = await page.evaluate(async () => {
    const mod = await import("/client/interface/lync/storyRuntime.ts");
    const entries = await mod.listStoryEntries();
    const conv = entries.find(
      (e: { kind?: string }) => e.kind === "conversation",
    );
    if (!conv) throw new Error("conversation not registered in the index");
    return mod.createStoryShareUrl(conv.ref.loomId) as string;
  });
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await guestPage.addInitScript((prefs) => {
    localStorage.setItem("textile-theme-preferences", JSON.stringify(prefs));
  }, { mode: "dark", paletteLight: "theme-light", paletteDark: "theme-black-green" });
  await mockGeneration(guestPage, "Guest continuation");
  await guestPage.goto(convUrl);
  await expect(guestPage.locator("body")).toContainText(
    "What does the forest floor look like from above?",
  );
  await capture(guestPage, {
    group: "conversation",
    id: "share-received",
    title: "Opened via share link",
    description:
      "A fresh browser opened the ?ref= share URL: the conversation loom imports and renders — the reader side of sharing.",
    seq: 22,
  });
  await guest.close();
});

// ---------------------------------------------------------------------------
// GROUP: themes — the same mid-story loom in all six palettes
// ---------------------------------------------------------------------------
const PALETTES: { cls: string; mode: "light" | "dark"; label: string }[] = [
  { cls: "theme-light", mode: "light", label: "Light" },
  { cls: "theme-blue", mode: "light", label: "Blue" },
  { cls: "theme-aperture", mode: "light", label: "Aperture" },
  { cls: "theme-black-green", mode: "dark", label: "Black/green (default dark)" },
  { cls: "theme-nerv", mode: "dark", label: "NERV" },
  { cls: "theme-outrun", mode: "dark", label: "Outrun" },
];

test("atlas: theme palettes", async ({ browser }) => {
  let seq = 23;
  for (const palette of PALETTES) {
    // Fresh context per palette: the theme initScript re-runs on every load,
    // so each palette needs its own context (one initScript would clobber a
    // later localStorage write on reload).
    const context = await browser.newContext();
    const page = await context.newPage();
    await boot(page, {
      prefix: "Palette proof",
      theme: {
        mode: palette.mode,
        paletteLight: palette.mode === "light" ? palette.cls : "theme-light",
        paletteDark:
          palette.mode === "dark" ? palette.cls : "theme-black-green",
      },
    });
    await fanSiblings(page, 1);
    await expect(page.locator(`.${palette.cls}`)).not.toHaveCount(0);
    await capture(
      page,
      {
        group: "themes",
        id: `theme-${palette.cls.replace("theme-", "")}`,
        title: `Theme: ${palette.label}`,
        description: `The same mid-story loom rendered in the ${palette.label} palette (${palette.mode} tone).`,
        seq: seq,
      },
      { viewports: ["desktop"], theme: `${palette.label} (${palette.mode})` },
    );
    seq += 1;
    await context.close();
  }
});
