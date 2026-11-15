import { expect, test } from '@playwright/test';

const ready = async (page: import('@playwright/test').Page) => expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
const snapshot = async (page: import('@playwright/test').Page) => page.evaluate(() => window.__pilot!.snapshot() as {
  seed: number; form: string; bushCount: number; clusterCount: number; seconds: number; paused: boolean; shadows: boolean;
  bushes: { x: number; y: number; depth: number; cluster: number; palette: 'green' | 'warm' }[];
  clusterForms: string[];
  warmShrubs: boolean; warmBushCount: number;
  renderMode: string; canopyCount: number; foliagePixels: number; creasePixels: number;
  layout: 'spaced' | 'stacked'; canopyOverlapPixels: number; canopyOffsets: { x: number; y: number }[];
  sunEnabled: boolean; groundShadowPixels: number; receiverShadowPixels: number;
  sun: { azimuth: number; shadowMode: string; mapSize: number };
});
const pixels = async (page: import('@playwright/test').Page) => page.locator('.bush-patch-stage canvas').evaluate((canvas: HTMLCanvasElement) =>
  Array.from(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data));

test('whole-patch generation, alias, pause, seeds and reproducible controls', async ({ page }) => {
  await page.goto('/#/foliage?tab=bush-patch&seed=9&paused=true');
  await ready(page); await expect(page).toHaveURL(/#\/bush-patch\?/);
  expect(await snapshot(page)).toMatchObject({ seed: 9, paused: true, shadows: true, sunEnabled: true });
  const original = await pixels(page);
  await page.waitForTimeout(180);
  expect(await pixels(page)).toEqual(original);
  await page.getByRole('button', { name: 'Generate patch' }).click();
  expect((await snapshot(page)).seed).not.toBe(9);
  await page.getByRole('textbox', { name: 'Seed number or name' }).fill('9');
  await page.getByRole('button', { name: 'Apply seed', exact: true }).click();
  expect(await pixels(page)).toEqual(original);
  await page.getByRole('button', { name: 'Resume wind' }).click();
  await expect.poll(async () => (await snapshot(page)).seconds).toBeGreaterThan(0.25);
  await page.getByRole('button', { name: 'Pause wind' }).click();
  const time = (await snapshot(page)).seconds;
  await page.waitForTimeout(180); expect((await snapshot(page)).seconds).toBe(time);
  await page.reload(); await ready(page);
  expect((await snapshot(page)).seconds).toBe(time);
});

test('sun and shadows change renderer; reference scale stays optional and berry bush remains separate', async ({ page }) => {
  await page.goto('/#/bush-patch?seed=9&paused=true'); await ready(page);
  const original = await pixels(page);
  expect((await snapshot(page)).groundShadowPixels).toBeGreaterThan(0);
  expect((await snapshot(page)).receiverShadowPixels).toBeGreaterThan(0);
  const shadows = page.getByRole('checkbox', { name: 'Cast on ground and neighboring foliage' });
  await shadows.uncheck(); expect((await snapshot(page)).groundShadowPixels).toBe(0);
  expect(await pixels(page)).not.toEqual(original);
  await shadows.check(); expect(await pixels(page)).toEqual(original);
  await page.getByRole('slider', { name: 'Sun azimuth' }).fill('50');
  expect((await snapshot(page)).sun.azimuth).toBe(50); expect(await pixels(page)).not.toEqual(original);
  await page.getByRole('combobox', { name: 'Shadow mode' }).selectOption('hard');
  await expect(page.getByRole('slider', { name: 'Shadow softness' })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Shadow quality' }).selectOption('2048');
  await page.reload(); await ready(page);
  expect((await snapshot(page)).sun).toMatchObject({ azimuth: 50, shadowMode: 'hard', mapSize: 2048 });
  await page.getByRole('button', { name: 'Reset sun' }).click(); expect(await pixels(page)).toEqual(original);
  await page.getByRole('checkbox', { name: 'Sun lighting', exact: true }).uncheck();
  await expect(page.getByRole('slider', { name: 'Sun azimuth' })).toBeDisabled();
  const ground = await page.locator('canvas').evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(canvas.width - 1, canvas.height - 1, 1, 1).data]);
  expect(ground).toEqual([184, 207, 206, 255]);
  await page.getByRole('checkbox', { name: 'Reference trees at the same pixel scale' }).uncheck();
  expect(await pixels(page)).not.toEqual(original);
  await page.getByRole('link', { name: 'Berry bush', exact: true }).click(); await ready(page);
  await expect(page.locator('.bush-patch-stage')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Bush patch study', exact: true })).toBeVisible();
});

test('reduced motion and narrow viewport retain a readable native shell', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/bush-patch?seed=42'); await ready(page);
  expect((await snapshot(page)).paused).toBe(true);
  await expect(page.getByRole('button', { name: 'Generate patch' })).toBeVisible();
  const bounds = await page.locator('.bush-patch-stage canvas').boundingBox();
  expect(bounds!.width).toBeGreaterThan(200); expect(bounds!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('renders dense separate groups and retains them through wind and PNG export', async ({ page }, testInfo) => {
  for (const seed of [0, 9, 42]) {
    await page.goto(`/#/bush-patch?seed=${seed}&paused=true`); await ready(page);
    const state = await snapshot(page);
    expect(state.clusterCount).toBeGreaterThanOrEqual(2);
    expect(state.clusterCount).toBeLessThanOrEqual(3);
    expect(new Set(state.bushes.map(bush => bush.cluster)).size).toBe(state.clusterCount);
    expect(new Set(state.clusterForms).size).toBe(state.clusterCount);
    expect(state.renderMode).toBe('continuous');
    expect(state.canopyCount).toBe(state.clusterCount);
    expect(state.creasePixels / state.foliagePixels).toBeLessThan(0.06);
    await expect(page.locator('.bush-patch-stage figcaption')).toContainText(`${state.clusterCount} canopies`);
    await page.locator('.bush-patch-stage').screenshot({ path: testInfo.outputPath(`clusters-seed-${seed}.png`) });
  }
  const before = await pixels(page);
  await page.getByRole('slider', { name: 'Wind strength' }).fill('6');
  await page.getByRole('button', { name: 'Resume wind' }).click();
  await expect.poll(async () => (await snapshot(page)).seconds).toBeGreaterThan(2);
  await page.getByRole('button', { name: 'Pause wind' }).click();
  expect(await pixels(page)).not.toEqual(before);
  expect((await snapshot(page)).clusterCount).toBeGreaterThanOrEqual(2);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG' }).click();
  expect((await download).suggestedFilename()).toBe('bush-patch-42.png');
});

test('surface lighting follows sun controls independently of cast shadows', async ({ page }, testInfo) => {
  await page.goto('/#/bush-patch?seed=9&paused=true&trees=false&shadows=false'); await ready(page);
  const azimuth = page.getByRole('slider', { name: 'Sun azimuth' });
  await azimuth.fill('0');
  const right = await pixels(page);
  await page.locator('.bush-patch-stage').screenshot({ path: testInfo.outputPath('sun-from-right.png') });
  await azimuth.fill('180');
  expect(await pixels(page)).not.toEqual(right);
  expect((await snapshot(page)).groundShadowPixels).toBe(0);
  await page.locator('.bush-patch-stage').screenshot({ path: testInfo.outputPath('sun-from-left.png') });
  await page.getByRole('slider', { name: 'Sun intensity' }).fill('0');
  const ambient = await pixels(page);
  await azimuth.fill('0');
  expect(await pixels(page)).toEqual(ambient);
  await page.reload(); await ready(page);
  expect(await pixels(page)).toEqual(ambient);
});

test('a failed seed change retains the last valid patch and URL', async ({ page }) => {
  await page.goto('/#/bush-patch?seed=9&paused=true'); await ready(page);
  const original = await pixels(page), url = page.url();
  await page.getByRole('textbox', { name: 'Seed number or name' }).fill('');
  await page.getByRole('button', { name: 'Apply seed', exact: true }).click();
  await expect(page.getByText('Enter a seed number or name.', { exact: true })).toBeVisible();
  expect((await snapshot(page)).seed).toBe(9);
  expect(await pixels(page)).toEqual(original);
  expect(page.url()).toBe(url);
  await page.getByRole('textbox', { name: 'Seed number or name' }).fill('42');
  await page.getByRole('button', { name: 'Apply seed', exact: true }).click();
  expect((await snapshot(page)).seed).toBe(42);
});

test('warm pockets are visibly grouped, optional and reproducible without changing the scene', async ({ page }, testInfo) => {
  for (const seed of [9, 17, 153031]) {
    await page.goto(`/#/bush-patch?seed=${seed}&paused=true&trees=false`); await ready(page);
    const state = await snapshot(page), original = await pixels(page);
    expect(state.warmShrubs).toBe(true);
    expect(state.warmBushCount).toBeGreaterThanOrEqual(4);
    const warm = state.bushes.filter(bush => bush.palette === 'warm');
    expect(new Set(warm.map(bush => bush.cluster)).size).toBe(1);
    let visibleWarm = 0;
    for (let i = 0; i < original.length; i += 4) {
      if (original[i] > original[i + 1] + 5 && original[i + 1] > original[i + 2] + 5) visibleWarm++;
    }
    expect(visibleWarm, `seed ${seed}: visible ochre/tawny foliage pixels`).toBeGreaterThan(80);
    await page.locator('.bush-patch-stage').screenshot({ path: testInfo.outputPath(`warm-seed-${seed}.png`) });
    const toggle = page.getByRole('checkbox', { name: 'Warm shrub pockets' });
    await toggle.uncheck();
    const green = await pixels(page);
    expect(green).not.toEqual(original);
    expect((await snapshot(page)).bushes).toEqual(state.bushes);
    expect((await snapshot(page)).warmBushCount).toBe(0);
    await page.reload(); await ready(page);
    await expect(toggle).not.toBeChecked();
    expect(await pixels(page)).toEqual(green);
    await toggle.check();
    expect(await pixels(page)).toEqual(original);
  }
  await page.goto('/#/bush-patch?seed=0&paused=true'); await ready(page);
  expect((await snapshot(page)).warmBushCount).toBe(0);
});

test('stacked and spaced arrangements compare the same artwork and preserve the selected layout', async ({ page }, testInfo) => {
  await page.goto('/#/bush-patch?seed=9&paused=true'); await ready(page);
  const stacked = await pixels(page), state = await snapshot(page);
  expect(state.layout).toBe('stacked');
  expect(state.canopyOverlapPixels).toBeGreaterThan(40);
  await expect(page.getByRole('button', { name: 'Stacked', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.bush-patch-stage').screenshot({ path: testInfo.outputPath('stacked-seed-9.png') });
  await page.getByRole('button', { name: 'Spaced', exact: true }).click();
  const spaced = await pixels(page), after = await snapshot(page);
  expect(spaced).not.toEqual(stacked);
  expect(after.layout).toBe('spaced'); expect(after.canopyOverlapPixels).toBe(0);
  expect(after.bushes).toEqual(state.bushes);
  expect(after.canopyOffsets.every(offset => offset.x === 0 && offset.y === 0)).toBe(true);
  await page.locator('.bush-patch-stage').screenshot({ path: testInfo.outputPath('spaced-seed-9.png') });
  await page.reload(); await ready(page);
  expect((await snapshot(page)).layout).toBe('spaced'); expect(await pixels(page)).toEqual(spaced);
  await page.getByRole('button', { name: 'Stacked', exact: true }).click();
  expect(await pixels(page)).toEqual(stacked);
  await page.getByRole('button', { name: 'Generate patch', exact: true }).click();
  expect((await snapshot(page)).layout).toBe('stacked');
  expect((await snapshot(page)).canopyOverlapPixels).toBeGreaterThan(0);
});
