import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { build } from 'vite';
import type {} from './fixtures/island-beach-wash';

let fixtureCode: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false, publicDir: false, logLevel: 'error',
    build: { write: false, minify: false, lib: {
      entry: resolve('tests/pilot/fixtures/island-beach-wash.ts'), formats: ['es'],
    } },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const chunk = outputs.flatMap(output => 'output' in output ? output.output : []).find(item => item.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Could not bundle the beach wash reference fixture.');
  fixtureCode = chunk.code;
});

for (const projection of ['current', 'oblique'] as const) {
  test(`beach run-up and broken foam match software through ${projection} turns`, async ({ page }) => {
    await page.route('**/__island-beach-wash.js', route => route.fulfill({ contentType: 'text/javascript', body: fixtureCode }));
    await page.goto('/#/');
    await page.addScriptTag({ type: 'module', url: '/__island-beach-wash.js' });
    const results = await page.evaluate(projection => window.islandBeachWashFixture.compare(projection), projection);
    console.info(`Beach wash ${projection}: ${JSON.stringify(results)}`);
    for (const result of results) {
      expect(result.samples).toBeGreaterThan(100);
      expect(result.movingDryPixels).toBeGreaterThan(20);
      expect(result.strongDryPixels).toBeGreaterThan(50);
      expect(result.peakDryPixels).toBeGreaterThan(20);
      expect(result.foamSamples).toBeGreaterThan(20);
      expect(result.whiteFoamPixels).toBeGreaterThan(20);
      expect(result.whiteFoamPixels).toBeGreaterThanOrEqual(result.expectedWhiteFoamPixels * 0.9);
      expect(result.rasterEdgeSamples / (result.samples + result.rasterEdgeSamples)).toBeLessThan(0.35);
      expect(result.mean).toBeLessThan(0.6);
      expect(result.deltaMean).toBeLessThan(0.6);
      expect(result.maximum).toBeLessThanOrEqual(15);
      expect(result.protectedChanges).toBe(0);
    }

  });

  test(`rock contact and mixed coves match software in all four ${projection} views`, async ({ page }) => {
    await page.route('**/__island-beach-wash.js', route => route.fulfill({ contentType: 'text/javascript', body: fixtureCode }));
    await page.goto('/#/');
    await page.addScriptTag({ type: 'module', url: '/__island-beach-wash.js' });
    const results = await page.evaluate(projection => window.islandBeachWashFixture.compare(projection, true), projection);
    console.info(`Mixed coastal contact ${projection}: ${JSON.stringify(results)}`);
    expect(results.reduce((sum, result) => sum + result.rockFoamSamples, 0)).toBeGreaterThan(20);
    for (const result of results) {
      expect(result.samples).toBeGreaterThan(100);
      expect(result.foamSamples).toBeGreaterThan(20);
      expect(result.whiteFoamPixels).toBeGreaterThan(20);
      expect(result.whiteFoamPixels).toBeGreaterThanOrEqual(result.expectedWhiteFoamPixels * 0.9);
      expect(result.rasterEdgeSamples / (result.samples + result.rasterEdgeSamples)).toBeLessThan(0.35);
      expect(result.mean).toBeLessThan(0.6);
      expect(result.deltaMean).toBeLessThan(0.6);
      expect(result.maximum).toBeLessThanOrEqual(15);
      expect(result.protectedChanges).toBe(0);
    }
  });
}
