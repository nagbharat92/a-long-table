import { expect, test } from '@playwright/test';
import { presentationImage } from './island-presentation';

for (const seed of [153028, 153035]) {
  test(`green tops retain flat patch colours without grass marks on seed ${seed}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/#/island?version=v2&seed=${seed}&view=2&water=still&groundMask=0`);
    const canvas = page.locator('[data-island-surface="true"]');
    await expect(canvas).toHaveAttribute('data-presentation', 'webgl');
    const triangles = await canvas.getAttribute('data-triangles');
    const baseline = await presentationImage(canvas);
    for (const layer of ['Base', 'Uplands']) {
      await page.getByText(`Inspect ${layer.toLowerCase()}`, { exact: true }).click();
      await page.getByRole('checkbox', { name: `${layer} Textures`, exact: true }).uncheck();
    }
    await expect(canvas).toHaveAttribute('data-triangles', triangles!);
    await expect(canvas).toHaveAttribute('data-grass-count', '0');
    for (const layer of ['Base', 'Uplands']) {
      await page.getByRole('checkbox', { name: `${layer} Textures`, exact: true }).check();
    }
    await expect.poll(() => presentationImage(canvas)).toBe(baseline);
    await page.getByRole('checkbox', { name: 'Ground patch mask', exact: true }).check();
    await expect(canvas).toHaveAttribute('data-lighting', 'unlit-ground-mask');
    await page.getByRole('checkbox', { name: 'Ground patch mask', exact: true }).uncheck();
    await expect.poll(() => presentationImage(canvas)).toBe(baseline);
    await page.reload();
    await expect(canvas).toHaveAttribute('data-presentation', 'webgl');
    await expect.poll(() => presentationImage(canvas)).toBe(baseline);
    expect(errors).toEqual([]);
  });
}
