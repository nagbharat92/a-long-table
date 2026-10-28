import { expect, test, type Page } from '@playwright/test';

interface PlayState {
  seed: number;
  berries: number;
  elapsed: number;
  paused: boolean;
  character: { selected: boolean; position: { x: number; y: number } };
  bushes: { id: string; state: string; position: { x: number; y: number } }[];
  camera: { zoom: number; scrollX: number; scrollY: number };
}

async function state(page: Page): Promise<PlayState> {
  return page.evaluate(() => window.__pilot!.snapshot() as PlayState);
}

async function worldClick(page: Page, point: { x: number; y: number }): Promise<void> {
  const screen = await page.evaluate(point => window.__pilot!.worldToScreen!(point), point);
  await page.mouse.click(screen.x, screen.y);
}

test('real selection, movement and gathering update the HUD and bush', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#/play?seed=42');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  const before = await state(page);
  expect(before.character.selected).toBe(false);
  await worldClick(page, { x: before.character.position.x, y: before.character.position.y - 6 });
  await expect.poll(async () => (await state(page)).character.selected).toBe(true);
  const closest = [...before.bushes].sort((a, b) =>
    Math.hypot(a.position.x - before.character.position.x, a.position.y - before.character.position.y)
      - Math.hypot(b.position.x - before.character.position.x, b.position.y - before.character.position.y))[0];
  await worldClick(page, { x: closest.position.x, y: closest.position.y - 4.5 });
  await expect.poll(async () => (await state(page)).berries, { timeout: 20000 }).toBe(3);
  await expect(page.getByLabel('Berries collected')).toContainText('3');
  const after = await state(page);
  expect(after.bushes.find(bush => bush.id === closest.id)?.state).toBe('depleted');
  expect(after.character.position).not.toEqual(before.character.position);
  expect(errors).toEqual([]);
});

test('panel tools leave the scene running and preserve its camera', async ({ page }) => {
  await page.goto('/#/play?seed=42');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  await page.getByText('Preview settings', { exact: true }).click();
  const before = await state(page);
  await page.waitForTimeout(300);
  const after = await state(page);
  expect(after.elapsed).toBeGreaterThan(before.elapsed);
  expect(after.camera).toEqual(before.camera);
  await page.getByRole('button', { name: 'Line / outlined' }).click();
  await expect(page.locator('.pilot')).toHaveAttribute('data-skin', 'line');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await state(page)).camera).toEqual(before.camera);
  await expect.poll(async () => (await state(page)).elapsed).toBeGreaterThan(after.elapsed);
});

test('pause state survives using panel tools and invalid seed preserves the current island', async ({ page }) => {
  await page.goto('/#/play?seed=42&paused=1');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Island seed').fill('bad seed');
  await page.getByRole('button', { name: 'Open seed', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Your current island has not changed');
  const before = await state(page);
  await page.waitForTimeout(200);
  expect((await state(page)).elapsed).toBe(before.elapsed);
  expect(before.seed).toBe(42);
  expect(before.paused).toBe(true);
});

test('HUD text and important control boundaries have measured contrast', async ({ page }) => {
  await page.goto('/#/play?seed=42&paused=1');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  const ratios = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const luminance = (token: string) => {
      const hex = style.getPropertyValue(token).trim().slice(1);
      const components = [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
        .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return components[0] * .2126 + components[1] * .7152 + components[2] * .0722;
    };
    const ratio = (a: string, b: string) => {
      const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
      return (values[0] + .05) / (values[1] + .05);
    };
    return {
      text: ratio('--game-paper', '--game-ink'),
      muted: ratio('--game-muted', '--game-ink'),
      selected: ratio('--game-active', '--game-deep'),
      boundary: ratio('--game-edge', '--game-ink'),
      caption: ratio('--game-deep', '--game-stage'),
    };
  });
  expect(ratios.text).toBeGreaterThanOrEqual(4.5);
  expect(ratios.muted).toBeGreaterThanOrEqual(4.5);
  expect(ratios.selected).toBeGreaterThanOrEqual(4.5);
  expect(ratios.boundary).toBeGreaterThanOrEqual(3);
  expect(ratios.caption).toBeGreaterThanOrEqual(4.5);
});

for (const viewport of [{ width: 1440, height: 960 }, { width: 1280, height: 800 }]) {
  test(`Play reserves the scene beside one right panel at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/#/play?seed=42&paused=1');
    await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
    const stage = await page.locator('.p-stage').boundingBox();
    const panel = await page.getByRole('complementary', { name: 'Study controls' }).boundingBox();
    expect(stage).toMatchObject({ x: 0, y: 0, width: viewport.width - panel!.width, height: viewport.height });
    expect(panel).toMatchObject({ x: stage!.width, y: 0, height: viewport.height });
    await expect(page.getByRole('button', { name: 'Generate island' })).toBeVisible();
    await expect(page.locator('.runtime-header,.runtime-footer,.inspector')).toHaveCount(0);
    await expect(page.locator('.p-tray')).not.toBeVisible();
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight);
    expect(overflows).toBe(false);
  });
}
