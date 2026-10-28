import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'pilot-preview.spec.mjs',
  outputDir: './test-results/preview',
  workers: 1,
  timeout: 45000,
  expect: { timeout: 15000 },
  use: {
    browserName: 'chromium',
    channel: process.env.PLAYWRIGHT_CHANNEL,
    trace: 'retain-on-failure',
  },
});
