import { expect, test } from '@playwright/test';

test('study stays isolated, compares the same fixture and preserves review settings', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const scripts: string[] = [];
  page.on('request', request => { if (request.resourceType() === 'script') scripts.push(request.url()); });
  await page.goto('/?islandEmbed=v2#/island?study=landform&seed=902479');
  await expect(page.locator('[data-study="landform"]')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('heading', { name: 'Landform study', exact: true })).toBeVisible();
  expect(scripts.some(url => /phaser|game-view|reference-data/.test(url))).toBe(false);
  await expect(page.getByRole('button', { name: 'Elevated oblique', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(page.locator('figure canvas')).toHaveCount(2);
  const fixtures = await page.locator('figure canvas').evaluateAll(canvases => canvases.map(canvas => (canvas as HTMLCanvasElement).dataset.fixture));
  expect(fixtures[0]).toBe(fixtures[1]);
  await page.getByRole('checkbox', { name: 'Rabbit scale', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Behind-cliff probe', exact: true }).check();
  for (const canvas of await page.locator('figure canvas').all()) {
    expect(Number(await canvas.getAttribute('data-probe-hidden'))).toBeGreaterThan(0);
  }
  await page.getByRole('button', { name: 'Junction close-up', exact: true }).click();
  await expect(page.locator('figure canvas').first()).toHaveAttribute('width', '112');
  await page.getByRole('button', { name: 'Elevation plan', exact: true }).click();
  await expect(page.locator('figure canvas')).toHaveCount(1);
  await expect(page.getByRole('status')).toContainText('not a walkable route');
  await expect(page.getByRole('button', { name: 'Compare', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Blockout', exact: true }).click();
  await expect(page.locator('figure canvas')).toHaveCount(2);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const url = page.url();
  await page.reload();
  await expect(page.locator('[data-study="landform"]')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('checkbox', { name: 'Behind-cliff probe', exact: true })).toBeChecked();
  await expect(page.locator('figure canvas')).toHaveCount(2);
  expect(page.url()).toBe(url);
  await page.getByRole('link', { name: 'Island Explorer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Island Explorer', exact: true })).toBeVisible();
  await expect(page.locator('.stage canvas')).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'Seed', exact: true })).toHaveValue('902479');
  await page.getByRole('link', { name: 'Landform study', exact: true }).click();
  await expect(page.locator('[data-study="landform"]')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('alert')).toBeHidden();
  expect(errors).toEqual([]);
});

test('study is keyboard accessible and fits desktop, narrow and dark presentations', async ({ page }) => {
  await page.goto('/?islandEmbed=v2#/island?study=landform');
  await expect(page.locator('[data-study="landform"]')).toHaveAttribute('data-ready', 'true');
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 960, height: 850 }, { width: 390, height: 844 }, { width: 320, height: 780 }]) {
    await page.setViewportSize(viewport);
    await page.getByRole('button', { name: 'Fit study', exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await expect(page.getByRole('button', { name: 'Elevated oblique', exact: true })).toBeInViewport();
    const metrics = await page.locator('figure canvas').evaluate(canvas => {
      const frame = canvas.parentElement!;
      return { width: canvas.clientWidth, height: canvas.clientHeight, frameWidth: frame.clientWidth, frameHeight: frame.clientHeight };
    });
    expect(metrics.width).toBeLessThanOrEqual(metrics.frameWidth);
    expect(metrics.height).toBeLessThanOrEqual(metrics.frameHeight);
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(page.locator('figure canvas')).toHaveCount(2);
    await page.getByRole('button', { name: 'Elevated oblique', exact: true }).click();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('link', { name: 'Island Explorer', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Zoom out', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeFocused();
  await page.goto('/?scoutTheme=dark&islandEmbed=v2#/island?study=landform');
  await expect(page.locator('[data-study="landform"]')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('alert')).toBeHidden();
});

test('invalid study settings report an error rather than rendering a different fixture', async ({ page }) => {
  await page.goto('/?islandEmbed=v2#/island?study=landform&projection=unknown');
  await expect(page.getByRole('alert')).toContainText('Unknown landform study setting');
  await expect(page.locator('canvas')).toHaveCount(0);
});
