import { expect, test } from '@playwright/test';
import { presentationImage, presentationPixels } from './island-presentation';

for (const seed of [12, 41, 902479]) {
  test(`V2 environment preserves seed ${seed} while switching appearance and projection`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/#/island?version=v2&source=island&seed=${seed}&water=still`);
    const canvas = page.locator('[data-island-surface="true"]');
    await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
    await expect(canvas).toHaveAttribute('data-appearance', 'environment');
    await expect(canvas).toHaveAttribute('data-lighting', 'directional-ambient-shadow');
    await expect(canvas).toHaveAttribute('data-grass-count', '0');
    const pixels = await presentationPixels(canvas);
    expect(pixels.filter((value,i) => i%4 === 2 && value > pixels[i-1]).length).toBeGreaterThan(1000);
    const triangles = await canvas.getAttribute('data-triangles');
    await page.getByRole('button', { name: 'Blockout', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-appearance', 'blockout');
    await expect(canvas).toHaveAttribute('data-triangles', triangles!);
    await expect(page.getByRole('button', { name: 'Animate water', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Environment', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-appearance', 'environment');
    await page.getByRole('button', { name: 'Current axes', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-projection', 'current');
    await expect(canvas).toHaveAttribute('data-grass-count', '0');
    await expect(canvas).toHaveAttribute('data-seed', String(seed));
    await page.getByRole('button', { name: 'Elevation plan', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-projection', 'plan');
    await expect(canvas).toHaveAttribute('data-grass-count', '0');
    await expect(page.getByRole('button', { name: 'Animate water', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Elevated oblique', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-lighting', 'directional-ambient-shadow');
    await page.reload();
    await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
    await expect(canvas).toHaveAttribute('data-seed', String(seed));
    await expect(canvas).toHaveAttribute('data-appearance', 'environment');
    expect(errors).toEqual([]);
  });
}

test('water pauses exactly and releases its animation when leaving the island', async ({ page }) => {
  await page.goto('/#/island?version=v2&source=island&seed=12&water=animated&layers=water:surfaceHighlights=1,waves=1,shoreFoam=1');
  const canvas = page.locator('[data-island-surface="true"]');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  await expect.poll(async () => Number(await canvas.getAttribute('data-water-time'))).toBeGreaterThan(0.1);
  await page.getByRole('button', { name: 'Pause water', exact: true }).click();
  const pausedTime = await canvas.getAttribute('data-water-time');
  const pixels = () => presentationImage(canvas);
  const pausedPixels = await pixels();
  await page.waitForTimeout(300);
  expect(await canvas.getAttribute('data-water-time')).toBe(pausedTime);
  expect(await pixels()).toBe(pausedPixels);
  await page.getByRole('button', { name: 'Animate water', exact: true }).click();
  await expect.poll(pixels).not.toBe(pausedPixels);
  const detached = await canvas.elementHandle();
  await page.getByRole('navigation', { name: 'Project', exact: true }).getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page.locator('.pilot')).toHaveAttribute('data-route', 'home');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  const stoppedTime = await detached!.evaluate(node => node.dataset.waterTime);
  await page.waitForTimeout(300);
  expect(await detached!.evaluate(node => node.dataset.waterTime)).toBe(stoppedTime);
});

test('reduced motion starts water still and controls fit on a narrow screen', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/island?version=v2&source=island&seed=41');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('button', { name: 'Animate water', exact: true })).toBeEnabled();
  const primary = page.locator('.p-primary-controls').getByRole('button', { name: 'Generate', exact: true });
  const before = await primary.boundingBox();
  await page.locator('.p-panel-scroll').evaluate(node => { node.scrollTop = node.scrollHeight; });
  expect(await primary.boundingBox()).toEqual(before);
  await expect(primary).toBeInViewport();
  expect(await page.evaluate(() => ({
    page: document.documentElement.scrollWidth > innerWidth,
    controls: [...document.querySelectorAll('.p-panel-scroll')].some(node => node.scrollWidth > node.clientWidth),
  }))).toEqual({ page: false, controls: false });
});
