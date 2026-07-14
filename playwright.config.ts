import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? process.env.PORT ?? 5173);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // e2e specs use the `.e2e.ts` suffix (not `.spec.ts`) so bun's test runner —
  // whose glob is `**{.test,.spec,_test_,_spec_}.{js,ts,jsx,tsx}` — never loads
  // them. Playwright's default testMatch only covers spec/test, so name them here.
  testMatch: "**/*.e2e.ts",
  timeout: 30_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: `PORT=${port} bun run dev`,
    url: baseURL,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "true",
    timeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
