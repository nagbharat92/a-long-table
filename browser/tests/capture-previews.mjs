import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const origin = process.env.APP_URL ?? 'http://127.0.0.1:5185';
const output = process.env.CAPTURE_DIR ?? resolve('test-results/manual');
await mkdir('public/previews', { recursive: true });
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 850 },
  deviceScaleFactor: 1,
  colorScheme: 'light',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  for (const mode of ['play', 'island', 'character', 'foraging', 'navigation']) {
    await page.goto(`${origin}/#/${mode}?seed=42&paused=1`);
    await page.waitForFunction(() => window.__longTable?.ready, { timeout: 20000 });
    await page.evaluate((id) => {
      const { simulation, view } = window.__longTable;
      if (id === 'character') {
        simulation.character.motionWeight = 1;
        simulation.character.gaitDistance = 4.5;
      }
      if (id === 'foraging') view.zoomBy(2);
    }, mode);
    await page.waitForTimeout(150);
    await page.locator('canvas').screenshot({ path: `public/previews/${mode}.png` });
    await page.screenshot({ path: resolve(output, `${mode}-desktop.png`) });
  }
  await page.goto(origin);
  await page.reload();
  await page.locator('img').evaluateAll((images) => {
    for (const image of images) image.loading = 'eager';
  });
  await page.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0));
  await page.screenshot({ path: resolve(output, 'home-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 780 });
  await page.screenshot({ path: resolve(output, 'home-portrait.png'), fullPage: true });
  await page.goto(`${origin}/#/island?paused=1`);
  await page.waitForFunction(() => window.__longTable?.ready);
  await page.screenshot({ path: resolve(output, 'island-portrait.png'), fullPage: true });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`Captured five real scene previews and desktop/portrait review images in ${output}`);
} finally {
  await context.close();
  await browser.close();
}
