import { expect, test, type Page } from '@playwright/test';
import type { Point } from '../../src/core/contracts';
import '../../src/debug';

async function openMode(page: Page, mode: string): Promise<void> {
  await page.goto(`/#/${mode}`);
  await expect(page.locator('canvas')).toHaveCount(1);
  await page.waitForFunction(() => window.__longTable?.ready === true);
  await expect(page.getByRole('alert')).toBeHidden();
}

async function clickWorld(page: Page, point: Point): Promise<void> {
  const screen = await page.evaluate((position) => {
    const runtime = window.__longTable;
    const canvas = document.querySelector('canvas');
    if (!runtime || !canvas) throw new Error('Runtime is not ready.');
    const projected = runtime.view.worldToScreen(position);
    const bounds = canvas.getBoundingClientRect();
    return { x: bounds.x + projected.x, y: bounds.y + projected.y };
  }, point);
  await page.mouse.click(screen.x, screen.y);
}

test('home exposes all five destinations and does not run a game', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'a long table', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Play', exact: true })).toHaveAttribute('href', '#/play');
  for (const name of ['Island Explorer', 'Character Explorer', 'Foraging Explorer', 'Navigation Explorer']) {
    await expect(page.getByRole('link').filter({ has: page.getByRole('heading', { name, exact: true }) })).toBeVisible();
  }
  await expect(page.locator('canvas')).toHaveCount(0);
  expect(await page.evaluate(() => window.__longTable)).toBeUndefined();
});

test('each explorer opens directly and tears down on returning home', async ({ page }) => {
  for (const mode of ['play', 'island', 'character', 'foraging', 'navigation']) {
    await openMode(page, mode);
    expect(await page.evaluate(() => window.__longTable?.mode)).toBe(mode);
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    await expect(page.locator('canvas')).toHaveCount(0);
    expect(await page.evaluate(() => window.__longTable)).toBeUndefined();
  }
});

test('Play uses reference terrain without experimental relief and accepts mapped pointer commands', async ({ page }) => {
  await openMode(page, 'play');
  const initial = await page.evaluate(() => {
    const state = window.__longTable!;
    return {
      position: { ...state.simulation.character.position },
      selected: state.simulation.character.selected,
      relief: Boolean(state.world.elevations?.length),
      source: state.world.provenance,
    };
  });
  expect(initial.selected).toBe(false);
  expect(initial.relief).toBe(false);
  expect(initial.source).toBe('captured-reference');
  await clickWorld(page, initial.position);
  await expect.poll(() => page.evaluate(() => window.__longTable!.simulation.character.selected)).toBe(true);
  const destination = await page.evaluate(() => {
    const { simulation } = window.__longTable!;
    const from = simulation.character.position;
    const route = simulation.navigation.route(from, { x: from.x + 35, y: from.y + 14 });
    return route.at(-1)!;
  });
  await clickWorld(page, destination);
  await expect.poll(() => page.evaluate(() => window.__longTable!.simulation.character.route.length)).toBeGreaterThan(1);
  await expect.poll(() => page.evaluate((target) => {
    const position = window.__longTable!.simulation.character.position;
    return Math.hypot(position.x - target.x, position.y - target.y);
  }, destination)).toBeLessThan(0.1);
});

test('island elevation is separate, inspectable and deterministic', async ({ page }) => {
  await openMode(page, 'island?seed=42');
  const baseline = await page.evaluate(() => {
    const world = window.__longTable!.world;
    return {
      seed: world.seed,
      elevations: Array.from(new Set(world.elevations)),
      ramps: world.ramps?.length ?? 0,
      samples: Array.from(world.heights.slice(1000, 1020)),
    };
  });
  expect(baseline.elevations.sort()).toEqual([0, 1, 2]);
  expect(baseline.ramps).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Levels', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Levels', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Reset this explorer' }).click();
  expect(await page.evaluate(() => Array.from(window.__longTable!.world.heights.slice(1000, 1020)))).toEqual(baseline.samples);
  await page.getByRole('spinbutton', { name: 'Seed', exact: true }).fill('-1');
  await page.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('whole-number seed');
  expect(await page.evaluate(() => window.__longTable!.world.seed)).toBe(42);
});

test('character explorer switches shared motion without changing its ground position', async ({ page }) => {
  await openMode(page, 'character?tab=motion');
  await page.getByRole('button', { name: 'Idle', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Idle', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const position = await page.evaluate(() => ({ ...window.__longTable!.simulation.character.position }));
  await page.getByRole('button', { name: 'Shallows', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Shallows', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => window.__longTable!.simulation.character.gaitDistance)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__longTable!.simulation.character.position)).toEqual(position);
  const fitZoom = await page.evaluate(() => window.__longTable!.view.getCameraState().zoom);
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  expect(await page.evaluate(() => window.__longTable!.view.getCameraState().zoom)).toBeLessThan(fitZoom);
  await page.getByRole('button', { name: 'Fit view', exact: true }).click();
  expect(await page.evaluate(() => window.__longTable!.view.getCameraState().zoom)).toBeCloseTo(fitZoom);
});

test('character explorer has one top bar and a minimal controls panel', async ({ page }) => {
  await openMode(page, 'character?tab=motion&paused=1');
  const header = page.locator('.runtime-header');
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await expect(page.locator('.runtime > .toolbar')).toHaveCount(0);
  await expect(header.locator('.toolbar')).toHaveCount(1);
  await expect(page.locator('.runtime-footer')).toHaveCount(0);
  await expect(header.getByRole('link', { name: 'Home', exact: true })).toBeVisible();
  await expect(header.getByRole('heading', { name: 'Character Explorer', exact: true })).toBeVisible();
  await expect(header.getByRole('button')).toHaveCount(3);
  await expect(inspector).toHaveCount(1);
  await expect(inspector.getByRole('heading')).toHaveText(['Motion']);
  await expect(inspector.locator('p:visible, dl:visible')).toHaveCount(0);
  const motion = inspector.getByRole('group', { name: 'Character motion', exact: true });
  await expect(motion.getByRole('button')).toHaveText(['Idle', 'Hop', 'Shallows']);
  await expect(motion.getByRole('button', { name: 'Hop', exact: true })).toHaveAttribute('aria-pressed', 'true');

  const playback = inspector.getByRole('group', { name: 'Playback controls', exact: true });
  await expect(playback.getByRole('button', { name: 'Resume', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await playback.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__longTable!.simulation.character.animationTime)).toBeGreaterThan(0);
  await playback.getByRole('button', { name: 'Pause', exact: true }).click();
  const pausedTime = await page.evaluate(() => window.__longTable!.simulation.character.animationTime);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.__longTable!.simulation.character.animationTime)).toBe(pausedTime);
  await motion.getByRole('button', { name: 'Shallows', exact: true }).click();
  await playback.getByRole('button', { name: 'Reset this explorer', exact: true }).click();
  expect(await page.evaluate(() => window.__longTable!.simulation.character.animationTime)).toBe(0);
  await expect(motion.getByRole('button', { name: 'Shallows', exact: true })).toHaveAttribute('aria-pressed', 'true');

  for (const viewport of [{ width: 1280, height: 850 }, { width: 320, height: 780 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    const geometry = await page.evaluate(() => {
      const header = document.querySelector('.runtime-header')!.getBoundingClientRect();
      const stage = document.querySelector('.stage')!.getBoundingClientRect();
      return { headerBottom: header.bottom, stageTop: stage.top };
    });
    expect(geometry.stageTop).toBe(geometry.headerBottom);
    await expect.poll(() => page.evaluate(() => {
      const stage = document.querySelector('.stage')!.getBoundingClientRect();
      const canvas = document.querySelector('canvas')!.getBoundingClientRect();
      return Math.abs(stage.width - canvas.width);
    })).toBeLessThanOrEqual(1);
    for (const control of [header.getByRole('link', { name: 'Home', exact: true }), ...await header.getByRole('button').all(), ...await inspector.getByRole('button').all()]) {
      await expect(control).toBeInViewport({ ratio: 1 });
    }
    expect(await inspector.evaluate((panel) => panel.scrollHeight <= panel.clientHeight)).toBe(true);
  }
  await page.getByRole('link', { name: 'Home', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(header.getByRole('button', { name: 'Zoom out', exact: true })).toBeFocused();
});

test('foraging explorer uses the real gathering and regrowth simulation', async ({ page }) => {
  await openMode(page, 'foraging');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Gather selected bush', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(window.__longTable!.simulation.job))).toBe(true);
  await page.evaluate(() => {
    const simulation = window.__longTable!.simulation;
    for (let tick = 0; tick < 900; tick++) simulation.advance(1 / 60);
  });
  await expect(page.getByLabel('Berries', { exact: true })).toHaveText('Berries 3');
  await page.getByRole('button', { name: 'Depleted', exact: true }).click();
  await expect(page.getByTestId('bush-state')).toContainText('depleted');
  await page.evaluate(() => {
    const simulation = window.__longTable!.simulation;
    for (let tick = 0; tick < 1201; tick++) simulation.advance(1 / 60);
  });
  await expect(page.getByTestId('bush-state')).toContainText('ripe');
  await expect(page.getByLabel('Berries', { exact: true })).toHaveText('Berries 3');
});

test('navigation marking changes walkability and reset restores the fixture', async ({ page }) => {
  await openMode(page, 'navigation');
  const cell = await page.evaluate(() => {
    const { world, simulation } = window.__longTable!;
    for (let y = 3; y < world.height - 3; y++) {
      for (let x = 3; x < world.width - 3; x++) {
        const point = { x: (x + 0.5) * world.tileSize, y: (y + 0.5) * world.tileSize };
        if (simulation.navigation.speedAt(point) > 0 && Math.hypot(point.x - simulation.character.position.x, point.y - simulation.character.position.y) > 20) return point;
      }
    }
    throw new Error('Fixture has no editable walkable cell.');
  });
  await page.getByRole('combobox', { name: 'Terrain tool' }).selectOption('block');
  await clickWorld(page, cell);
  await expect.poll(() => page.evaluate((point) => window.__longTable!.simulation.navigation.speedAt(point), cell)).toBe(0);
  await page.getByRole('button', { name: 'Reset this explorer' }).click();
  expect(await page.evaluate((point) => window.__longTable!.simulation.navigation.speedAt(point), cell)).toBeGreaterThan(0);
});

test('portrait layout stays within viewport and camera coordinates round trip', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await openMode(page, 'island');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const error = await page.evaluate(() => {
    const { simulation, view } = window.__longTable!;
    const point = simulation.character.position;
    const result = view.screenToWorld(view.worldToScreen(point));
    return Math.hypot(result.x - point.x, result.y - point.y);
  });
  expect(error).toBeLessThan(0.001);
});

test('unknown destinations show a recovery path', async ({ page }) => {
  await page.goto('/#/not-an-explorer');
  await expect(page.getByRole('heading', { name: 'That explorer does not exist.' })).toBeVisible();
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'a long table', exact: true })).toBeVisible();
});

test('separate explorer tabs never share inventory or bush mutations', async ({ page, context }) => {
  await openMode(page, 'foraging');
  const second = await context.newPage();
  await openMode(second, 'foraging');
  await page.getByRole('button', { name: 'Depleted', exact: true }).click();
  await expect(page.getByTestId('bush-state')).toContainText('depleted');
  await expect(second.getByTestId('bush-state')).toContainText('ripe');
  expect(await second.evaluate(() => window.__longTable!.simulation.berries)).toBe(0);
  await second.close();
});

test('fractional display density preserves pointer mapping after zoom', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1100, height: 760 },
    deviceScaleFactor: 1.25,
    baseURL: process.env.APP_URL ?? 'http://127.0.0.1:5185',
  });
  const page = await context.newPage();
  try {
    await openMode(page, 'play');
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    const position = await page.evaluate(() => ({ ...window.__longTable!.simulation.character.position }));
    await clickWorld(page, position);
    await expect.poll(() => page.evaluate(() => window.__longTable!.simulation.character.selected)).toBe(true);
    const geometry = await page.evaluate(() => {
      const canvas = document.querySelector('canvas')!;
      return { backing: canvas.width, css: canvas.getBoundingClientRect().width, dpr: devicePixelRatio };
    });
    expect(Math.abs(geometry.backing - geometry.css * geometry.dpr)).toBeLessThanOrEqual(1);
  } finally {
    await context.close();
  }
});
