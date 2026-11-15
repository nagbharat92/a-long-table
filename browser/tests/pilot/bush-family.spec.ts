import { expect, test } from '@playwright/test';

test('berry bush variants keep their crop and wind controls after the visual pass', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#/foliage?tab=bush&bushSeed=42&paused=1');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  const snapshot = () => page.evaluate(() => window.__pilot!.snapshot() as {
    appearance: { seed: number; shape: number; foliage: number; count: number };
    crop: { fruits: unknown[]; available: number; collected: number };
  });
  const original = await snapshot();
  for (const shape of ['Upright shrub', 'Spreading bush', 'Forked tree']) {
    await page.getByRole('group', { name: 'Shape' }).getByRole('button', { name: shape }).click();
    await page.getByRole('slider', { name: 'Berry count' }).fill('12');
    expect((await snapshot()).crop.fruits).toHaveLength(12);
  }
  for (const palette of ['Woodland', 'Sage', 'Blue spruce', 'Autumn']) {
    await page.getByRole('group', { name: 'Foliage' }).getByRole('button', { name: palette }).click();
    await expect(page.getByRole('img', { name: new RegExp(palette) })).toBeVisible();
  }
  await page.getByRole('group', { name: 'Set bush state' }).getByRole('button', { name: 'Ripe' }).click();
  await page.getByRole('button', { name: 'Gather', exact: true }).click();
  await page.getByRole('button', { name: 'Advance 1 s' }).click();
  expect((await snapshot()).crop.collected).toBe(12);
  await page.getByRole('textbox', { name: 'Bush seed' }).fill('42');
  await page.getByRole('form', { name: 'Reproduce bush' }).getByRole('button', { name: 'Apply' }).click();
  expect((await snapshot()).appearance).toEqual(original.appearance);
  expect(errors).toEqual([]);
});
