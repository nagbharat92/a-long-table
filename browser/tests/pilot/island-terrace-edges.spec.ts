import { expect, test } from '@playwright/test';
import { presentationImage } from './island-presentation';

test('square terrace edges persist through old chamfer links, diagnostics, generation and study navigation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#/island?version=v2&source=island&seed=77&water=still&edges=conditioned&shadowQuality=512');
  const canvas = page.locator('[data-island-surface="true"]');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('checkbox', { name: 'Condition terrace edges', exact: true })).toHaveCount(0);
  await expect(canvas).toHaveAttribute('data-terrace-edges', 'grid');
  await expect(canvas).toHaveAttribute('data-conditioned-corners', '0');
  await expect(canvas).toHaveAttribute('data-ascent-footprints', 'orthogonal');
  expect(page.url()).toContain('edges=grid');
  const original = await presentationImage(canvas);
  const heights = await canvas.getAttribute('data-elevation-heights');
  const kinds = await canvas.getAttribute('data-ascent-kinds');
  const steps = await canvas.getAttribute('data-ascent-steps');
  for (const label of ['Projection checker', 'Triangle wireframe']) {
    const control = page.getByRole('checkbox', { name: label, exact: true });
    await control.check();
    await expect(canvas).toHaveAttribute('data-terrace-edges', 'grid');
    await control.uncheck();
  }
  expect(await presentationImage(canvas)).toBe(original);
  await expect(canvas).toHaveAttribute('data-elevation-heights', heights!);
  await expect(canvas).toHaveAttribute('data-ascent-kinds', kinds!);
  await expect(canvas).toHaveAttribute('data-ascent-steps', steps!);
  await page.reload();
  await expect(canvas).toHaveAttribute('data-terrace-edges', 'grid');
  expect(await presentationImage(canvas)).toBe(original);
  await page.getByRole('link', { name: 'Landform study', exact: true }).click();
  await expect(page.locator('.pilot')).toHaveAttribute('data-study', 'landform');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('link', { name: 'Whole island', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-terrace-edges', 'grid');
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-seed', '78');
  await expect(canvas).toHaveAttribute('data-terrace-edges', 'grid');
  const natural = await canvas.getAttribute('data-natural-ascent');
  await expect(canvas).toHaveAttribute('data-ascent-footprints', natural === 'placed' ? 'orthogonal' : 'rectangular');
  expect(errors).toEqual([]);
});

test('square terrain retains keyboard diagnostics and pinned controls on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/island?version=v2&source=island&seed=91&water=still');
  const canvas = page.locator('[data-island-surface="true"]');
  await expect(canvas).toHaveAttribute('data-terrace-edges', 'grid');
  await expect(canvas).toHaveAttribute('data-conditioned-corners', '0');
  const generate = page.locator('.p-primary-controls').getByRole('button', { name: 'Generate', exact: true });
  const position = await generate.boundingBox();
  const control = page.getByRole('checkbox', { name: 'Triangle wireframe', exact: true });
  await control.focus();
  await page.keyboard.press('Space');
  await expect(control).toBeChecked();
  await expect(canvas).toHaveAttribute('data-terrace-edges', 'grid');
  await expect(generate).toBeInViewport();
  expect(await generate.boundingBox()).toEqual(position);
  expect(await page.evaluate(() => ({
    page: document.documentElement.scrollWidth > innerWidth,
    panel: [...document.querySelectorAll('.p-panel-scroll')].some(node => node.scrollWidth > node.clientWidth),
  }))).toEqual({ page: false, panel: false });
});
