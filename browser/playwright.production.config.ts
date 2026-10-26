import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  outputDir: './test-results/production',
  testMatch: '**/production.spec.ts',
  workers: 1,
  timeout: 45000,
  expect: { timeout: 12000 },
  use: {
    baseURL: 'http://127.0.0.1:5186/a-long-table/',
    browserName: 'chromium',
    channel: process.env.PLAYWRIGHT_CHANNEL,
    viewport: { width: 1280, height: 850 },
    deviceScaleFactor: 2,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --base /a-long-table/',
    url: 'http://127.0.0.1:5186/a-long-table/',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
