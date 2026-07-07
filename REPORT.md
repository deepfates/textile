# dee-c2qy Report

Branch: `refactor/interface-decompose`

Worktree: `/Users/deepfates/Hacking/github/deepfates/textile`

## 1. Structure

- `client/interface/Interface.tsx` is no longer the model-catalog owner. Model loading, sorting, editor form state, validation, cursor repair, delete/save/cancel flows, and model-list/model-editor key navigation now live in `client/interface/hooks/useModelCatalog.ts`.
- Responsive gamepad layout state moved to `client/interface/hooks/useResponsiveGamepadLayout.ts`.
- Loom text rendering moved to `client/interface/components/StoryText.tsx`.
- Mode label/hint registration moved to `client/interface/modes/modeRegistry.ts`.
- `client/interface/hooks/useMenuSystem.ts` now exports `MenuParams` so extracted hooks can type the existing menu state without duplicating it.

Mode-registration seam:

```ts
// client/interface/modes/modeRegistry.ts
export const registeredModes: RegisteredMode[] = [
  { id: "edit", ... },
  { id: "model-editor", ... },
  { id: "drawer-settings", ... },
  { id: "map", ... },
  { id: "loom", ... },
];
```

`GamepadInterface` demonstrates the seam by routing the existing `LOOM`, `MAP`, drawer, edit, and model-editor modes through `getRegisteredMode(...)` instead of hard-coding the mode bar inline.

Line counts:

```text
Before:
  1941 client/interface/Interface.tsx

After:
  1265 client/interface/Interface.tsx
   633 client/interface/hooks/useModelCatalog.ts
    86 client/interface/modes/modeRegistry.ts
    61 client/interface/components/StoryText.tsx
    31 client/interface/hooks/useResponsiveGamepadLayout.ts
```

## 2. Commands

Client tests:

```sh
bun test ./client
```

Output:

```text
bun test v1.3.13 (bf2e2cec)

 29 pass
 0 fail
 47 expect() calls
Ran 29 tests across 5 files. [296.00ms]
```

Production build:

```sh
bun run build
```

Output:

```text
✓ built in 436ms
✓ built in 2.68s
PWA v1.0.3
mode      generateSW
precache  7 entries (3816.34 KiB)
files generated
  dist/client/sw.js
  dist/client/workbox-1504e367.js
```

Cold-read spot check server:

```sh
env OPENROUTER_API_KEY=sk-test TEXTILE_SITE_PASSWORD=alpha PORT=5174 NODE_ENV=production bun run.ts --mode=production --port=5174
```

Spot check:

```sh
node --input-type=module -e '
import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
let count = 0;
await page.route("**/api/generate", async (route) => {
  count += 1;
  await route.fulfill({ status: 200, contentType: "text/event-stream", body: `data: {"content":" Branch ${count}."}\n\ndata: [DONE]\n\n` });
});
await page.goto("http://127.0.0.1:5174/");
if (await page.locator("#password").count()) {
  await page.locator("#password").fill("alpha");
  await page.locator("#password").press("Enter");
}
await expect(page.locator("body")).toContainText("Once upon a time, in Absalom,");
await expect(page.locator(".mode-bar-title")).toHaveText("LOOM");
await page.keyboard.press("Enter");
await expect(page.locator("body")).toContainText("Branch 1.");
await page.keyboard.press("ArrowRight");
await expect(page.locator("body")).toContainText("Branch 2.");
await page.keyboard.press("Escape");
await expect(page.locator(".mode-bar-title")).toHaveText("MAP");
await expect(page.locator("body")).toContainText("MAP");
const minimapCount = await page.locator(".story-minimap, [aria-label*=Map], svg").count();
console.log(JSON.stringify({ generated: count, minimapCount, title: await page.locator(".mode-bar-title").textContent() }));
await browser.close();
'
```

Observed:

```text
{"generated":3,"minimapCount":1,"title":"MAP"}
```

The script logged in with the site password, stubbed `/api/generate`, verified initial `LOOM`, pressed Enter to generate, pressed ArrowRight to reach/generate a sibling branch, then pressed Escape and verified the `MAP` mode plus one minimap surface.

## 3. Non-gating Check

I also tried:

```sh
./node_modules/.bin/tsc -p config/tsconfig.json --noEmit
```

It failed on existing type issues outside this refactor, including `useStoryTree` state inference, `storyRuntime` URL-vs-Location tests, Bun matcher typings, and server validator narrowing. I did not change those files.

## 4. Filed Tickets

None. The non-gating TypeScript failures overlap known pre-existing suite/type debt called out in the brief (`dee-js7e`, `dee-4qzv`), so I did not file duplicates.
