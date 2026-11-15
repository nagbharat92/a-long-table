import { expect, test } from '@playwright/test';
import { presentationImage } from './island-presentation';

for (const seed of [77, 153025]) {
  test(`partial Upland shoulders ${seed} remain attached and inspectable through all four views`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/#/island?seed=${seed}&water=still&shadowQuality=512`);
    const canvas = page.locator('[data-island-surface="true"]');
    await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
    await expect(canvas).toHaveAttribute('data-presentation', 'webgl');
    await expect(canvas).toHaveAttribute('data-upland-shoulders', '1');
    const baseline = await presentationImage(canvas);
    const steps = await canvas.getAttribute('data-ascent-steps'), beach = await canvas.getAttribute('data-beaches-triangles');
    const bed = await canvas.getAttribute('data-seabed-triangles');
    await page.locator('.island-ocean-scene').screenshot({ path: testInfo.outputPath('normal.png') });
    await page.getByRole('button', { name: 'Solo Uplands', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-visible-layers', 'uplands');
    await page.locator('[data-layer-card="uplands"] summary').click();
    for (let view = 0; view < 4; view++) {
      await expect(canvas).toHaveAttribute('data-view', String(view));
      await expect(canvas).toHaveAttribute('data-turning', 'false');
      await page.locator('.island-ocean-scene').screenshot({ path: testInfo.outputPath(`solo-${view}.png`) });
      await expect(canvas).toHaveAttribute('data-ascent-steps', steps!);
      await expect(canvas).toHaveAttribute('data-beaches-triangles', beach!);
      await expect(canvas).toHaveAttribute('data-seabed-triangles', bed!);
      await page.getByRole('button', { name: 'Rotate island right', exact: true }).click();
    }
    await expect(canvas).toHaveAttribute('data-view', '0');
    await expect(canvas).toHaveAttribute('data-turning', 'false');
    for (const label of ['Mesh boundaries', 'Surface normals', 'Wireframe']) {
      const input = page.getByRole('checkbox', { name: `Uplands ${label}`, exact: true });
      const plain = await presentationImage(canvas);
      await input.check();
      expect(await presentationImage(canvas)).not.toBe(plain);
      await input.uncheck();
    }
    await page.getByRole('button', { name: 'Reset layers', exact: true }).click();
    expect(await presentationImage(canvas)).toBe(baseline);
    await page.getByRole('checkbox', { name: 'Uplands layer', exact: true }).uncheck();
    await expect(canvas).toHaveAttribute('data-visible-layers', 'base,beaches,seabed,water');
    await page.getByRole('checkbox', { name: 'Uplands layer', exact: true }).check();
    expect(await presentationImage(canvas)).toBe(baseline);
    await page.reload();
    await expect(canvas).toHaveAttribute('data-upland-shoulders', '1');
    expect(await presentationImage(canvas)).toBe(baseline);
    expect(errors).toEqual([]);
  });
}
