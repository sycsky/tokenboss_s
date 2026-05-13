/**
 * Playwright config — gh-3 introduces the first E2E coverage for the
 * `/install/manual` one-click CC Switch flow.
 *
 * Why these settings:
 *   - `testDir: "./e2e"` keeps E2E specs out of `src/` so vitest doesn't
 *     try to run them (vitest globs `src/__tests__`).
 *   - `webServer.command: "npm run dev"` lets `playwright test` boot the
 *     Vite dev server itself, so CI doesn't need a separate orchestrator.
 *     `reuseExistingServer: !process.env.CI` means local runs latch onto
 *     an already-running `npm run dev` instead of fighting for port 5179.
 *   - `baseURL` matches the dev server's port (see `vite.config.ts`).
 *   - Only chromium for now — the flow is custom-protocol heavy and we
 *     don't need cross-browser noise on every push.
 */

import { defineConfig, devices } from "@playwright/test";

const PORT = 5179;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
