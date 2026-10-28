import { expect, test, type Page } from '@playwright/test';
import '../../src/debug';

async function layout(page: Page) {
  return page.evaluate(() => {
    const world = window.__longTable!.world;
    return { seed: world.seed, version: world.generatorVersion, levels: Array.from(world.elevations!), ramps: world.ramps };
  });
}

test('seed alone drives low islands, highlands, Reset, keyboard generation and URL replay', async ({ page }) => {
  await page.goto('/?islandEmbed=v2#/island?seed=6&paused=1');
  await page.waitForFunction(() => window.__longTable?.ready === true);
  expect((await layout(page)).levels.every(level => level === 0)).toBe(true);
  await page.getByRole('spinbutton', { name: 'Seed', exact: true }).fill('43');
  await page.getByRole('button', { name: 'Go', exact: true }).click();
  const highlands = await layout(page);
  expect(highlands.version).toBe('browser-seeded-highlands-v3-reference-coast');
  expect(new Set(highlands.levels)).toEqual(new Set([0, 1, 2]));
  await page.getByRole('button', { name: 'Reset this explorer', exact: true }).click();
  expect(await layout(page)).toEqual(highlands);
  await page.getByRole('heading', { name: 'Island Explorer', exact: true }).click();
  await page.keyboard.press('r');
  const next = await layout(page);
  expect(next.seed).toBe(7962);
  expect(next.version).toBe('browser-seeded-highlands-v3');
  const replayUrl = page.url();
  await page.goto(replayUrl);
  await page.waitForFunction(() => window.__longTable?.ready === true);
  expect(await layout(page)).toEqual(next);
  await expect(page.getByRole('alert')).toBeHidden();
});

test('island explorer keeps one top bar and a focused panel at desktop and mobile widths', async ({ page }) => {
  await page.goto('/?islandEmbed=v2#/island?seed=42&paused=1');
  await page.waitForFunction(() => window.__longTable?.ready === true);
  const header = page.locator('.runtime-header');
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  const overlays = inspector.getByRole('group', { name: 'Terrain overlays' });
  const playback = inspector.getByRole('group', { name: 'Playback controls' });
  const seed = inspector.getByRole('spinbutton', { name: 'Seed', exact: true });
  await expect(page.locator('.runtime > .toolbar, .runtime-footer, .brand')).toHaveCount(0);
  await expect(header.locator('.toolbar')).toHaveCount(1);
  await expect(header.getByRole('heading')).toHaveText('Island Explorer');
  await expect(header.getByRole('button')).toHaveCount(3);
  await expect(inspector).toHaveCount(1);
  await expect(inspector.getByRole('heading')).toHaveText(['Island', 'View']);
  await expect(inspector.locator('p, dl')).toHaveCount(0);
  await expect(inspector.locator('input')).toHaveCount(1);
  await expect(inspector.getByRole('combobox')).toHaveCount(0);
  await expect(inspector.getByRole('slider')).toHaveCount(0);
  await expect(overlays.getByRole('button')).toHaveText(['Levels', 'Walkability']);
  await expect(inspector.getByRole('form')).toHaveAttribute('title', 'Browser generator browser-seeded-highlands-v3-reference-coast · seed 42');
  await expect(inspector.getByLabel('Terrain details')).toBeEmpty();

  for (const viewport of [{ width: 1280, height: 850 }, { width: 320, height: 780 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    const geometry = await page.evaluate(() => ({
      headerBottom: document.querySelector('.runtime-header')!.getBoundingClientRect().bottom,
      stageTop: document.querySelector('.stage')!.getBoundingClientRect().top,
    }));
    expect(geometry.stageTop).toBe(geometry.headerBottom);
    await expect.poll(() => page.evaluate(() => {
      const stage = document.querySelector('.stage')!.getBoundingClientRect();
      const canvas = document.querySelector('canvas')!.getBoundingClientRect();
      return Math.abs(stage.width - canvas.width);
    })).toBeLessThanOrEqual(1);
    for (const control of [
      header.getByRole('link', { name: 'Home', exact: true }),
      ...await header.getByRole('button').all(),
      seed,
      ...await inspector.getByRole('button').all(),
    ]) {
      await expect(control).toBeInViewport({ ratio: 1 });
    }
    expect(await inspector.evaluate(panel => panel.scrollHeight <= panel.clientHeight)).toBe(true);
  }

  await page.getByRole('link', { name: 'Home', exact: true }).focus();
  await page.keyboard.press('Tab');
  for (const name of ['Zoom out', 'Zoom in', 'Fit view']) {
    await expect(header.getByRole('button', { name, exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
  }
  await expect(seed).toBeFocused();

  const fitZoom = await page.evaluate(() => window.__longTable!.view.getCameraState().zoom);
  await header.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const zoomedIn = await page.evaluate(() => window.__longTable!.view.getCameraState().zoom);
  expect(zoomedIn).toBeGreaterThan(fitZoom);
  await header.getByRole('button', { name: 'Zoom out', exact: true }).click();
  expect(await page.evaluate(() => window.__longTable!.view.getCameraState().zoom)).toBeLessThan(zoomedIn);
  await header.getByRole('button', { name: 'Fit view', exact: true }).click();
  expect(await page.evaluate(() => window.__longTable!.view.getCameraState().zoom)).toBeCloseTo(fitZoom);
  for (const name of ['Levels', 'Walkability']) {
    const control = overlays.getByRole('button', { name, exact: true });
    await control.click();
    await expect(control).toHaveAttribute('aria-pressed', 'true');
    await control.click();
    await expect(control).toHaveAttribute('aria-pressed', 'false');
  }
  await expect(page).toHaveURL(/paused=1/);
  await playback.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__longTable!.simulation.elapsed)).toBeGreaterThan(0);
  await playback.getByRole('button', { name: 'Pause', exact: true }).click();
  const pausedTime = await page.evaluate(() => window.__longTable!.simulation.elapsed);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.__longTable!.simulation.elapsed)).toBe(pausedTime);
  await playback.getByRole('button', { name: 'Reset this explorer', exact: true }).click();
  expect(await page.evaluate(() => window.__longTable!.simulation.elapsed)).toBe(0);

  await seed.fill('-1');
  await inspector.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('whole-number seed');
  expect(await page.evaluate(() => window.__longTable!.world.seed)).toBe(42);
  await seed.fill('12345');
  await inspector.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(page.getByRole('alert')).toBeHidden();
  expect(await page.evaluate(() => window.__longTable!.world.seed)).toBe(12345);
  await expect(inspector.getByRole('form')).toHaveAttribute('title', 'Browser generator browser-seeded-highlands-v3-reference-coast · seed 12345');
  await inspector.getByRole('button', { name: 'Generate a new island', exact: true }).click();
  expect(await page.evaluate(() => window.__longTable!.world.seed)).toBe(Number(await seed.inputValue()));
  expect((await layout(page)).version).toMatch(/^browser-seeded-highlands-v3/);
  expect(await page.evaluate(() => Boolean(window.__longTable!.world.elevations?.length))).toBe(true);

  await page.setViewportSize({ width: 1280, height: 850 });
  await header.getByRole('button', { name: 'Fit view', exact: true }).click();
  const target = await page.evaluate(() => {
    const { simulation, view } = window.__longTable!;
    const point = view.worldToScreen(simulation.character.position);
    const canvas = document.querySelector('canvas')!.getBoundingClientRect();
    return { x: canvas.x + point.x, y: canvas.y + point.y };
  });
  const panelBounds = await inspector.boundingBox();
  await page.mouse.move(target.x, target.y);
  await expect(inspector.getByLabel('Terrain details')).toContainText('walkable');
  expect(await inspector.boundingBox()).toEqual(panelBounds);
  await header.getByRole('heading').hover();
  await expect(inspector.getByLabel('Terrain details')).toBeEmpty();
  expect(await inspector.boundingBox()).toEqual(panelBounds);
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page.locator('canvas')).toHaveCount(0);
  expect(await page.evaluate(() => window.__longTable)).toBeUndefined();
});
