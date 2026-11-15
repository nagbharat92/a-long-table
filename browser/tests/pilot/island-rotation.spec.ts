import { expect, test, type Page } from '@playwright/test';
import { presentationImage } from './island-presentation';

interface TurnSample { time: number; yaw: number; width: number; height: number }
declare global {
  interface Window {
    islandTurnSamples: TurnSample[];
    islandTurnObserver: MutationObserver;
    islandTurnImages: string[];
  }
}

const islandURL = '/#/island?version=v2&source=island&seed=152941&water=still&shadowQuality=512';
const surface = (page: Page) => page.locator('[data-island-surface="true"]');
const left = (page: Page) => page.getByRole('button', { name: 'Rotate island left', exact: true });
const right = (page: Page) => page.getByRole('button', { name: 'Rotate island right', exact: true });

async function ready(page: Page, url = islandURL): Promise<void> {
  await page.goto(url);
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
}

async function settled(page: Page, view: number): Promise<void> {
  await expect(surface(page)).toHaveAttribute('data-view', String(view));
  await expect(surface(page)).toHaveAttribute('data-turning', 'false');
  await expect(right(page)).toBeEnabled();
}

async function image(page: Page): Promise<string> {
  return presentationImage(surface(page));
}

test('fit uses the available fractional scale without changing the world or rotation pivot', async ({ page }) => {
  await ready(page);
  const before = await surface(page).evaluate((node: HTMLCanvasElement) => {
    const frame = node.closest<HTMLElement>('.landform-canvas-frame')!;
    return {
      scale: Number(node.dataset.magnification),
      fit: Math.max(0.25, Math.min((frame.clientWidth - 24) / node.width, (frame.clientHeight - 96) / node.height)),
      pivot: [node.dataset.pivotX, node.dataset.pivotY],
      seed: node.dataset.seed,
      heights: node.dataset.elevationHeights,
    };
  });
  expect(before.scale).toBeCloseTo(before.fit, 10);
  expect(before.scale).toBeGreaterThan(1);
  expect(before.scale).not.toBe(Math.floor(before.scale));
  expect(before.pivot.map(Number)).not.toEqual([256, 192]);
  await right(page).click();
  await settled(page, 1);
  expect(await surface(page).evaluate((node: HTMLCanvasElement) => ({
    scale: Number(node.dataset.magnification), pivot: [node.dataset.pivotX, node.dataset.pivotY],
    seed: node.dataset.seed, heights: node.dataset.elevationHeights,
  }))).toEqual({ scale: before.scale, pivot: before.pivot, seed: before.seed, heights: before.heights });
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await expect(surface(page)).toHaveAttribute('data-magnification', String(before.scale));
});

test('four quarter turns reveal distinct sides and return exactly to the starting island', async ({ page }) => {
  await ready(page);
  const before = await surface(page).evaluate((node: HTMLCanvasElement) => ({
    seed: node.dataset.seed, triangles: node.dataset.triangles, heights: node.dataset.elevationHeights,
    sun: node.dataset.sunAzimuth, clock: node.dataset.waterTime, width: node.width, height: node.height,
  }));
  const images = [await image(page)];
  for (const view of [1, 2, 3, 0]) {
    await right(page).click();
    await settled(page, view);
    images.push(await image(page));
    expect(await surface(page).evaluate((node: HTMLCanvasElement) => ({
      seed: node.dataset.seed, triangles: node.dataset.triangles, heights: node.dataset.elevationHeights,
      sun: node.dataset.sunAzimuth, clock: node.dataset.waterTime, width: node.width, height: node.height,
    }))).toEqual(before);
  }
  expect(new Set(images.slice(0, 4)).size).toBe(4);
  expect(images[4]).toBe(images[0]);
  await left(page).click();
  await settled(page, 3);
  expect(await image(page)).toBe(images[3]);
});

test('turns have real intermediate views, stable framing and a bounded eased animation', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const node = document.querySelector<HTMLCanvasElement>('[data-island-surface]')!;
    const samples: TurnSample[] = [];
    window.islandTurnSamples = samples;
    window.islandTurnImages = [];
    const observer = new MutationObserver(() => {
      const yaw = Number(node.dataset.yaw);
      samples.push({ time: performance.now(), yaw, width: node.width, height: node.height });
      if (window.islandTurnImages.length < 3 && yaw > 0.25 + window.islandTurnImages.length * 0.4 && yaw < 1.4) {
        window.islandTurnImages.push(document.querySelector<HTMLCanvasElement>('.island-orbit-canvas')!.toDataURL());
      }
    });
    observer.observe(node, { attributes: true, attributeFilter: ['data-yaw'] });
    window.islandTurnObserver = observer;
  });
  await right(page).click();
  await settled(page, 1);
  const samples = await page.evaluate(() => {
    window.islandTurnObserver.disconnect();
    return window.islandTurnSamples;
  });
  const intermediate = samples.filter(sample => sample.yaw > 0 && sample.yaw < Math.PI / 2);
  expect(intermediate.length).toBeGreaterThanOrEqual(10);
  expect(samples.at(-1)!.time - samples[0].time).toBeLessThan(1600);
  expect(new Set(samples.map(sample => `${sample.width}:${sample.height}`)).size).toBe(1);
  expect(new Set(await page.evaluate(() => window.islandTurnImages)).size).toBe(3);
  for (let i = 1; i < samples.length; i++) expect(samples[i].yaw).toBeGreaterThanOrEqual(samples[i - 1].yaw);
  await expect(page.locator('.island-orbit-canvas')).toBeVisible();
});

test('frame timestamps before the input clock do not disable smooth rotation', async ({ page }) => {
  await page.addInitScript(() => {
    const requestFrame = window.requestAnimationFrame.bind(window);
    // Reproduce a frame clock that is earlier than performance.now() in the input handler.
    window.requestAnimationFrame = callback => requestFrame(now => callback(now - 100));
  });
  await ready(page);
  await page.evaluate(() => {
    const node = document.querySelector<HTMLCanvasElement>('[data-island-surface]')!;
    window.islandTurnSamples = [];
    window.islandTurnObserver = new MutationObserver(() => {
      window.islandTurnSamples.push({
        time: performance.now(), yaw: Number(node.dataset.yaw), width: node.width, height: node.height,
      });
    });
    window.islandTurnObserver.observe(node, { attributes: true, attributeFilter: ['data-yaw'] });
  });
  for (const [direction, view] of [['right', 1], ['right', 2], ['left', 1]] as const) {
    await page.evaluate(() => { window.islandTurnSamples = []; });
    await (direction === 'left' ? left(page) : right(page)).click();
    await settled(page, view);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('.island-view-readout')).not.toHaveAttribute('title', /unavailable/);
    const samples = await page.evaluate(() => window.islandTurnSamples);
    expect(new Set(samples.map(sample => sample.yaw)).size).toBeGreaterThanOrEqual(10);
  }
  await page.evaluate(() => window.islandTurnObserver.disconnect());
});

test('view survives reload, sun edits, zoom, seed changes and diagnostic projections', async ({ page }) => {
  await ready(page, `${islandURL}&view=2`);
  await settled(page, 2);
  await page.getByRole('slider', { name: 'Sun direction', exact: true }).fill('123');
  await expect(surface(page)).toHaveAttribute('data-sun-azimuth', '123');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(surface(page)).toHaveAttribute('data-seed', '152942');
  await settled(page, 2);
  await page.getByRole('button', { name: 'Current axes', exact: true }).click();
  await left(page).click();
  await settled(page, 1);
  await page.getByRole('button', { name: 'Elevation plan', exact: true }).click();
  await expect(left(page)).toBeDisabled();
  await expect(right(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Elevated oblique', exact: true }).click();
  await settled(page, 1);
  await page.reload();
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  await settled(page, 1);
  await expect(surface(page)).toHaveAttribute('data-sun-azimuth', '123');
});

test('keyboard rotation is scoped to the island, not sliders or seed inputs', async ({ page }) => {
  await ready(page);
  const direction = page.getByRole('slider', { name: 'Sun direction', exact: true });
  await direction.focus();
  await page.keyboard.press('ArrowRight');
  await expect(surface(page)).toHaveAttribute('data-view', '0');
  await page.locator('.landform-canvas-frame').focus();
  await page.keyboard.press('ArrowLeft');
  await settled(page, 3);
  await right(page).focus();
  await page.keyboard.press('Enter');
  await settled(page, 0);
});

test('reduced motion goes directly to a fixed side and narrow controls remain visible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await right(page).click();
  await settled(page, 1);
  for (const control of [left(page), right(page)]) {
    await expect(control).toBeInViewport();
    const bounds = await control.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('generation and navigation cancel an in-progress turn cleanly', async ({ page }) => {
  await ready(page);
  await right(page).click();
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(surface(page)).toHaveAttribute('data-seed', '152942');
  await settled(page, 1);
  await right(page).click();
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await expect(surface(page)).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('unsupported graphics retain usable instant quarter turns with an explicit warning', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', message => { if (message.type() === 'warning') warnings.push(message.text()); });
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value(this: HTMLCanvasElement, type: string, ...args: unknown[]) {
        return type.includes('webgl') ? null : Reflect.apply(getContext, this, [type, ...args]);
      },
    });

    test('context loss during a turn cancels GPU work and renders a usable software view',async ({ page }) => {
      const warnings: string[] = [];
      page.on('console',message => { if (message.type() === 'warning') warnings.push(message.text()); });
      await ready(page);
      await right(page).click();
      await page.locator('.island-orbit-canvas').evaluate((node: HTMLCanvasElement) => {
        const gl = node.getContext('webgl')!;
        const extension = gl.getExtension('WEBGL_lose_context');
        if (!extension) throw new Error('The test browser must support deterministic context loss.');
        extension.loseContext();
      });
      await settled(page,1);
      await expect(surface(page)).toHaveAttribute('data-presentation','cpu');
      await expect(surface(page)).toBeVisible();
      await expect(page.locator('.island-orbit-canvas')).toBeHidden();
      await left(page).click();
      await settled(page,0);
      expect(warnings.some(message => message.includes('Smooth island rotation is unavailable'))).toBe(true);
      await expect(page.getByRole('alert')).toHaveCount(0);
    });
  });
  await ready(page);
  const original = await image(page);
  await right(page).click();
  await settled(page, 1);
  expect(await image(page)).not.toBe(original);
  await left(page).click();
  await settled(page, 0);
  expect(await image(page)).toBe(original);
  await expect(page.locator('.island-view-readout')).toHaveAttribute('title', /unavailable.*instantly/);
  expect(warnings.some(message => message.includes('Smooth island rotation is unavailable'))).toBe(true);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

for (const view of ['-1', '4', 'NaN', '1.5', '']) {
  test(`invalid fixed view reports an error: ${JSON.stringify(view)}`, async ({ page }) => {
    await page.goto(`${islandURL}&view=${view}`);
    await expect(page.getByRole('alert')).toContainText('Island view');
  });
}
