import { expect, test } from '@playwright/test';

test('one island combines a natural flank ascent and true stairs with focused geometry inspection', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#/island?version=v2&source=island&seed=77&water=still');
  const canvas = page.locator('[data-island-surface="true"]');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  await expect(canvas).toHaveAttribute('data-ascents', /^\d+$/);
  await expect(canvas).toHaveAttribute('data-ascent-footprints', 'orthogonal');
  expect(Number(await canvas.getAttribute('data-ascents'))).toBeGreaterThanOrEqual(3);
  const kinds = (await canvas.getAttribute('data-ascent-kinds'))!.split(',');
  expect(kinds.filter(kind => kind === 'gully')).toHaveLength(1);
  expect(kinds.every(kind => kind === 'gully' || kind === 'stairs' || kind === 'terraced')).toBe(true);
  const steps = (await canvas.getAttribute('data-ascent-steps'))!.split(',').map(Number);
  expect(steps.every((count, index) => kinds[index] === 'gully' ? count === 0 : count >= 4)).toBe(true);
  await expect(page.getByText('Smooth ramp', { exact: false })).toHaveCount(0);
  const triangles = await canvas.getAttribute('data-triangles');
  expect(Number(triangles)).toBeLessThan(Number(await canvas.getAttribute('data-source-triangles')) * 0.3);
  await page.getByRole('button', { name: 'Focus ascent 2', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-focus-ascent', '1');
  expect(Number(await canvas.getAttribute('data-magnification'))).toBeGreaterThanOrEqual(3);
  const frame = page.locator('.landform-canvas-frame');
  const scroll = await frame.evaluate(node => node.scrollLeft + node.scrollTop);
  expect(scroll).toBeGreaterThan(0);
  for (const label of ['Projection checker', 'Triangle wireframe']) {
    await page.getByRole('checkbox', { name: label, exact: true }).check();
    await expect(canvas).toHaveAttribute('data-triangles', triangles!);
  }
  await page.getByRole('button', { name: 'Current axes', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-focus-ascent', '1');
  await expect(canvas).toHaveAttribute('data-triangles', triangles!);
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await expect(canvas).not.toHaveAttribute('data-focus-ascent');
  expect(Number(await canvas.getAttribute('data-magnification'))).toBeLessThan(3);
  await page.reload();
  await expect(canvas).toHaveAttribute('data-ascent-kinds', kinds.join(','));
  await expect(canvas).toHaveAttribute('data-ascent-steps', steps.join(','));
  expect(errors).toEqual([]);
});

for (const seed of [12, 41, 71, 77, 91, 153025, 902479]) {
  test(`Uplands and ascents remain usable in full and solo views on seed ${seed}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/#/island?seed=${seed}&water=still&shadowQuality=512`);
    const canvas = page.locator('[data-island-surface="true"]');
    await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
    await expect(canvas).toHaveAttribute('data-presentation', 'webgl');
    await expect(canvas).toHaveAttribute('data-terrace-edges', 'grid');
    await expect(canvas).toHaveAttribute('data-conditioned-corners', '0');
    await expect(canvas).toHaveAttribute('data-ascent-footprints', seed === 41 ? 'rectangular' : 'orthogonal');
    const steps = await canvas.getAttribute('data-ascent-steps');
    if (Number(await canvas.getAttribute('data-ascents')) > 0) {
      await page.getByRole('button', { name: 'Focus ascent 1', exact: true }).click();
      await expect(canvas).toHaveAttribute('data-focus-ascent', '0');
      await page.locator('.p-stage').screenshot({ path: testInfo.outputPath('focused-ascent.png') });
      await page.getByRole('button', { name: 'Fit', exact: true }).click();
    } else {
      await expect(page.getByText('This island is flat; no ascent is needed.', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Focus ascent/ })).toHaveCount(0);
    }
    const baseline = await canvas.getAttribute('data-triangles');
    await page.getByRole('button', { name: 'Solo Uplands', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-visible-layers', 'uplands');
    await page.getByRole('checkbox', { name: 'Projection checker', exact: true }).check();
    for (let view = 0; view < 4; view++) {
      await expect(canvas).toHaveAttribute('data-view', String(view));
      await expect(canvas).toHaveAttribute('data-ascent-steps', steps!);
      await page.getByRole('button', { name: 'Rotate island right', exact: true }).click();
    }
    await expect(canvas).toHaveAttribute('data-view', '0');
    await expect(canvas).toHaveAttribute('data-turning', 'false');
    await page.locator('.p-stage').screenshot({ path: testInfo.outputPath('solo-uplands.png') });
    await page.getByRole('checkbox', { name: 'Projection checker', exact: true }).uncheck();
    await page.getByRole('button', { name: 'Reset layers', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-visible-layers', 'base,uplands,beaches,seabed,water');
    await expect(canvas).toHaveAttribute('data-triangles', baseline!);
    await expect(canvas).toHaveAttribute('data-presentation', 'webgl');
    await page.getByRole('button', { name: 'Elevation plan', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-projection', 'plan');
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('ascent focus and readouts are keyboard accessible without displacing Generate on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/island?version=v2&source=island&seed=91&water=still');
  const canvas = page.locator('[data-island-surface="true"]');
  await expect(canvas).toHaveAttribute('data-ascents', /^\d+$/);
  expect(Number(await canvas.getAttribute('data-ascents'))).toBeGreaterThanOrEqual(2);
  const primary = page.locator('.p-primary-controls').getByRole('button', { name: 'Generate', exact: true });
  const position = await primary.boundingBox();
  const focus = page.getByRole('button', { name: 'Focus ascent 1', exact: true });
  await focus.focus();
  await page.keyboard.press('Enter');
  await expect(canvas).toHaveAttribute('data-focus-ascent', '0');
  await expect(primary).toBeInViewport();
  expect(await primary.boundingBox()).toEqual(position);
  await expect(page.locator('.landform-canvas-frame')).toBeFocused();
  expect(await page.evaluate(() => ({
    page: document.documentElement.scrollWidth > innerWidth,
    panel: [...document.querySelectorAll('.p-panel-scroll')].some(node => node.scrollWidth > node.clientWidth),
  }))).toEqual({ page: false, panel: false });
});
