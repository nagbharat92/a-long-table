import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { build } from 'vite';
import type {} from './fixtures/island-water-regression';
import { presentationImage } from './island-presentation';

let fixtureCode: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false, publicDir: false, logLevel: 'error',
    build: { write: false, minify: false, lib: {
      entry: resolve('tests/pilot/fixtures/island-water-regression.ts'), formats: ['es'],
    } },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const chunk = outputs.flatMap(output => 'output' in output ? output.output : []).find(item => item.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Could not bundle the water regression fixture.');
  fixtureCode = chunk.code;
});

test('refraction-only water animates without water lighting and freezes exactly on pause', async ({ page }) => {
  await page.goto('/#/island?seed=153031&water=still&shadowQuality=512&waterNoiseShallow=0&waterNoiseDeep=0&layers=water:lighting=0,colorPatches=0,shoreFoam=0,surfaceHighlights=0,waves=0');
  const surface = page.locator('[data-island-surface="true"]');
  await expect(surface).toHaveAttribute('data-presentation', 'webgl');
  const before = await presentationImage(surface);
  await page.getByRole('button', { name: 'Animate water', exact: true }).click();
  await expect.poll(async () => Number(await surface.getAttribute('data-water-time'))).toBeGreaterThan(0.25);
  await expect.poll(() => presentationImage(surface)).not.toBe(before);
  await page.getByRole('button', { name: 'Pause water', exact: true }).click();
  const frozen = await presentationImage(surface), clock = await surface.getAttribute('data-water-time');
  await page.waitForTimeout(400);
  expect(await presentationImage(surface)).toBe(frozen);
  expect(await surface.getAttribute('data-water-time')).toBe(clock);
  await page.getByText('Inspect water', { exact: true }).click();
  await page.getByRole('checkbox', { name: 'Water Surface ripples and sheen', exact: true }).uncheck();
  await expect(page.getByRole('button', { name: 'Water motion off', exact: true })).toBeDisabled();
});

for (const projection of ['current', 'oblique'] as const) {
  for (const seed of [153031, 153028]) {
    test(`final ${projection} water visibly reveals and refracts real shallow beds, seed ${seed}`, async ({ page }, testInfo) => {
      test.setTimeout(180000);
      await page.route('**/__water-regression.js', route => route.fulfill({ contentType: 'text/javascript', body: fixtureCode }));
      await page.goto('/#/');
      await page.addScriptTag({ type: 'module', url: '/__water-regression.js' });
      const report = await page.evaluate(({ seed, projection }) =>
        window.islandWaterRegression.compareVisibleFinish(seed, projection), { seed, projection });
      const { images, ...measurements } = report;
      console.info(`Final visible water ${seed} ${projection}: ${JSON.stringify(measurements)}`);
      await testInfo.attach('visible-water-measurements', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
      for (const [name, image] of Object.entries(images))
        await testInfo.attach(`${seed}-${projection}-${name}`, { body: Buffer.from(image.split(',')[1], 'base64'), contentType: 'image/png' });
      expect(report.fringe.samples).toBeGreaterThan(10000);
      expect(report.fringe.visible / report.fringe.samples).toBeGreaterThan(0.02);
      expect(report.fringe.disabledMotion).toBe(0);
      for (const result of report.results) {
        expect(result.beds).toBeGreaterThan(100);
        expect(result.protectedPixels).toBeGreaterThan(1000);
        expect(result.protectedChanges).toBe(0);
        expect(result.animatedRefraction).toBeGreaterThan(50);
        expect(result.frames.every(frame => frame.brown === 0)).toBe(true);
        expect(Math.max(...result.frames.map(frame => frame.bottom.visible / frame.bottom.samples))).toBeGreaterThan(0.3);
        expect(result.bentPixels).toBeGreaterThan(100);
      }
    });
  }

  for (const seed of [153031, 153028]) {
    test(`seed ${seed} internal ${projection} shelf edges stay obscured through flat water and the complete wave cycle`, async ({ page }) => {
      test.setTimeout(240000);
      await page.route('**/__water-regression.js', route => route.fulfill({ contentType: 'text/javascript', body: fixtureCode }));
      await page.goto('/#/');
      await page.addScriptTag({ type: 'module', url: '/__water-regression.js' });
      const results = await page.evaluate(({ seed, projection }) =>
        window.islandWaterRegression.compareShelfContours(seed, projection), { seed, projection });
      console.info(`Internal shelf contours ${seed} ${projection}: ${JSON.stringify(results)}`);
      for (const result of results) {
        expect(result.edgeSamples).toBeGreaterThan(100);
        expect(result.maximum).toBeLessThanOrEqual(8);
        expect(result.interiorSamples).toBeGreaterThan(20);
        expect(result.interiorMaximum).toBeGreaterThan(10);
        expect(result.protectedChanges).toBe(0);
        expect(result.frames).toBe(17);
      }
      expect(results.reduce((sum, result) => sum + result.interiorSamples, 0)).toBeGreaterThan(100);
    });
  }

  test(`seed 153031 approaching ${projection} waves occlude shallow shelf silhouettes`, async ({ page }, testInfo) => {
    test.setTimeout(240000);
    await page.route('**/__water-regression.js', route => route.fulfill({ contentType: 'text/javascript', body: fixtureCode }));
    await page.goto('/#/');
    await page.addScriptTag({ type: 'module', url: '/__water-regression.js' });
    await page.evaluate(projection => {
      window.islandWaterRegression.prepare(153031, projection);
      window.islandWaterRegression.draw(1.5);
    }, projection);
    await page.locator('canvas').screenshot({ path: testInfo.outputPath(`153031-${projection}-incoming.png`) });
    const results = await page.evaluate(projection => window.islandWaterRegression.compareOcclusion(153031, projection, true), projection);
    console.info(`Incoming wave occlusion ${projection}: ${JSON.stringify(results)}`);
    expect(results.reduce((sum, result) => sum + result.samples, 0)).toBeGreaterThan(100);
    for (const result of results) {
      expect(result.frames).toBeGreaterThanOrEqual(17);
      expect(result.maximum).toBeLessThanOrEqual(8);
      expect(result.continuous).toBe(true);
    }
  });

  test(`seed 153028 shelves stay behind incoming ${projection} waves without recolouring the water`, async ({ page }) => {
    test.setTimeout(180000);
    await page.route('**/__water-regression.js', route => route.fulfill({ contentType: 'text/javascript', body: fixtureCode }));
    await page.goto('/#/');
    await page.addScriptTag({ type: 'module', url: '/__water-regression.js' });
    const results = await page.evaluate(projection => window.islandWaterRegression.compareOcclusion(153028, projection), projection);
    console.info(`Submerged wave occlusion ${projection}: ${JSON.stringify(results)}`);
    expect(results.reduce((sum, result) => sum + result.samples, 0)).toBeGreaterThan(100);
    for (const result of results) {
      expect(result.frames).toBeGreaterThanOrEqual(17);
      expect(result.maximum).toBeLessThanOrEqual(8);
      expect(result.continuous).toBe(true);
    }
  });
}
