import { expect, test } from '@playwright/test';
import { presentationImage } from './island-presentation';

for (const seed of [77, 153025]) {
  test(`stepped seabed ${seed} renders in water and remains inspectable from every side`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/#/island?seed=${seed}&water=still&shadowQuality=512`);
    const canvas = page.locator('[data-island-surface="true"]');
    await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
    await expect(canvas).toHaveAttribute('data-presentation', 'webgl');
    await expect(canvas).toHaveAttribute('data-seabed-cell-size', '2');
    expect(Number(await canvas.getAttribute('data-seabed-fragments'))).toBeGreaterThan(0);
    const baseline = await presentationImage(canvas);
    const land = await canvas.getAttribute('data-source-triangles');
    const steps = await canvas.getAttribute('data-ascent-steps');
    const seabed = await canvas.getAttribute('data-seabed-triangles');
    expect(Number(seabed)).toBeLessThan(Number(await canvas.getAttribute('data-seabed-source-triangles')) * 0.5);
    await page.locator('.island-ocean-scene').screenshot({ path: testInfo.outputPath('normal-water.png') });

    await page.getByRole('button', { name: 'Solo Seabed', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-visible-layers', 'seabed');
    expect(await presentationImage(canvas)).not.toBe(baseline);
    for (let view = 0; view < 4; view++) {
      await expect(canvas).toHaveAttribute('data-view', String(view));
      await expect(canvas).toHaveAttribute('data-turning', 'false');
      await page.locator('.island-ocean-scene').screenshot({ path: testInfo.outputPath(`solo-${view}.png`) });
      await expect(canvas).toHaveAttribute('data-source-triangles', land!);
      await expect(canvas).toHaveAttribute('data-ascent-steps', steps!);
      await expect(canvas).toHaveAttribute('data-seabed-triangles', seabed!);
      await page.getByRole('button', { name: 'Rotate island right', exact: true }).click();
    }
    await expect(canvas).toHaveAttribute('data-view', '0');
    await expect(canvas).toHaveAttribute('data-turning', 'false');
    await page.locator('[data-layer-card="seabed"] summary').click();
    for (const label of ['Surface normals', 'Mesh boundaries', 'Wireframe']) {
      const control = page.getByRole('checkbox', { name: `Seabed ${label}`, exact: true });
      await control.check();
      expect(await presentationImage(canvas)).not.toBe(baseline);
      await control.uncheck();
    }
    await page.getByRole('checkbox', { name: 'Base layer', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Beaches layer', exact: true }).check();
    await expect(canvas).toHaveAttribute('data-visible-layers', 'base,beaches,seabed');
    await page.locator('.island-ocean-scene').screenshot({ path: testInfo.outputPath('exposed-coast.png') });
    await page.getByRole('button', { name: 'Reset layers', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-visible-layers', 'base,uplands,beaches,seabed,water');
    expect(await presentationImage(canvas)).toBe(baseline);
    await page.reload();
    await expect(canvas).toHaveAttribute('data-seabed-triangles', seabed!);
    expect(await presentationImage(canvas)).toBe(baseline);
    expect(errors).toEqual([]);
  });
}
