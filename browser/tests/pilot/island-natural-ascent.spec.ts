import { expect, test } from '@playwright/test';

for (const seed of [153025, 12, 77, 71]) {
  test(`default open-flank ascent retains focus, layers and projections on seed ${seed}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/#/island?seed=${seed}&water=still&shadowQuality=512`);
    const canvas = page.locator('[data-island-surface="true"]');
    await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
    await expect(canvas).toHaveAttribute('data-natural-ascent', 'placed');
    await expect(canvas).toHaveAttribute('data-natural-ascent-profile', 'open-flank');
    await expect(canvas).toHaveAttribute('data-presentation', 'webgl');
    const kinds = (await canvas.getAttribute('data-ascent-kinds'))!.split(',');
    const steps = (await canvas.getAttribute('data-ascent-steps'))!.split(',').map(Number);
    const id = kinds.indexOf('gully');
    expect(kinds.filter(kind => kind === 'gully')).toHaveLength(1);
    expect(steps[id]).toBe(0);
    expect(steps.every((count, index) => index === id || count >= 4)).toBe(true);
    const grades = (await canvas.getAttribute('data-ascent-grades'))!.split(',').map(Number);
    expect(grades[id]).toBeLessThanOrEqual(1 / 3 + 0.000001);
    await expect(page.getByText(/^Open-flank ascent:/)).toBeVisible();
    await page.getByRole('button', { name: `Focus ascent ${id + 1}`, exact: true }).click();
    await expect(canvas).toHaveAttribute('data-focus-ascent', String(id));
    await page.getByRole('button', { name: 'Solo Uplands', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-visible-layers', 'uplands');
    for (let view = 1; view <= 4; view++) {
      await page.getByRole('button', { name: 'Rotate island right', exact: true }).click();
      await expect(canvas).toHaveAttribute('data-view', String(view % 4));
      await expect(canvas).toHaveAttribute('data-turning', 'false');
    }
    await page.locator('.p-stage').screenshot({ path: testInfo.outputPath('open-flank-uplands.png') });
    await page.getByRole('button', { name: 'Reset layers', exact: true }).click();
    await page.getByRole('button', { name: 'Elevation plan', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-projection', 'plan');
    await expect(canvas).toHaveAttribute('data-ascent-kinds', kinds.join(','));
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.reload();
    await expect(canvas).toHaveAttribute('data-natural-ascent-profile', 'open-flank');
    await expect(canvas).toHaveAttribute('data-ascent-kinds', kinds.join(','));
    expect(errors).toEqual([]);
  });
}

for (const legacy of ['', '&relief=original&ascent=stairs', '&relief=lower&ascent=natural']) {
  test(`one final island replaces comparison state in ${legacy || 'the default route'}`, async ({ page }) => {
    await page.goto(`/#/island?seed=77&water=still&shadowQuality=512${legacy}`);
    const canvas = page.locator('[data-island-surface="true"]');
    await expect(canvas).toHaveAttribute('data-elevation-heights', '0,16,24,32');
    await expect(canvas).toHaveAttribute('data-maximum-height', '32');
    await expect(canvas).toHaveAttribute('data-natural-ascent', 'placed');
    await expect(canvas).not.toHaveAttribute('data-relief');
    await expect(page.getByRole('combobox', { name: 'Upland heights', exact: true })).toHaveCount(0);
    await expect(page).not.toHaveURL(/[?&](relief|ascent)=/);
    const triangles = await canvas.getAttribute('data-triangles');
    const kinds = await canvas.getAttribute('data-ascent-kinds');
    await page.getByRole('button', { name: 'Elevation plan', exact: true }).click();
    await page.reload();
    await expect(canvas).toHaveAttribute('data-elevation-heights', '0,16,24,32');
    await expect(canvas).toHaveAttribute('data-ascent-kinds', kinds!);
    await expect(canvas).toHaveAttribute('data-triangles', triangles!);
    await page.locator('.p-primary-controls').getByRole('button', { name: 'Generate', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-seed', '78');
    const heights = (await canvas.getAttribute('data-elevation-heights'))!.split(',').map(Number);
    expect(heights.at(-1)).toBeLessThanOrEqual(32);
    expect(heights.slice(1).every((height, index) => height - heights[index] <= 16)).toBe(true);
    await expect(page).not.toHaveURL(/[?&](relief|ascent)=/);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}

test('unknown relief settings fail explicitly', async ({ page }) => {
  await page.goto('/#/island?seed=77&relief=unknown');
  await expect(page.getByRole('alert')).toContainText('Unknown island relief setting.');
});

test('unknown ascent settings fail explicitly', async ({ page }) => {
  await page.goto('/#/island?seed=77&ascent=unknown');
  await expect(page.getByRole('alert')).toContainText('Unknown island ascent setting.');
});

test('default generation keeps the original stairs and explains an unsupported raised site', async ({ page }) => {
  await page.goto('/#/island?seed=7&water=still&shadowQuality=512');
  const canvas = page.locator('[data-island-surface="true"]');
  await expect(canvas).toHaveAttribute('data-natural-ascent', 'unsupported');
  await expect(canvas).toHaveAttribute('data-natural-ascent-profile', 'none');
  await expect(page.getByText('No supported open-flank ascent on this seed. Existing stairs are retained.', { exact: true })).toBeVisible();
  await expect(canvas).not.toHaveAttribute('data-ascent-kinds', /gully/);
});

test('open-flank focus remains keyboard accessible on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/island?seed=153025&water=still&shadowQuality=512');
  const canvas = page.locator('[data-island-surface="true"]');
  await expect(canvas).toHaveAttribute('data-natural-ascent-profile', 'open-flank');
  const focus = page.getByRole('button', { name: 'Focus ascent 1', exact: true });
  await focus.focus();
  await page.keyboard.press('Enter');
  await expect(canvas).toHaveAttribute('data-focus-ascent', '0');
  await expect(page.locator('.landform-canvas-frame')).toBeFocused();
  await expect(page.locator('.p-primary-controls').getByRole('button', { name: 'Generate', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => ({
    page: document.documentElement.scrollWidth > innerWidth,
    panel: [...document.querySelectorAll('.p-panel-scroll')].some(node => node.scrollWidth > node.clientWidth),
  }))).toEqual({ page: false, panel: false });
});
