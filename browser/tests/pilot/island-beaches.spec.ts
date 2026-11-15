import { expect, test } from '@playwright/test';
import { presentationImage } from './island-presentation';

for (const seed of [77, 153025]) {
  test(`complete beaches remain independently inspectable and reversible for seed ${seed}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/#/island?seed=${seed}&water=still&shadowQuality=512`);
    const canvas = page.locator('[data-island-surface="true"]');
    await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
    await expect(canvas).toHaveAttribute('data-presentation', 'webgl');
    await expect(canvas).toHaveAttribute('data-beach-profile', 'stepped');
    const baseline = await presentationImage(canvas);
    await page.locator('.island-ocean-scene').screenshot({ path: testInfo.outputPath('normal-water.png') });
    const geometry = await canvas.getAttribute('data-source-triangles');
    const ascentSteps = await canvas.getAttribute('data-ascent-steps');
    const seabed = await canvas.getAttribute('data-seabed-triangles');

    await page.getByRole('button', { name: 'Solo Beaches', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-visible-layers', 'beaches');
    expect(await presentationImage(canvas)).not.toBe(baseline);
    await page.locator('.island-ocean-scene').screenshot({ path: testInfo.outputPath('solo-0.png') });
    await page.locator('[data-layer-card="beaches"] summary').click();
    const boundaries = page.getByRole('checkbox', { name: 'Beaches Mesh boundaries', exact: true });
    await boundaries.check();
    for (let view = 1; view < 4; view++) {
      await page.getByRole('button', { name: 'Rotate island right', exact: true }).click();
      await expect(canvas).toHaveAttribute('data-view', String(view));
      await expect(canvas).toHaveAttribute('data-turning', 'false');
      await expect(boundaries).toBeChecked();
      await expect(canvas).toHaveAttribute('data-source-triangles', geometry!);
      await expect(canvas).toHaveAttribute('data-ascent-steps', ascentSteps!);
      await expect(canvas).toHaveAttribute('data-seabed-triangles', seabed!);
      await page.locator('.island-ocean-scene').screenshot({ path: testInfo.outputPath(`solo-${view}.png`) });
    }
    await page.getByRole('button', { name: 'Rotate island right', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-view', '0');
    await expect(canvas).toHaveAttribute('data-turning', 'false');
    await boundaries.uncheck();
    for (const label of ['Surface normals', 'Wireframe']) {
      const control = page.getByRole('checkbox', { name: `Beaches ${label}`, exact: true });
      const plain = await presentationImage(canvas);
      await control.check();
      expect(await presentationImage(canvas)).not.toBe(plain);
      await control.uncheck();
    }
    await page.getByRole('checkbox', { name: 'Base layer', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Seabed layer', exact: true }).check();
    await expect(canvas).toHaveAttribute('data-visible-layers', 'base,beaches,seabed');
    await page.locator('.island-ocean-scene').screenshot({ path: testInfo.outputPath('exposed-coast.png') });
    await page.getByRole('checkbox', { name: 'Beaches layer', exact: true }).uncheck();
    await expect(canvas).toHaveAttribute('data-visible-layers', 'base,seabed');
    await page.getByRole('button', { name: 'Reset layers', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-visible-layers', 'base,uplands,beaches,seabed,water');
    expect(await presentationImage(canvas)).toBe(baseline);
    await page.reload();
    await expect(canvas).toHaveAttribute('data-visible-layers', 'base,uplands,beaches,seabed,water');
    expect(errors).toEqual([]);
  });
}
