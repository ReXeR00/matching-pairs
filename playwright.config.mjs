// Browser tests against the production build, served like GitHub Pages.
//   npm run build && npm run test:e2e
// Each test gets a fresh, isolated browser context (empty storage, no user
// profile); all data is synthetic. See TESTING.md.
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT || 4173);
const BASE_URL = `http://127.0.0.1:${PORT}/matching-pairs/`;

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.mjs",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      // PW_CHANNEL=msedge (or chrome) uses an installed browser instead of Playwright's Chromium
      use: { ...devices["Desktop Chrome"], channel: process.env.PW_CHANNEL || undefined },
    },
  ],
  webServer: {
    command: "node scripts/pages-server.mjs",
    url: BASE_URL,
    reuseExistingServer: false,
    env: { PORT: String(PORT), PAGES_DIST: process.env.PAGES_DIST || "dist" },
  },
});
