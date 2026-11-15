import { expect, test } from '@playwright/test';
import { presentationImage } from './island-presentation';

test('normal liquid surface animates, pauses, survives turns, and retains its inspection setting', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#/island?seed=153025&water=animated&shadowQuality=512');
  const surface = page.locator('[data-island-surface="true"]');
  const gpu = page.locator('.island-orbit-canvas');
  await expect(surface).toHaveAttribute('data-water-surface', 'normal-sky');
  await expect(surface).toHaveAttribute('data-presentation', 'webgl');
  const triangles = await surface.getAttribute('data-triangles');
  await expect.poll(async () => Number(await surface.getAttribute('data-water-time'))).toBeGreaterThan(0.2);
  await page.getByRole('button', { name: 'Pause water', exact: true }).click();
  const pausedTime = await surface.getAttribute('data-water-time');
  const still = await presentationImage(surface);
  await page.waitForTimeout(300);
  expect(await presentationImage(surface)).toBe(still);
  await gpu.screenshot({ path: testInfo.outputPath('water-surface-view-one.png') });
  await page.getByRole('button', { name: 'Animate water', exact: true }).click();
  await expect.poll(() => presentationImage(surface)).not.toBe(still);
  await page.getByRole('button', { name: 'Pause water', exact: true }).click();
  const beforeTurn = await surface.getAttribute('data-water-time');
  for (const view of [1, 2, 3, 0]) {
    await page.getByRole('button', { name: 'Rotate island right', exact: true }).click();
    await expect(surface).toHaveAttribute('data-turning', 'false');
    await expect(surface).toHaveAttribute('data-view', String(view));
    await expect(surface).toHaveAttribute('data-triangles', triangles!);
    await expect(surface).toHaveAttribute('data-water-time', beforeTurn!);
    await gpu.screenshot({ path: testInfo.outputPath(`water-surface-view-${view}.png`) });
  }
  await page.getByText('Inspect water', { exact: true }).click();
  const response = page.getByRole('checkbox', { name: 'Water Surface ripples and sheen', exact: true });
  await expect(response).toBeChecked();
  await response.uncheck();
  await expect(surface).toHaveAttribute('data-water-surface', 'flat');
  await expect(page.getByRole('button', { name: 'Animate water', exact: true })).toBeEnabled();
  const wash = page.getByRole('checkbox', { name: 'Water Beach wash and foam', exact: true });
  await expect(wash).toBeChecked();
  await wash.uncheck();
  await expect(surface).toHaveAttribute('data-beach-wash', 'off');
  await page.getByRole('checkbox', { name: 'Water Color patches', exact: true }).uncheck();
  await expect(page.getByRole('button', { name: 'Water motion off', exact: true })).toBeDisabled();
  await page.reload();
  await expect(surface).toHaveAttribute('data-water-surface', 'flat');
  await page.getByText('Inspect water', { exact: true }).click();
  await expect(wash).not.toBeChecked();
  await response.check();
  await expect(surface).toHaveAttribute('data-water-surface', 'normal-sky');
  await expect(page.getByRole('button', { name: 'Animate water', exact: true })).toBeEnabled();
  expect(Number(beforeTurn)).toBeGreaterThanOrEqual(Number(pausedTime));
  expect(errors).toEqual([]);
});

test('software fallback retains full-scene surface response and exact pause', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: function (this: HTMLCanvasElement, ...args: unknown[]) {
      if (this.matches('.island-orbit-canvas') && args[0] === 'webgl') return null;
      return Reflect.apply(original, this, args);
    } });
  });
  await page.goto('/#/island?seed=153025&water=still&shadowQuality=512');
  const surface = page.locator('[data-island-surface="true"]');
  const backdrop = page.locator('.island-ocean-backdrop');
  await expect(surface).toHaveAttribute('data-presentation', 'cpu');
  await expect(surface).toHaveAttribute('data-water-surface', 'normal-sky');
  await expect(backdrop).toBeVisible();
  const before = await presentationImage(surface);
  const oceanBefore = await backdrop.evaluate((node: HTMLCanvasElement) => node.toDataURL());
  await page.getByRole('button', { name: 'Animate water', exact: true }).click();
  await expect.poll(() => presentationImage(surface)).not.toBe(before);
  await expect.poll(() => backdrop.evaluate((node: HTMLCanvasElement) => node.toDataURL())).not.toBe(oceanBefore);
  await page.getByRole('button', { name: 'Pause water', exact: true }).click();
  const paused = await presentationImage(surface);
  const oceanPaused = await backdrop.evaluate((node: HTMLCanvasElement) => node.toDataURL());
  await page.waitForTimeout(300);
  expect(await presentationImage(surface)).toBe(paused);
  expect(await backdrop.evaluate((node: HTMLCanvasElement) => node.toDataURL())).toBe(oceanPaused);
  await page.locator('.island-ocean-scene').screenshot({ path: testInfo.outputPath('water-surface-software.png') });
});
