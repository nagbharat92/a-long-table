import { expect, test } from '@playwright/test';

test('Generate advances through the formerly failing seed 71', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#/island?version=v2&study=landform&source=island&seed=70&projection=oblique&appearance=environment&water=animated');
  const canvas = page.locator('.p-stage canvas:not(.island-ocean-backdrop):not(.island-orbit-canvas)');
  await expect(canvas).toHaveAttribute('data-seed', '70');
  const generate = page.locator('.p-primary-controls').getByRole('button', { name: 'Generate', exact: true });
  for (const seed of [71, 72]) {
    await generate.click();
    await expect(canvas).toHaveAttribute('data-seed', String(seed));
    await expect(page).toHaveURL(new RegExp(`seed=${seed}(?:&|$)`));
    await expect(page.getByText('The study needs attention', { exact: true })).toHaveCount(0);
    const triangles = Number(await canvas.getAttribute('data-triangles'));
    expect(triangles).toBeGreaterThan(0);
    expect(triangles).toBeLessThan(Number(await canvas.getAttribute('data-source-triangles')));
  }
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
  test(`whole island uses only the shared UI at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/#/island?version=v2&study=landform&source=island&seed=41&projection=oblique');
    await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('.p-panel')).toHaveCount(1);
    await expect(page.locator('.runtime, .runtime-header, .inspector, .island-version-bar')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /frozen V1/ })).toHaveCount(0);
    const canvas = page.locator('.p-stage canvas:not(.island-ocean-backdrop):not(.island-orbit-canvas)');
    await expect(page.locator('.island-orbit-canvas')).toBeVisible();
    await expect(canvas).toHaveAttribute('data-presentation','webgl');
    await expect(canvas).toHaveAttribute('data-seed', '41');
    const triangles = Number(await canvas.getAttribute('data-triangles'));
    expect(triangles).toBeGreaterThan(0);
    // Curved beaches retain their non-coplanar faces; only coplanar faces merge.
    expect(triangles).toBeLessThan(Number(await canvas.getAttribute('data-source-triangles')));
    const primary = page.locator('.p-primary-controls').getByRole('button', { name: 'Generate', exact: true });
    await expect(primary).toBeInViewport();
    await primary.click();
    await expect(canvas).toHaveAttribute('data-seed', '42');
    await page.getByLabel('Island seed', { exact: true }).fill('12');
    await page.getByRole('button', { name: 'Use seed', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-seed', '12');
    await page.getByRole('button', { name: 'Elevation plan', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-projection', 'plan');
    await expect(page).toHaveURL(/version=v2.*source=island.*seed=12/);
    const before = await primary.boundingBox();
    await page.locator('.p-panel-scroll').evaluate(node => { node.scrollTop = node.scrollHeight; });
    expect(await primary.boundingBox()).toEqual(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.getByRole('link', { name: 'Landform study', exact: true }).click();
    await expect(page.locator('.pilot')).toHaveAttribute('data-study', 'landform');
    await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
    await page.getByRole('link', { name: 'Whole island', exact: true }).click();
    await expect(page.locator('.pilot')).toHaveAttribute('data-study', 'island-landform');
    await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
    await page.getByRole('link', { name: 'View V1 with this seed', exact: true }).click();
    await expect(page.locator('.pilot')).toHaveAttribute('data-world-version', 'v1');
    await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('.p-stage canvas:not(.island-ocean-backdrop):not(.island-orbit-canvas)')).toBeVisible();
    await expect(page.locator('.runtime, .inspector')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
