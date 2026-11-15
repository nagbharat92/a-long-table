import { expect, test } from '@playwright/test';
import { presentationImage } from './island-presentation';

test('whole-island diagnostics are independent, reversible and retained across projection, seed and reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#/island?version=v2&source=island&seed=12&water=still');
  const canvas = page.locator('[data-island-surface="true"]');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  const pixels = () => presentationImage(canvas);
  const original = await pixels();
  const triangles = await canvas.getAttribute('data-triangles');
  const sourceTriangles = Number(await canvas.getAttribute('data-source-triangles'));
  expect(Number(triangles)).toBeLessThan(sourceTriangles * 0.4);
  await expect(page.getByLabel('Mesh triangle count', { exact: true })).toContainText(`${Number(triangles).toLocaleString('en-US')} triangles`);
  const checker = page.getByRole('checkbox', { name: 'Projection checker', exact: true });
  const wireframe = page.getByRole('checkbox', { name: 'Triangle wireframe', exact: true });
  await checker.check();
  await expect(canvas).toHaveAttribute('data-lighting', 'unlit-checker');
  await expect(canvas).toHaveAttribute('data-grass-count', '0');
  const checkerPixels = await pixels();
  expect(checkerPixels).not.toBe(original);
  await wireframe.check();
  expect(await pixels()).not.toBe(checkerPixels);
  await expect(canvas).toHaveAttribute('data-triangles', triangles!);
  await checker.uncheck();
  await expect(wireframe).toBeChecked();
  expect(await pixels()).not.toBe(original);
  await wireframe.uncheck();
  expect(await pixels()).toBe(original);
  await checker.check();
  await wireframe.check();
  for (const label of ['Current axes', 'Elevation plan', 'Elevated oblique']) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(canvas).toHaveAttribute('data-checker', 'true');
    await expect(canvas).toHaveAttribute('data-wireframe', 'true');
  }
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-seed', '13');
  await page.reload();
  await expect(checker).toBeChecked();
  await expect(wireframe).toBeChecked();
  await expect(canvas).toHaveAttribute('data-seed', '13');
  await page.getByRole('link', { name: 'Landform study', exact: true }).click();
  await expect(page.locator('.pilot')).toHaveAttribute('data-study', 'landform');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  await expect(checker).toBeChecked();
  await expect(wireframe).toBeChecked();
  await expect(page.locator('.p-stage canvas')).toHaveAttribute('data-checker', 'true');
  await expect(page.locator('.p-stage canvas')).toHaveAttribute('data-wireframe', 'true');
  await page.getByRole('link', { name: 'Whole island', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-checker', 'true');
  await expect(canvas).toHaveAttribute('data-wireframe', 'true');
  await expect(canvas).toHaveAttribute('data-seed', '13');
  expect(errors).toEqual([]);
});

test('study diagnostics cover comparison figures, generated shapes and elevation plans', async ({ page }) => {
  await page.goto('/#/island?version=v2&study=landform&source=reference&projection=compare&checker=1&wireframe=1');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.p-stage canvas[data-checker="true"][data-wireframe="true"]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Single island', exact: true }).click();
  await expect(page.locator('.p-stage canvas[data-checker="true"][data-wireframe="true"]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Elevation plan', exact: true }).click();
  await expect(page.locator('.p-stage canvas[data-projection="plan"][data-checker="true"][data-wireframe="true"]')).toHaveCount(1);
});

test('diagnostic controls remain accessible and do not displace Generate on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/island?version=v2&source=island&seed=71&water=still');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  const generate = page.locator('.p-primary-controls').getByRole('button', { name: 'Generate', exact: true });
  const position = await generate.boundingBox();
  const checker = page.getByRole('checkbox', { name: 'Projection checker', exact: true });
  await checker.focus();
  await page.keyboard.press('Space');
  await expect(checker).toBeChecked();
  await expect(generate).toBeInViewport();
  expect(await generate.boundingBox()).toEqual(position);
  expect(await page.evaluate(() => ({
    page: document.documentElement.scrollWidth > innerWidth,
    panel: [...document.querySelectorAll('.p-panel-scroll')].some(node => node.scrollWidth > node.clientWidth),
  }))).toEqual({ page: false, panel: false });
});

test('disconnected mesh layers and per-layer inspection controls isolate layers and persist across seeds', async ({ page }) => {
  await page.goto('/#/island?version=v2&source=island&seed=153025&water=still');
  const canvas = page.locator('[data-island-surface="true"]');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  await expect(canvas).toHaveAttribute('data-visible-layers', 'base,uplands,beaches,seabed,water');
  const pixels = () => presentationImage(canvas);
  const fullIsland = await pixels();

  const soloUplands = page.getByRole('button', { name: 'Solo Uplands', exact: true });
  await soloUplands.click();
  await expect(canvas).toHaveAttribute('data-visible-layers', 'uplands');
  const uplandsOnly = await pixels();
  expect(uplandsOnly).not.toBe(fullIsland);

  await page.locator('[data-layer-card="uplands"] summary').click();
  const uplandsWireframe = page.getByRole('checkbox', { name: 'Uplands Wireframe', exact: true });
  const uplandsBoundaries = page.getByRole('checkbox', { name: 'Uplands Mesh boundaries', exact: true });
  const uplandsVertices = page.getByRole('checkbox', { name: 'Uplands Vertices', exact: true });
  await uplandsWireframe.check();
  await uplandsBoundaries.check();
  await uplandsVertices.check();
  const uplandsInspected = await pixels();
  expect(uplandsInspected).not.toBe(uplandsOnly);

  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-seed', '153026');
  await expect(canvas).toHaveAttribute('data-visible-layers', 'uplands');
  await expect(uplandsWireframe).toBeChecked();
  await expect(uplandsBoundaries).toBeChecked();
  await expect(uplandsVertices).toBeChecked();

  await page.getByRole('button', { name: 'Reset layers', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-visible-layers', 'base,uplands,beaches,seabed,water');
});

test('hiding meshes removes their ocean shadows and Reset layers restores the original presentation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#/island?version=v2&source=island&seed=77&water=still&sunElevation=10&shadowMode=hard&shadowQuality=512');
  const canvas = page.locator('[data-island-surface="true"]');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  await expect(canvas).toHaveAttribute('data-presentation', 'webgl');
  const original = await presentationImage(canvas);
  for (const name of ['Base', 'Uplands', 'Beaches', 'Seabed']) {
    await page.getByRole('checkbox', { name: `${name} layer`, exact: true }).uncheck();
  }
  await expect(canvas).toHaveAttribute('data-visible-layers', 'water');
  const waterOnly = await presentationImage(canvas);
  await page.getByRole('button', { name: 'Reset layers', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-visible-layers', 'base,uplands,beaches,seabed,water');
  expect(await presentationImage(canvas)).toBe(original);

  const unshadowed = new URL(page.url());
  const params = new URLSearchParams(unshadowed.hash.split('?')[1]);
  params.set('shadowStrength', '0');
  params.set('layers', 'base:visible=0;uplands:visible=0;beaches:visible=0;seabed:visible=0');
  unshadowed.hash = `/island?${params}`;
  await page.goto(unshadowed.href);
  await page.reload();
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  await expect(canvas).toHaveAttribute('data-visible-layers', 'water');
  expect(await presentationImage(canvas)).toBe(waterOnly);
  expect(errors).toEqual([]);
});

test('square-corner defaults and Base infill remain reversible across visibility combinations', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#/island?seed=153025&water=still&shadowQuality=512');
  const canvas = page.locator('[data-island-surface="true"]');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  await expect(canvas).toHaveAttribute('data-presentation', 'webgl');
  await expect(canvas).toHaveAttribute('data-terrace-edges', 'grid');
  await expect(canvas).toHaveAttribute('data-conditioned-corners', '0');
  const baseline = await presentationImage(canvas);
  const sourceTriangles = await canvas.getAttribute('data-source-triangles');
  await page.getByRole('button', { name: 'Solo Base', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-visible-layers', 'base');
  const baseOnly = await presentationImage(canvas);
  await page.locator('.p-stage').screenshot({ path: testInfo.outputPath('solo-base.png') });
  await page.locator('[data-layer-card="base"] summary').click();
  const wireframe = page.getByRole('checkbox', { name: 'Base Wireframe', exact: true });
  await wireframe.check();
  expect(await presentationImage(canvas)).not.toBe(baseOnly);
  await wireframe.uncheck();
  expect(await presentationImage(canvas)).toBe(baseOnly);

  await page.getByRole('checkbox', { name: 'Beaches layer', exact: true }).check();
  await expect(canvas).toHaveAttribute('data-visible-layers', 'base,beaches');
  const beachesVisible = await presentationImage(canvas);
  expect(beachesVisible).not.toBe(baseOnly);
  await page.getByRole('checkbox', { name: 'Uplands layer', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Beaches layer', exact: true }).uncheck();
  await expect(canvas).toHaveAttribute('data-visible-layers', 'base,uplands');
  expect(await presentationImage(canvas)).not.toBe(baseOnly);
  await page.locator('.p-stage').screenshot({ path: testInfo.outputPath('base-with-uplands.png') });
  await page.getByRole('checkbox', { name: 'Uplands layer', exact: true }).uncheck();
  expect(await presentationImage(canvas)).toBe(baseOnly);
  await expect(canvas).toHaveAttribute('data-source-triangles', sourceTriangles!);
  await page.getByRole('button', { name: 'Reset layers', exact: true }).click();
  expect(await presentationImage(canvas)).toBe(baseline);
  await page.locator('.p-stage').screenshot({ path: testInfo.outputPath('all-layers.png') });
  await page.reload();
  await expect(canvas).toHaveAttribute('data-terrace-edges', 'grid');
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-seed', '153026');
  await expect(canvas).toHaveAttribute('data-terrace-edges', 'grid');
  await page.getByRole('button', { name: 'Solo Base', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-visible-layers', 'base');
  await expect(canvas).toHaveAttribute('data-presentation', 'webgl');
  expect(errors).toEqual([]);
});
