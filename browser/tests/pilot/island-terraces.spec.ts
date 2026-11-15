import { expect, test } from '@playwright/test';

for (const [seed, heights] of [
  [902479, [0, 8]], [91, [0, 8, 16]], [152941, [0, 16, 24]], [77, [0, 16, 24, 32]],
] as const) {
  test(`V2 seed ${seed} renders its actual height composition across all views`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/#/island?version=v2&source=island&seed=${seed}&water=still`);
    const canvas = page.locator('[data-island-surface="true"]');
    await expect(canvas).toHaveAttribute('data-elevation-heights', heights.join(','));
    await expect(canvas).toHaveAttribute('data-maximum-height', String(heights.at(-1)));
    await expect(page.getByLabel('Terrace heights', { exact: true })).toHaveText(`Terraces: ${heights.join(' / ')} world units.`);
    const triangles = await canvas.getAttribute('data-triangles');
    const kinds = (await canvas.getAttribute('data-ascent-kinds'))!.split(',');
    expect(kinds.filter(kind => kind === 'gully')).toHaveLength(1);
    expect(kinds.every(kind => kind === 'stairs' || kind === 'terraced' || kind === 'gully')).toBe(true);
    for (const label of ['Current axes', 'Elevation plan', 'Elevated oblique']) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await expect(canvas).toHaveAttribute('data-elevation-heights', heights.join(','));
      await expect(canvas).toHaveAttribute('data-triangles', triangles!);
    }
    await page.getByRole('button', { name: 'Blockout', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-appearance', 'blockout');
    await page.getByRole('button', { name: 'Elevation plan', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-elevation-heights', heights.join(','));
    await page.reload();
    await expect(canvas).toHaveAttribute('data-elevation-heights', heights.join(','));
    await expect(page.getByLabel('Terrace heights', { exact: true })).toHaveText(`Terraces: ${heights.join(' / ')} world units.`);
    expect(errors).toEqual([]);
  });
}

test('flat V2 compositions remain valid and switching to V1 uses the original generator', async ({ page }) => {
  await page.goto('/#/island?version=v2&source=island&seed=41&water=still');
  const canvas = page.locator('[data-island-surface="true"]');
  await expect(canvas).toHaveAttribute('data-elevation-heights', '0');
  await expect(canvas).toHaveAttribute('data-ascents', '0');
  await expect(page.getByText('This island is flat; no ascent is needed.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'View V1 with this seed', exact: true }).click();
  await expect(page.locator('.pilot')).toHaveAttribute('data-world-version', 'v1');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByText(/Browser generator browser-seeded-highlands-v4.*seed 41/)).toBeVisible();
});

test('the full height readout fits on narrow screens and generation/reload stays reproducible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/island?version=v2&source=island&seed=77&water=still');
  const canvas = page.locator('[data-island-surface="true"]');
  await expect(canvas).toHaveAttribute('data-elevation-heights', '0,16,24,32');
  await page.getByLabel('Terrace heights', { exact: true }).scrollIntoViewIfNeeded();
  const generate = page.locator('.p-primary-controls').getByRole('button', { name: 'Generate', exact: true });
  await expect(generate).toBeInViewport();
  await generate.click();
  await expect(canvas).toHaveAttribute('data-seed', '78');
  const heights = await canvas.getAttribute('data-elevation-heights');
  expect(heights!.split(',').map(Number).every(height => height >= 0 && height <= 32 && height % 8 === 0)).toBe(true);
  await page.reload();
  await expect(canvas).toHaveAttribute('data-elevation-heights', heights!);
  expect(await page.evaluate(() => ({
    page: document.documentElement.scrollWidth > innerWidth,
    panel: [...document.querySelectorAll('.p-panel-scroll')].some(node => node.scrollWidth > node.clientWidth),
  }))).toEqual({ page: false, panel: false });
});
