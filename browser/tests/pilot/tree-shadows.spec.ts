import { expect, test } from '@playwright/test';

test('tree shadows toggle on the existing individual and layered tree previews', async ({ page }) => {
  await page.goto('/#/foliage?tab=trees&treeSeed=9');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: 'Pause wind' }).click();
  const read = async () => page.evaluate(() => {
    const pixels = (canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data];
    const single = document.querySelector<HTMLCanvasElement>('canvas.tree-preview')!;
    const layered = document.querySelector<HTMLCanvasElement>('canvas.asset-companion')!;
    const background = getComputedStyle(document.querySelector('.forage-stage')!).backgroundColor.match(/\d+/g)!.map(Number);
    const singlePixels = pixels(single), layeredPixels = pixels(layered);
    return {
      single: singlePixels, layered: layeredPixels, width: layered.width, background,
      singleGround: singlePixels.slice(-4), layeredGround: layeredPixels.slice(-4),
    };
  });
  await expect(page.locator('.asset-preview-row figure')).toHaveCount(2);
  await expect(page.locator('.tree-shadow-scene')).toHaveCount(0);
  const withShadows = await read();
  expect(withShadows.singleGround).toEqual([...withShadows.background, 255]);
  expect(withShadows.layeredGround).toEqual([...withShadows.background, 255]);
  const toggle = page.getByRole('checkbox', { name: 'Cast on ground and trees' });
  await expect(toggle).toBeChecked();
  expect((await toggle.boundingBox())!.width).toBeLessThan(30);
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
  const withoutShadows = await read();
  expect(withoutShadows.singleGround).toEqual(withShadows.singleGround);
  expect(withoutShadows.layeredGround).toEqual(withShadows.layeredGround);
  let trees = 0, ground = 0;
  for (let index = 0; index < withShadows.layered.length; index += 4) {
    if (withShadows.layered[index] === withoutShadows.layered[index] && withShadows.layered[index + 1] === withoutShadows.layered[index + 1]) continue;
    if (Math.floor(index / 4 / withShadows.width) < 160) trees++;
    if (Math.floor(index / 4 / withShadows.width) >= 185) ground++;
  }
  expect(trees).toBeGreaterThan(0);
  expect(ground).toBeGreaterThan(0);
  expect(withShadows.single).not.toEqual(withoutShadows.single);
  await toggle.check();
  expect(await read()).toEqual(withShadows);
});

test('tree sun controls match island settings and restore from the URL', async ({ page }) => {
  await page.goto('/#/foliage?tab=trees&treeSeed=9');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: 'Pause wind' }).click();
  const sun = () => page.evaluate(() => (window.__pilot!.snapshot() as {
    sun: { azimuth: number; elevation: number; intensity: number; skyFill: number; warmth: number;
      shadowStrength: number; softness: number; shadowMode: string; mapSize: number };
  }).sun);
  expect(await sun()).toEqual({
    azimuth: 230, elevation: 40, intensity: 1, skyFill: 0.3, warmth: 0.3,
    shadowStrength: 1, softness: 2, shadowMode: 'contact', mapSize: 1024,
  });
  for (const [label, value, key] of [
    ['Sun direction', '50', 'azimuth'], ['Sun elevation', '65', 'elevation'],
    ['Sun intensity', '0.5', 'intensity'], ['Sky fill', '0.8', 'skyFill'],
    ['Sun warmth', '0.8', 'warmth'], ['Shadow strength', '0.5', 'shadowStrength'],
    ['Shadow softness', '4', 'softness'],
  ] as const) {
    await page.getByRole('slider', { name: label }).fill(value);
    expect((await sun())[key]).toBe(Number(value));
  }
  await page.getByRole('combobox', { name: 'Shadow mode' }).selectOption('hard');
  await expect(page.getByRole('slider', { name: 'Shadow softness' })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Shadow mode' }).selectOption('filtered');
  await expect(page.getByRole('slider', { name: 'Shadow softness' })).toBeEnabled();
  await page.getByRole('combobox', { name: 'Shadow quality' }).selectOption('2048');
  expect(await sun()).toMatchObject({ shadowMode: 'filtered', mapSize: 2048 });
  await page.reload();
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  expect(await sun()).toMatchObject({ azimuth: 50, softness: 4, shadowMode: 'filtered', mapSize: 2048 });
  const toggle = page.getByRole('checkbox', { name: 'Cast on ground and trees' });
  await toggle.uncheck();
  await expect(page.getByRole('slider', { name: 'Sun direction' })).toBeDisabled();
  await toggle.check();
  await page.getByRole('button', { name: 'Reset sun' }).click();
  expect(await sun()).toMatchObject({ azimuth: 230, elevation: 40, shadowMode: 'contact', mapSize: 1024 });
  await page.goto('/#/foliage?tab=bush');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('checkbox', { name: 'Cast on ground and trees' })).toHaveCount(0);
});
