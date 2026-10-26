import { expect, test, type Page } from '@playwright/test';
import type Phaser from 'phaser';
import type { Rectangle } from '../../src/core/contracts';
import '../../src/debug';

async function openPaused(page: Page, mode: string): Promise<void> {
  await page.goto(`/#/${mode}?paused=1`);
  await page.waitForFunction(() => window.__longTable?.ready === true);
  await expect(page.getByRole('alert')).toBeHidden();
}

test('paused readouts avoid DOM churn but still reflect explicit simulation advances', async ({ page }) => {
  await openPaused(page, 'foraging');
  const mutations = await page.evaluate(async () => {
    let count = 0;
    const observer = new MutationObserver((records) => { count += records.length; });
    observer.observe(document.querySelector('.runtime')!, { childList: true, characterData: true, subtree: true });
    await new Promise((resolve) => setTimeout(resolve, 400));
    count += observer.takeRecords().length;
    observer.disconnect();
    return count;
  });
  expect(mutations).toBe(0);

  await page.evaluate(() => {
    const simulation = window.__longTable!.simulation;
    simulation.setBushState(simulation.bushes[0].id, 'depleted');
    simulation.select(false);
    simulation.berries = 9;
    simulation.advance(0.5);
  });
  await expect(page.getByLabel('Berries', { exact: true })).toHaveText('Berries 9');
  await expect(page.getByTestId('bush-state')).toHaveText('depleted · 0.5 / 20 s');
  const stats = page.getByRole('heading', { name: 'This session', exact: true }).locator('..');
  await expect(stats.locator('dd').nth(0)).toHaveText('0.5 s');
  await expect(stats.locator('dd').nth(3)).toHaveText('Not selected');

  await page.evaluate(() => window.__longTable!.simulation.advance(20));
  await expect(page.getByTestId('bush-state')).toHaveText('ripe · 20.0 / 20 s');
  await expect(stats.locator('dd').nth(0)).toHaveText('20.5 s');
  await page.getByRole('button', { name: 'Reset this explorer' }).click();
  await expect(page.getByLabel('Berries', { exact: true })).toHaveText('Berries 0');
  await expect(page.getByTestId('bush-state')).toHaveText('ripe · 0.0 / 20 s');
  await expect(stats.locator('dd').nth(0)).toHaveText('0.0 s');
});

test('unchanged camera avoids recentering while zoom, follow and resize still invalidate it', async ({ page }) => {
  await openPaused(page, 'navigation');
  const measurements = await page.evaluate(async () => {
    const runtime = window.__longTable!;
    const internals = runtime.view as unknown as {
      camera: Phaser.Cameras.Scene2D.Camera;
      terrain: { updateOcean(view: Rectangle): void };
    };
    const camera = internals.camera;
    const centerOn = camera.centerOn.bind(camera);
    const updateOcean = internals.terrain.updateOcean.bind(internals.terrain);
    let centers = 0;
    let oceans = 0;
    camera.centerOn = (x, y) => {
      centers++;
      return centerOn(x, y);
    };
    internals.terrain.updateOcean = (view) => {
      oceans++;
      updateOcean(view);
    };
    const wait = () => new Promise((resolve) => setTimeout(resolve, 250));
    await wait();
    const stationary = { centers, oceans };
    const fitZoom = runtime.view.getCameraState().zoom;
    runtime.view.zoomBy(1.5);
    const zoomed = { centers, oceans, zoom: runtime.view.getCameraState().zoom };
    await wait();
    const stationaryFollowing = { centers, oceans };
    const originalPosition = { ...runtime.simulation.character.position };
    runtime.simulation.character.position.x += 2;
    await wait();
    const moved = { centers, oceans };
    const point = runtime.view.screenToWorld(runtime.view.worldToScreen(runtime.simulation.character.position));
    const projectionError = Math.hypot(point.x - runtime.simulation.character.position.x, point.y - runtime.simulation.character.position.y);
    runtime.simulation.character.position = originalPosition;
    runtime.view.fit();
    return { stationary, zoomed, stationaryFollowing, moved, fitZoom, projectionError };
  });
  expect(measurements.stationary).toEqual({ centers: 0, oceans: 0 });
  expect(measurements.zoomed.zoom).toBeGreaterThan(measurements.fitZoom);
  expect(measurements.zoomed.centers).toBe(1);
  expect(measurements.zoomed.oceans).toBe(1);
  expect(measurements.stationaryFollowing).toEqual({ centers: 1, oceans: 1 });
  expect(measurements.moved).toEqual({ centers: 2, oceans: 2 });
  expect(measurements.projectionError).toBeLessThan(0.001);

  const before = await page.evaluate(() => window.__longTable!.view.getCameraState().zoom);
  await page.setViewportSize({ width: 900, height: 700 });
  await expect.poll(() => page.evaluate(() => window.__longTable!.view.getCameraState().zoom)).not.toBe(before);
  const resized = await page.evaluate(() => {
    const { view, simulation } = window.__longTable!;
    const result = view.screenToWorld(view.worldToScreen(simulation.character.position));
    const canvas = document.querySelector('canvas')!;
    return {
      projectionError: Math.hypot(result.x - simulation.character.position.x, result.y - simulation.character.position.y),
      backingError: Math.abs(canvas.width - canvas.getBoundingClientRect().width * devicePixelRatio),
    };
  });
  expect(resized.projectionError).toBeLessThan(0.001);
  expect(resized.backingError).toBeLessThanOrEqual(1);
  await expect(page.getByRole('alert')).toBeHidden();
});
