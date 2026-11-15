import { expect, test } from '@playwright/test';
import { presentationImage, presentationPixels } from './island-presentation';

for (const seed of [12, 41, 71, 902479]) {
  test(`beach-aware shore remains attached across projections and diagnostics for seed ${seed}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/#/island?version=v2&source=island&seed=${seed}&water=still`);
    const canvas = page.locator('[data-island-surface="true"]');
    await expect(canvas).toHaveAttribute('data-shoreline', 'beach-aware');
    const triangles = await canvas.getAttribute('data-triangles');
    const pixels = () => presentationImage(canvas);
    const original = await pixels();
    for (const label of ['Current axes', 'Elevated oblique']) {
      await page.getByRole('button', { name: label, exact: true }).click();
      const data = await presentationPixels(canvas);
      const colors = new Set<string>();
      for (let i = 0; i < data.length; i += 4) {
        if (data[i+2] > data[i] && data[i+1] > data[i]) colors.add(data.slice(i,i+3).join(','));
      }
      expect(colors.size).toBeGreaterThan(100);
      await expect(canvas).toHaveAttribute('data-triangles', triangles!);
    }
    expect(await pixels()).toBe(original);
    for (const label of ['Projection checker', 'Triangle wireframe', 'Material regions']) {
      const control = page.getByRole('checkbox', { name: label, exact: true });
      await control.check();
      await expect(canvas).toHaveAttribute('data-shoreline', 'beach-aware');
      await control.uncheck();
    }
    expect(await pixels()).toBe(original);
    await page.getByRole('button', { name: 'Elevation plan', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-water-pixels', '0');
    await expect(canvas).toHaveAttribute('data-foam-pixels', '0');
    await page.getByRole('button', { name: 'Elevated oblique', exact: true }).click();
    expect(await pixels()).toBe(original);
    expect(errors).toEqual([]);
  });
}

test('shoreline motion keeps the existing eight-update limit and pauses exactly', async ({ page }) => {
  await page.goto('/#/island?version=v2&source=island&seed=71&water=animated&layers=water:shoreFoam=1');
  const canvas = page.locator('[data-island-surface="true"]');
  await expect(canvas).toHaveAttribute('data-shoreline', 'beach-aware');
  await expect.poll(async () => Number(await canvas.getAttribute('data-water-time'))).toBeGreaterThan(0.1);
  const changes = await canvas.evaluate(async (node: HTMLCanvasElement) => {
    let changes = 0;
    const observer = new MutationObserver(records => { changes += records.filter(record => record.attributeName === 'data-water-time').length; });
    observer.observe(node, { attributes: true });
    await new Promise(resolve => setTimeout(resolve, 1100));
    observer.disconnect();
    return changes;
  });
  expect(changes).toBeGreaterThan(0);
  expect(changes).toBeLessThanOrEqual(9);
  await page.getByRole('button', { name: 'Pause water', exact: true }).click();
  const time = await canvas.getAttribute('data-water-time');
  const foam = await canvas.getAttribute('data-foam-pixels');
  const paused = await presentationImage(canvas);
  await page.waitForTimeout(300);
  expect(await canvas.getAttribute('data-water-time')).toBe(time);
  expect(await canvas.getAttribute('data-foam-pixels')).toBe(foam);
  expect(await presentationImage(canvas)).toBe(paused);
});

test('the shoreline remains still with reduced motion and retains the narrow-screen controls', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/island?version=v2&source=island&seed=12');
  const canvas = page.locator('[data-island-surface="true"]');
  await expect(canvas).toHaveAttribute('data-shoreline', 'beach-aware');
  const original = await presentationImage(canvas);
  await page.waitForTimeout(300);
  expect(await presentationImage(canvas)).toBe(original);
  await expect(page.getByRole('button', { name: 'Animate water', exact: true })).toBeEnabled();
  await expect(page.locator('.p-primary-controls').getByRole('button', { name: 'Generate', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
