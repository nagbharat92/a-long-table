import { expect, test } from '@playwright/test';
import { presentationImage } from './island-presentation';

for (const seed of [12, 71, 77, 91, 153025, 902479]) {
  test(`normal generation includes procedural coast geometry on seed ${seed}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/#/island?seed=${seed}&water=still`);
    const canvas = page.locator('[data-island-surface="true"]');
    await expect(page.locator('.pilot')).toHaveAttribute('data-world-version', 'v2');
    await expect(canvas).toHaveAttribute('data-coast', 'procedural');
    await expect(canvas).toHaveAttribute('data-seed', String(seed));
    const coves = Number(await canvas.getAttribute('data-coast-coves'));
    const beaches = Number(await canvas.getAttribute('data-coast-beaches'));
    expect(coves + beaches).toBeGreaterThan(0);
    await expect(page.getByRole('combobox', { name: 'Shore treatment', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Focus (cove|narrow shore)$/ })).toHaveCount(0);
    const path = testInfo.outputPath(`procedural-coast-${seed}.png`);
    await page.locator('.island-ocean-scene').screenshot({ path });
    await testInfo.attach(`procedural-coast-${seed}`, { path, contentType: 'image/png' });
    expect(errors).toEqual([]);
  });
}

test('Generate, reload, old study URLs and edge settings all retain normal procedural coasts', async ({ page }) => {
  await page.goto('/#/island?version=v2&source=island&seed=153025&coast=coordinated&water=still');
  const canvas = page.locator('[data-island-surface="true"]');
  await expect(canvas).toHaveAttribute('data-coast', 'procedural');
  expect(page.url()).not.toContain('coast=coordinated');
  const image = await presentationImage(canvas);
  const counts = await Promise.all(['data-coast-coves', 'data-coast-beaches'].map(name => canvas.getAttribute(name)));
  const attributes = ['data-elevation-heights', 'data-ascent-kinds', 'data-ascent-steps', 'data-sun-azimuth', 'data-sun-elevation'];
  const before = await Promise.all(attributes.map(name => canvas.getAttribute(name)));
  const oldLink = new URL(page.url());
  oldLink.hash = oldLink.hash.replace('edges=grid', 'edges=conditioned');
  await page.goto(oldLink.href);
  await page.reload();
  await expect(canvas).toHaveAttribute('data-terrace-edges', 'grid');
  await expect(page.getByRole('checkbox', { name: 'Condition terrace edges', exact: true })).toHaveCount(0);
  await expect(canvas).toHaveAttribute('data-coast', 'procedural');
  expect(await Promise.all(['data-coast-coves', 'data-coast-beaches'].map(name => canvas.getAttribute(name)))).toEqual(counts);
  expect(await presentationImage(canvas)).toBe(image);
  expect(await Promise.all(attributes.map(name => canvas.getAttribute(name)))).toEqual(before);
  await page.reload();
  await expect(canvas).toHaveAttribute('data-coast', 'procedural');
  expect(await presentationImage(canvas)).toBe(image);
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-seed', '153026');
  await expect(canvas).toHaveAttribute('data-coast', 'procedural');
  await expect(page.getByRole('combobox', { name: 'Shore treatment', exact: true })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('normal coast generation works on narrow screens with the existing geometry diagnostics', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/island?seed=77&water=still&projection=plan');
  const canvas = page.locator('[data-island-surface="true"]');
  await expect(canvas).toHaveAttribute('data-coast', 'procedural');
  for (const name of ['Projection checker', 'Triangle wireframe']) {
    await page.getByRole('checkbox', { name, exact: true }).check();
  }
  await expect(canvas).toHaveAttribute('data-checker', 'true');
  await expect(canvas).toHaveAttribute('data-wireframe', 'true');
  expect(await page.evaluate(() => ({
    page: document.documentElement.scrollWidth > innerWidth,
    panel: [...document.querySelectorAll('.p-panel-scroll')].some(node => node.scrollWidth > node.clientWidth),
  }))).toEqual({ page: false, panel: false });
  await expect(page.getByRole('alert')).toHaveCount(0);
});
