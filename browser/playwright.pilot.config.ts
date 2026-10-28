import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/pilot',
  outputDir: './test-results/pilot',
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  use: {
    baseURL: 'http://127.0.0.1:5186',
    browserName: 'chromium',
    channel: process.env.PLAYWRIGHT_CHANNEL,
    viewport: { width: 1440, height: 960 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:5186',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
