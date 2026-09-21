// tests/browser/playwright.config.js
// Playwright is NOT a project dependency (per instructions). To run this
// suite: `npx playwright install chromium` once, then
//   npx --yes -p @playwright/test -p playwright playwright test tests/browser
// from the repo root.

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8080',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx --yes serve -l 8080 .',
    url: 'http://localhost:8080',
    reuseExistingServer: true,
    timeout: 30000,
    cwd: '../../',
  },
});
