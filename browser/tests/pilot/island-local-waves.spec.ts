import { expect, test } from '@playwright/test';

test('local water visibly covers and exposes sand at the default island camera', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#/island?seed=153025&version=v2&water=still&shadowQuality=512');
  const surface = page.locator('[data-island-surface="true"]');
  const canvas = page.locator('.island-orbit-canvas');
  await expect(surface).toHaveAttribute('data-presentation', 'webgl');
  expect(Number(await canvas.getAttribute('data-shore-wave-triangles'))).toBeGreaterThan(1000);
  const original = await canvas.evaluate((node: HTMLCanvasElement) => {
    const gl = node.getContext('webgl')!;
    const data = new Uint8Array(node.width * node.height * 4);
    gl.readPixels(0, 0, node.width, node.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return [...data];
  });
  const geometry = await surface.getAttribute('data-triangles');
  await page.getByRole('button', { name: 'Animate water', exact: true }).click();
  const covered: number[] = [];
  for (let frame = 0; frame < 9; frame++) {
    await page.waitForTimeout(640);
    covered.push(await canvas.evaluate((node: HTMLCanvasElement, before) => {
      const gl = node.getContext('webgl')!;
      const data = new Uint8Array(before.length);
      gl.readPixels(0, 0, node.width, node.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
      let changed = 0;
      for (let i = 0; i < data.length; i += 4) {
        const sand = before[i] > 145 && before[i] > before[i + 1] + 5 && before[i + 1] > before[i + 2] + 15;
        if (sand && [0, 1, 2].some(c => Math.abs(data[i + c] - before[i + c]) >= 20)) changed++;
      }
      return changed;
    }, original));
    if ([0, 1, 2, 3].includes(frame)) await canvas.screenshot({ path: testInfo.outputPath(`local-wave-${frame}.png`) });
  }
  console.info(`Default-camera sand coverage: ${JSON.stringify(covered)}`);
  expect(Math.max(...covered)).toBeGreaterThan(50);
  expect(Math.max(...covered) - Math.min(...covered)).toBeGreaterThan(30);
  await page.getByRole('button', { name: 'Pause water', exact: true }).click();
  const frozen = await canvas.evaluate((node: HTMLCanvasElement) => node.toDataURL());
  await page.waitForTimeout(300);
  expect(await canvas.evaluate((node: HTMLCanvasElement) => node.toDataURL())).toBe(frozen);
  await expect(surface).toHaveAttribute('data-triangles', geometry!);
  expect(errors).toEqual([]);
});

for (const seed of [153025, 71, 902479]) {
  test(`water finish stays attached at fit and close zoom for seed ${seed}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/#/island?seed=${seed}&version=v2&water=animated&shadowQuality=512`);
    const surface = page.locator('[data-island-surface="true"]');
    await expect(surface).toHaveAttribute('data-presentation', 'webgl');
    await expect.poll(async () => Number(await surface.getAttribute('data-water-time'))).toBeGreaterThan(1.2);
    await page.getByRole('button', { name: 'Pause water', exact: true }).click();
    const clock = await surface.getAttribute('data-water-time');
    const triangles = await surface.getAttribute('data-triangles');
    const fit = Number(await surface.getAttribute('data-magnification'));
    const scene = page.locator('.island-ocean-scene');
    await scene.screenshot({ path: testInfo.outputPath(`water-${seed}-fit.png`) });
    for (const _ of [0, 1]) await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    expect(Number(await surface.getAttribute('data-magnification'))).toBeGreaterThan(fit);
    for (const view of [0, 1, 2, 3]) {
      if (view) {
        await page.getByRole('button', { name: 'Rotate island right', exact: true }).click();
        await expect(surface).toHaveAttribute('data-turning', 'false');
        await expect(surface).toHaveAttribute('data-view', String(view));
      }
      await expect(surface).toHaveAttribute('data-triangles', triangles!);
      await expect(surface).toHaveAttribute('data-water-time', clock!);
      await scene.screenshot({ path: testInfo.outputPath(`water-${seed}-close-view-${view}.png`) });
    }
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    expect(Number(await surface.getAttribute('data-magnification'))).toBeCloseTo(fit, 8);
    expect(errors).toEqual([]);
  });
}
