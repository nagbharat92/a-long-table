import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  outputDir: './test-results/browser',
  testIgnore: '**/production.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 12000 },
  use: {
    baseURL: process.env.APP_URL ?? 'http://127.0.0.1:5185',
    browserName: 'chromium',
    channel: process.env.PLAYWRIGHT_CHANNEL,
    viewport: { width: 1280, height: 850 },
    deviceScaleFactor: 2,
    trace: 'retain-on-failure',
  },
  webServer: process.env.APP_URL ? undefined : {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5185',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
