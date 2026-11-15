import { expect, test } from '@playwright/test';
import { presentationImage, presentationPixels } from './island-presentation';

test('normal grass colours receive visible shadows on GPU without changing geometry or masks', async ({ page }) => {
  await page.goto('/#/island?version=v2&seed=153028&water=still&groundMask=0&sunElevation=15&shadowMode=hard');
  const canvas = page.locator('[data-island-surface="true"]');
  await expect(canvas).toHaveAttribute('data-presentation', 'webgl');
  await expect(canvas).toHaveAttribute('data-lighting', 'directional-ambient-shadow');
  await expect(canvas).toHaveAttribute('data-grass-count', '0');
  const triangles = await canvas.getAttribute('data-triangles');
  const shadowed = await presentationPixels(canvas);
  const original = await presentationImage(canvas);
  await page.getByRole('slider', { name: 'Shadow strength', exact: true }).fill('0');
  await expect.poll(() => presentationImage(canvas)).not.toBe(original);
  const clear = await presentationPixels(canvas);
  let shadowedGrass = 0;
  const grassIndices: number[] = [];
  for (let i = 0; i < clear.length; i += 4) {
    if (clear[i + 3] !== 255 || clear[i + 1] <= clear[i + 2] + 20 || clear[i] <= clear[i + 2] + 10) continue;
    grassIndices.push(i);
    const difference = [0, 1, 2].reduce((sum, channel) => sum + clear[i + channel] - shadowed[i + channel], 0);
    if (difference > 30) shadowedGrass++;
  }
  expect(shadowedGrass).toBeGreaterThan(100);
  await page.getByRole('slider', { name: 'Sun intensity', exact: true }).fill('0');
  await page.getByRole('slider', { name: 'Sky fill', exact: true }).fill('0');
  await expect.poll(async () => {
    const dark = await presentationPixels(canvas);
    return grassIndices.filter(i => dark[i] || dark[i + 1] || dark[i + 2]).length;
  }).toBe(0);
  await expect(canvas).toHaveAttribute('data-triangles', triangles!);
  await page.getByRole('checkbox', { name: 'Ground patch mask', exact: true }).check();
  await expect(canvas).toHaveAttribute('data-lighting', 'unlit-ground-mask');
});

test('ground mask is reversible, persists and works in GPU and elevation-plan views', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#/island?version=v2&seed=153028&water=still');
  const canvas = page.locator('[data-island-surface="true"]');
  await expect(canvas).toHaveAttribute('data-presentation', 'webgl');
  await expect(canvas).toHaveAttribute('data-texturing', 'projected-tiles');
  const baseline = await presentationImage(canvas);
  const triangles = await canvas.getAttribute('data-triangles');
  const toggle = page.getByRole('checkbox', { name: 'Ground patch mask', exact: true });
  await toggle.check();
  await expect(canvas).toHaveAttribute('data-ground-mask', 'true');
  await expect(canvas).toHaveAttribute('data-lighting', 'unlit-ground-mask');
  await expect(canvas).toHaveAttribute('data-grass-count', '0');
  expect(await presentationImage(canvas)).not.toBe(baseline);
  await toggle.uncheck();
  await expect(canvas).toHaveAttribute('data-texturing', 'projected-tiles');
  expect(await presentationImage(canvas)).toBe(baseline);
  await toggle.check();
  await page.reload();
  await expect(toggle).toBeChecked();
  await expect(canvas).toHaveAttribute('data-ground-mask', 'true');
  await page.getByRole('button', { name: 'Elevation plan', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-ground-mask', 'true');
  await expect(canvas).toHaveAttribute('data-presentation', 'cpu');
  const colours = await canvas.evaluate((element: HTMLCanvasElement) => {
    const pixels = element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data;
    let white = 0, offWhite = 0, lightGrey = 0, grey = 0, darkGrey = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] === 255 && pixels[i + 1] === 255 && pixels[i + 2] === 255) white++;
      if (pixels[i] === 245 && pixels[i + 1] === 245 && pixels[i + 2] === 245) offWhite++;
      if (pixels[i] === 233 && pixels[i + 1] === 233 && pixels[i + 2] === 233) lightGrey++;
      if (pixels[i] === 120 && pixels[i + 1] === 120 && pixels[i + 2] === 120) grey++;
      if (pixels[i] === 64 && pixels[i + 1] === 64 && pixels[i + 2] === 64) darkGrey++;
    }
    return { white, offWhite, lightGrey, grey, darkGrey };
  });
  expect(colours.white).toBeGreaterThan(10000);
  expect(colours.offWhite).toBeGreaterThan(1000);
  expect(colours.lightGrey).toBe(0);
  expect(colours.grey).toBeGreaterThan(200);
  expect(colours.darkGrey).toBe(0);
  await page.getByRole('button', { name: 'Elevated oblique', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-presentation', 'webgl');
  await expect(canvas).toHaveAttribute('data-triangles', triangles!);
  await page.getByRole('link', { name: 'Landform study', exact: true }).click();
  await expect(page.locator('.pilot')).toHaveAttribute('data-study', 'landform');
  await page.getByRole('link', { name: 'Whole island', exact: true }).click();
  await expect(toggle).toBeChecked();
  await expect(canvas).toHaveAttribute('data-ground-mask', 'true');
  expect(errors).toEqual([]);
});
