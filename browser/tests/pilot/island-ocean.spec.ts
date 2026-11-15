import { expect, test } from '@playwright/test';
import { presentationPixels } from './island-presentation';
import { createIslandOcean } from '../../src/world-family/render/island-ocean';
import { createIslandSun, DEFAULT_SUN } from '../../src/world-family/render/island-sun';
import { createSunlitOcean } from '../../src/world-family/render/island-sun-water';
import { createWaterSurfaceResponse } from '../../src/world-family/render/island-water-surface';

for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
  test(`ocean covers the complete scene without a canvas boundary at ${viewport.width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.goto('/#/island?version=v2&source=island&seed=77&water=still');
    const surface = page.locator('canvas[data-island-surface="true"]');
    const ocean = page.locator('.island-orbit-canvas');
    await expect(surface).toHaveAttribute('data-ocean', 'full-scene');
    await expect(ocean).toBeVisible();
    await expect(surface).toHaveAttribute('data-presentation','webgl');
    await expect(page.getByLabel('Mesh triangle count', { exact: true })).toContainText('submerged shelf triangles');
    const scene = (await page.locator('.island-ocean-scene').boundingBox())!;
    const water = (await ocean.boundingBox())!;
    expect(water.x).toBeLessThanOrEqual(scene.x);
    expect(water.y).toBeLessThanOrEqual(scene.y);
    expect(water.x + water.width).toBeGreaterThanOrEqual(scene.x + scene.width);
    expect(water.y + water.height).toBeGreaterThanOrEqual(scene.y + scene.height);
    const colors = await (async () => {
      const pixels = await presentationPixels(surface);
      const colors = new Set<string>();
      for (let i = 0; i < pixels.length; i += 4 * 97) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
      return colors.size;
    })();
    expect(colors).toBeGreaterThan(20);
    const grid = await ocean.evaluate((node: HTMLCanvasElement) => {
      const bounds = node.getBoundingClientRect();
      return [bounds.width/node.width,bounds.height/node.height];
    });
    // Layout bounds are quantized to 1/64 CSS px; styles use one exact scale.
    expect(grid[0]).toBeCloseTo(grid[1],4);
    expect(await ocean.evaluate((node: HTMLCanvasElement) =>
      Math.abs(parseFloat(node.style.width)/node.width-parseFloat(node.style.height)/node.height))).toBeLessThan(1e-12);
    const pixels = await presentationPixels(surface);
    expect(pixels[3]).toBe(255);
    expect(pixels.at(-1)).toBe(255);
    await page.getByRole('button', { name: 'Elevation plan', exact: true }).click();
    await expect(ocean).toBeHidden();
    await page.getByRole('button', { name: 'Elevated oblique', exact: true }).click();
    await expect(ocean).toBeVisible();
    await page.getByRole('button', { name: 'Blockout', exact: true }).click();
    await expect(ocean).toBeHidden();
    expect(errors).toEqual([]);
  });
}

test('ocean and island water share one clock, freeze together and release on navigation', async ({ page }) => {
  await page.goto('/#/island?version=v2&source=island&seed=77&water=animated&layers=water:surfaceHighlights=1,waves=1,shoreFoam=1');
  const surface = page.locator('canvas[data-island-surface="true"]'), ocean = page.locator('.island-orbit-canvas');
  await expect(surface).toHaveAttribute('data-ocean', 'full-scene');
  await expect.poll(async () => Number(await surface.getAttribute('data-water-time'))).toBeGreaterThan(0.1);
  await expect.poll(() => page.evaluate(() =>
    document.querySelector<HTMLElement>('[data-island-surface="true"]')!.dataset.waterTime
      === document.querySelector<HTMLElement>('.island-orbit-canvas')!.dataset.waterTime)).toBe(true);
  await page.getByRole('button', { name: 'Pause water', exact: true }).click();
  const time = await surface.getAttribute('data-water-time');
  const surfacePixels = await ocean.evaluate((node: HTMLCanvasElement) => node.toDataURL());
  const oceanPixels = await ocean.evaluate((node: HTMLCanvasElement) => node.toDataURL());
  await page.waitForTimeout(300);
  expect(await surface.getAttribute('data-water-time')).toBe(time);
  expect(await ocean.getAttribute('data-water-time')).toBe(time);
  expect(await ocean.evaluate((node: HTMLCanvasElement) => node.toDataURL())).toBe(surfacePixels);
  expect(await ocean.evaluate((node: HTMLCanvasElement) => node.toDataURL())).toBe(oceanPixels);
  await page.getByRole('button', { name: 'Animate water', exact: true }).click();
  await expect.poll(() => ocean.evaluate((node: HTMLCanvasElement) => node.toDataURL())).not.toBe(oceanPixels);
  const detached = await ocean.elementHandle();
  await page.getByRole('navigation', { name: 'Project', exact: true }).getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page.locator('.pilot')).toHaveAttribute('data-route', 'home');
  const stopped = await detached!.evaluate(node => node.dataset.waterTime);
  await page.waitForTimeout(300);
  expect(await detached!.evaluate(node => node.dataset.waterTime)).toBe(stopped);
});

test('paused ocean remains world-anchored when the island view pans', async ({ page }) => {
  const reference = createSunlitOcean(createIslandOcean(77), createIslandSun([], {
    ...DEFAULT_SUN, intensity: 0, skyFill: 1, mapSize: 512,
  }));
  await page.goto('/#/island?version=v2&source=island&seed=77&water=still&sunIntensity=0&skyFill=1&shadowQuality=512');
  const surface = page.locator('canvas[data-island-surface="true"]'), ocean = page.locator('.island-orbit-canvas');
  await expect(surface).toHaveAttribute('data-ocean', 'full-scene');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const anchors = () => page.locator('.island-ocean-scene').evaluate(node => {
    const surface = node.querySelector<HTMLCanvasElement>('[data-island-surface="true"]')!;
    const ocean = node.querySelector<HTMLCanvasElement>('.island-orbit-canvas')!;
    const a = surface.getBoundingClientRect(), b = ocean.getBoundingClientRect();
    const scale = Number(surface.dataset.magnification);
    return [-40, -20, 0, 20, 40].map(offset => {
      const x = a.left + (Math.floor(surface.width / 2) + offset + 0.5) * scale, y = a.top + 16.5 * scale;
      const px = Math.floor((x - b.left) / b.width * ocean.width), py = Math.floor((y - b.top) / b.height * ocean.height);
      const gl = ocean.getContext('webgl')!, pixel = new Uint8Array(4);
      gl.readPixels(px,ocean.height-1-py,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
      return {
        pixel: Array.from(pixel),
        x: px + 0.5 - Number(ocean.dataset.originX),
        y: py + 0.5 - Number(ocean.dataset.originY),
      };
    });
  });
  const before = await anchors();
  const pixels = await ocean.evaluate((node: HTMLCanvasElement) => node.toDataURL());
  await page.locator('.landform-canvas-frame').evaluate(node => { node.scrollLeft = 80; });
  await expect.poll(() => ocean.evaluate((node: HTMLCanvasElement) => node.toDataURL())).not.toBe(pixels);
  const after = await anchors();
  for (const [view, samples] of [before, after].entries()) {
    for (const [index, sample] of samples.entries()) {
      const sum = (sample.y - 2.5) / 0.425, difference = sample.x / 0.85;
      const point = { x: (sum + difference) / 2, y: (sum - difference) / 2 };
      const frame = reference.prepare(new Float64Array([point.x, point.y]));
      const lit = frame.shade(0, [frame.basePixels[0], frame.basePixels[1], frame.basePixels[2]]);
      const sun = createIslandSun([], { ...DEFAULT_SUN, intensity: 0, skyFill: 1, mapSize: 512 });
      const expected = createWaterSurfaceResponse(sun, 'oblique')(lit, point.x, point.y, 0, 0, 1);
      for (let channel = 0; channel < 3; channel++) {
        expect(Math.abs(sample.pixel[channel] - expected[channel])).toBeLessThanOrEqual(1);
      }
      if (view) {
        // CSS bounds round to 1/64px; the enclosing framebuffer pixel can shift.
        // Compare actual world samples, not equality of two different pixels.
        expect(Math.abs(sample.x - before[index].x)).toBeLessThanOrEqual(1);
        expect(Math.abs(sample.y - before[index].y)).toBeLessThanOrEqual(1);
      }
    }
  }
});
