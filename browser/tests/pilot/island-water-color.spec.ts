import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { build } from 'vite';
import type {} from './fixtures/island-water-color';

let fixtureCode: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false, publicDir: false, logLevel: 'error',
    build: { write: false, minify: false, lib: {
      entry: resolve('tests/pilot/fixtures/island-water-color.ts'), formats: ['es'],
    } },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const chunk = outputs.flatMap(output => 'output' in output ? output.output : []).find(item => item.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Could not bundle the water color reference fixture.');
  fixtureCode = chunk.code;
});

for (const projection of ['current', 'oblique'] as const) {
  test(`palette fringes evolve sparsely without moving deep anchors in ${projection} GPU views`, async ({ page }) => {
    await page.route('**/__island-water-color.js', route => route.fulfill({ contentType: 'text/javascript', body: fixtureCode }));
    await page.goto('/#/');
    await page.addScriptTag({ type: 'module', url: '/__island-water-color.js' });
    const results = await page.evaluate(projection => window.islandWaterColorFixture.compareEdgeMotion(projection), projection);
    console.info(`Palette fringe motion ${projection}: ${JSON.stringify(results)}`);
    for (const result of results) {
      expect(result.samples).toBeGreaterThan(10000);
      expect(result.mean).toBeLessThan(0.02);
      expect(result.maximum).toBeLessThanOrEqual(5);
      expect(result.nextFrameFraction).toBeLessThan(0.005);
      expect(result.cycleChanges).toBe(0);
      expect(result.clockWrapChanges).toBe(0);
      if (result.enabled && result.depth < 12) {
        expect(result.changedFraction).toBeGreaterThan(0.02);
        expect(result.changedFraction).toBeLessThan(0.3);
      } else expect(result.changedFraction).toBe(0);
    }
  });

  test(`whole-island coastal slopes retain broad shallows and projected pixel shades on GPU in ${projection} views`, async ({ page }) => {
    await page.route('**/__island-water-color.js', route => route.fulfill({ contentType: 'text/javascript', body: fixtureCode }));
    await page.goto('/#/');
    await page.addScriptTag({ type: 'module', url: '/__island-water-color.js' });
    const results = await page.evaluate(projection => window.islandWaterColorFixture.compareCoastalSlope(projection), projection);
    console.info(`Whole-island slopes ${projection}: ${JSON.stringify(results)}`);
    for (const result of results) {
      expect(result.shallow).toBeGreaterThan(500);
      expect(result.transition).toBeGreaterThan(1000);
      expect(result.deep).toBeGreaterThan(1000);
      expect(result.mean).toBeLessThan(0.05);
      expect(result.offPalette).toBe(0);
      expect(result.nonAdjacent).toBe(0);
      // The eight-bit GPU foundation can choose the neighbouring dither shade near a threshold.
      expect(result.mismatchFraction).toBeLessThan(0.01);
      expect(result.maximum).toBeLessThanOrEqual(5);
    }
  });

  test(`surface normals, sky sheen and sun highlights match software in ${projection} views`, async ({ page }) => {
    await page.route('**/__island-water-color.js', route => route.fulfill({ contentType: 'text/javascript', body: fixtureCode }));
    await page.goto('/#/');
    await page.addScriptTag({ type: 'module', url: '/__island-water-color.js' });
    const results = await page.evaluate(projection => window.islandWaterColorFixture.compareSurface(projection), projection);
    for (const result of results) {
      expect(result.samples).toBeGreaterThan(30);
      expect(result.mean).toBeLessThan(0.25);
      expect(result.maximum).toBeLessThanOrEqual(2);
    }
  });

  test(`coastal color and seabed transmission match the software equation across ${projection} rotation`, async ({ page }) => {
    await page.route('**/__island-water-color.js', route => route.fulfill({ contentType: 'text/javascript', body: fixtureCode }));
    await page.goto('/#/');
    await page.addScriptTag({ type: 'module', url: '/__island-water-color.js' });
    for (const seed of [77, 153025, 902479]) for (const depth of [-1, 2, 12]) {
      const results = await page.evaluate(({ seed, projection, depth }) =>
        window.islandWaterColorFixture.compare(seed, projection, depth), { seed, projection, depth });
      for (const result of results) {
        expect(result.samples).toBeGreaterThan(300);
        expect(result.mean).toBeLessThan(0.6);
        // Bound an adjacent packed-depth palette shade after the known bottom-tint gain.
        expect(result.maximum).toBeLessThanOrEqual(result.paletteErrorLimit);
      }
    }
  });

  test(`finite submerged shelf silhouettes cannot change ${projection} water at any tested yaw`, async ({ page }) => {
    await page.route('**/__island-water-color.js', route => route.fulfill({ contentType: 'text/javascript', body: fixtureCode }));
    await page.goto('/#/');
    await page.addScriptTag({ type: 'module', url: '/__island-water-color.js' });
    const results = await page.evaluate(projection =>
      window.islandWaterColorFixture.finiteShelfDifference(projection), projection);
    for (const result of results) {
      expect(result.maximum).toBeLessThanOrEqual(1);
      expect(result.changed).toBe(0);
    }
  });

  test(`bottom refraction bends detail without moving dry land in ${projection} views`, async ({ page }) => {
    await page.route('**/__island-water-color.js', route => route.fulfill({ contentType: 'text/javascript', body: fixtureCode }));
    await page.goto('/#/');
    await page.addScriptTag({ type: 'module', url: '/__island-water-color.js' });
    const results = await page.evaluate(projection => [0.75, 2].flatMap(depth =>
      window.islandWaterColorFixture.compareRefraction(projection, depth)), projection);
    console.info(`Refraction ${projection}: ${JSON.stringify(results)}`);
    for (const result of results) {
      expect(result.samples).toBeGreaterThan(1000);
      expect(result.mean).toBeLessThan(0.5);
      expect(result.maximum).toBeLessThanOrEqual(3);
      expect(result.bentPixels).toBeGreaterThan(100);
      expect(result.animatedBentPixels).toBeGreaterThan(25);
      expect(result.protectedPixels).toBeGreaterThan(100);
      expect(result.protectedChanges).toBe(0);
      expect(result.foregroundLeaks).toBe(0);
      expect(result.frozen).toBe(true);
      expect(result.animated).toBe(true);
    }
  });

  test(`finite beds fade at their ${projection} edges, retain middle detail and obscure deep shelves`, async ({ page }) => {
    await page.route('**/__island-water-color.js', route => route.fulfill({ contentType: 'text/javascript', body: fixtureCode }));
    await page.goto('/#/');
    await page.addScriptTag({ type: 'module', url: '/__island-water-color.js' });
    const results = await page.evaluate(projection => window.islandWaterColorFixture.softenedShelfEdges(projection), projection);
    console.info(`Soft shelf edges ${projection}: ${JSON.stringify(results)}`);
    for (const result of results) {
      expect(result.edgeSamples).toBeGreaterThan(50);
      expect(result.edgeMaximum).toBeLessThanOrEqual(3);
      if (result.depth === 2) expect(result.interiorMaximum).toBeGreaterThan(15);
      else if (result.depth === 3.5) expect(result.interiorMaximum).toBeGreaterThan(5);
      else expect(result.interiorMaximum).toBe(0);
    }
  });
}

test('normal generation retains water color, paused state and geometry through views on varied seeds', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const seed of [153025, 153026, 153027, 153028]) {
    await page.goto(`/#/island?seed=${seed}&water=still&shadowQuality=512`);
    const surface = page.locator('[data-island-surface="true"]');
    await expect(surface).toHaveAttribute('data-presentation', 'webgl');
    await expect(surface).toHaveAttribute('data-seed', String(seed));
    const triangles = await surface.getAttribute('data-triangles');
    const time = await surface.getAttribute('data-water-time');
    const ocean = page.locator('.island-orbit-canvas');
    await ocean.screenshot({ path: testInfo.outputPath(`water-${seed}.png`) });
    await page.getByRole('button', { name: 'Rotate island right', exact: true }).click();
    await expect(surface).toHaveAttribute('data-turning', 'false');
    expect(await surface.getAttribute('data-triangles')).toBe(triangles);
    expect(await surface.getAttribute('data-water-time')).toBe(time);
    await page.getByRole('button', { name: 'Elevation plan', exact: true }).click();
    await expect(ocean).toBeHidden();
    await page.getByRole('button', { name: 'Elevated oblique', exact: true }).click();
    await expect(ocean).toBeVisible();
    await expect(surface).toHaveAttribute('data-presentation', 'webgl');
    await ocean.screenshot({ path: testInfo.outputPath(`water-${seed}-oblique.png`) });
  }
  expect(errors).toEqual([]);
});
