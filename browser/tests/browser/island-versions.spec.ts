import { expect, test } from '@playwright/test';

test('frozen V1 and live V2 have independent links, settings and navigation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#/island?version=v1&seed=902479&paused=1');
  const frame = page.frameLocator('.island-version-frame');
  await expect(page.getByRole('combobox', { name: 'Island version' })).toHaveValue('v1');
  await expect(frame.locator('.stage canvas')).toBeVisible();
  await expect(frame.getByRole('spinbutton', { name: 'Seed', exact: true })).toHaveValue('902479');
  await expect(page.locator('iframe')).toHaveAttribute('src', /versions\/island-v1\/index.html/);
  const original = await frame.locator('.stage canvas').screenshot();
  await page.getByRole('combobox', { name: 'Island version' }).selectOption('v2');
  await expect(frame.locator('[data-study="landform"]')).toHaveAttribute('data-ready', 'true');
  await frame.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect.poll(() => page.url()).toContain('projection=compare');
  await expect.poll(() => page.url()).toContain('version=v2');
  await page.getByRole('combobox', { name: 'Island version' }).selectOption('v1');
  await expect(frame.locator('.stage canvas')).toBeVisible();
  await expect(frame.getByRole('spinbutton', { name: 'Seed', exact: true })).toHaveValue('902479');
  expect((await frame.locator('.stage canvas').screenshot()).equals(original)).toBe(true);
  await page.goBack();
  await expect(page.getByRole('combobox', { name: 'Island version' })).toHaveValue('v2');
  await expect(frame.locator('figure canvas')).toHaveCount(2);
  await page.reload();
  await expect(frame.locator('[data-study="landform"]')).toHaveAttribute('data-ready', 'true');
  await expect(frame.locator('figure canvas')).toHaveCount(2);
  await frame.getByRole('link', { name: 'Island Explorer', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Island version' })).toHaveValue('v1');
  await expect(frame.locator('.stage canvas')).toBeVisible();
  await frame.getByRole('link', { name: 'Landform study', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Island version' })).toHaveValue('v2');
  await expect(frame.locator('[data-study="landform"]')).toHaveAttribute('data-ready', 'true');
  expect(errors).toEqual([]);
});

test('legacy study links, build journal, keyboard and narrow layout remain usable', async ({ page }) => {
  await page.goto('/#/island?study=landform&projection=compare&seed=902479');
  const frame = page.frameLocator('.island-version-frame');
  await expect(page.getByRole('combobox', { name: 'Island version' })).toHaveValue('v2');
  await expect(frame.locator('figure canvas')).toHaveCount(2);
  await page.getByText('Build journal', { exact: true }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('row', { name: /V2 · Landform/ })).toContainText('In review');
  await expect(page.getByRole('row', { name: /Elevation transitions/ })).toContainText('Not built yet');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('table')).toBeHidden();
  await page.getByText('Build journal', { exact: true }).click();
  await frame.getByRole('region', { name: 'Landform preview', exact: true }).click({ position: { x: 20, y: 20 } });
  await expect(page.getByRole('table')).toBeHidden();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByText('Build journal', { exact: true }).click();
    await expect(page.getByRole('table')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape');
  }
  await page.getByRole('combobox', { name: 'Island version' }).focus();
  await expect(page.getByRole('combobox', { name: 'Island version' })).toBeFocused();
});

test('unknown versions fail explicitly and Home remains outside the version shell', async ({ page }) => {
  await page.goto('/#/island?version=v9');
  await expect(page.getByRole('alert')).toContainText('Unknown island version: v9');
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.getByRole('link', { name: 'Open V1', exact: true }).click();
  const frame = page.frameLocator('.island-version-frame');
  await expect(frame.locator('.stage canvas')).toBeVisible();
  await frame.getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'a long table', exact: true })).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
});
