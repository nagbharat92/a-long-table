import { expect, test, type Page } from '@playwright/test';

type Point = { x: number; y: number };
interface IslandState {
  seed: number;
  paused: boolean;
  elapsed: number;
  character: { position: Point; route: Point[] };
  camera: { zoom: number; scrollX: number; scrollY: number };
}

async function state(page: Page): Promise<IslandState> {
  return page.evaluate(() => window.__pilot!.snapshot() as IslandState);
}

async function project(page: Page, point: Point): Promise<Point> {
  return page.evaluate(point => window.__pilot!.worldToScreen!(point), point);
}

async function worldAt(page: Page, screen: Point): Promise<Point> {
  const origin = await project(page, { x: 0, y: 0 });
  const unit = await project(page, { x: 1, y: 1 });
  return { x: (screen.x - origin.x) / (unit.x - origin.x), y: (screen.y - origin.y) / (unit.y - origin.y) };
}

async function wheel(page: Page, screen: Point, deltaY: number, deltaMode = 0): Promise<void> {
  await page.locator('.p-stage').evaluate((node, input) => {
    const bounds = node.getBoundingClientRect();
    node.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, clientX: bounds.left + input.screen.x,
      clientY: bounds.top + input.screen.y, deltaY: input.deltaY, deltaMode: input.deltaMode,
    }));
  }, { screen, deltaY, deltaMode });
}

async function settled(page: Page, zoom: number): Promise<void> {
  await expect.poll(async () => Math.abs((await state(page)).camera.zoom - zoom)).toBeLessThan(0.00001);
}

for (const dpr of [1, 2]) {
  test.describe(`V1 island camera at DPR ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr });

    test('wheel zoom is continuous and keeps an off-center world point fixed even while paused', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('/#/island?version=v1&seed=795140&paused=1');
      await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
      const initial = await state(page);
      const box = (await page.locator('.p-stage').boundingBox())!;
      const pointer = { x: Math.round(box.width * 0.28), y: Math.round(box.height * 0.34) };
      const anchor = await worldAt(page, pointer);
      const target = initial.camera.zoom * Math.exp(0.72);
      const samples = await page.locator('.p-stage').evaluate(async (node, pointer) => {
        const bounds = node.getBoundingClientRect();
        node.dispatchEvent(new WheelEvent('wheel', {
          bubbles: true, cancelable: true, clientX: bounds.left + pointer.x,
          clientY: bounds.top + pointer.y, deltaY: -120,
        }));
        const samples: number[] = [];
        const origin = window.__pilot!.worldToScreen!({ x: 0, y: 0 });
        const unit = window.__pilot!.worldToScreen!({ x: 1, y: 1 });
        const anchor = { x: (pointer.x - origin.x) / (unit.x - origin.x), y: (pointer.y - origin.y) / (unit.y - origin.y) };
        let maxDrift = 0;
        for (let frame = 0; frame < 5; frame++) {
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          samples.push((window.__pilot!.snapshot() as IslandState).camera.zoom);
          const projected = window.__pilot!.worldToScreen!(anchor);
          maxDrift = Math.max(maxDrift, Math.hypot(projected.x - pointer.x, projected.y - pointer.y));
        }
        return { zoom: samples, maxDrift };
      }, pointer);
      expect(samples.zoom.some(zoom => zoom > initial.camera.zoom && zoom < target)).toBe(true);
      expect(new Set(samples.zoom).size).toBeGreaterThan(2);
      expect(Math.max(...samples.zoom)).toBeLessThan(target * 1.05);
      expect(samples.maxDrift).toBeLessThan(0.001);
      await settled(page, target);
      const projected = await project(page, anchor);
      expect(projected.x).toBeCloseTo(pointer.x, 3);
      expect(projected.y).toBeCloseTo(pointer.y, 3);
      const after = await state(page);
      expect(after.camera.zoom / initial.camera.zoom).toBeGreaterThan(2);
      expect(after.camera.zoom / initial.camera.zoom).toBeLessThan(2.1);
      expect(after.character.position).toEqual(initial.character.position);
      expect(after.elapsed).toBe(initial.elapsed);
      expect(after.seed).toBe(initial.seed);
      expect(errors).toEqual([]);
    });

    test('Space and left drag pan directly without issuing ground clicks', async ({ page }) => {
      await page.goto('/#/island?version=v1&seed=42&paused=1');
      await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
      const box = (await page.locator('.p-stage').boundingBox())!;
      const canvas = page.locator('.p-stage canvas');
      const initial = await state(page);
      const pointer = { x: Math.round(box.width / 2), y: Math.round(box.height / 2) };
      await wheel(page, pointer, -600);
      await settled(page, initial.camera.zoom * Math.exp(1.2));
      const center = await worldAt(page, pointer);
      const before = await state(page);
      await canvas.focus();
      await page.keyboard.down('Space');
      await expect(canvas).toHaveCSS('cursor', 'grab');
      await page.mouse.move(box.x + pointer.x, box.y + pointer.y);
      await page.mouse.down();
      await expect(canvas).toHaveCSS('cursor', 'grabbing');
      await page.mouse.move(box.x + pointer.x + 120, box.y + pointer.y + 80, { steps: 4 });
      const projected = await project(page, center);
      expect(projected.x).toBeCloseTo(pointer.x + 120, 3);
      expect(projected.y).toBeCloseTo(pointer.y + 80, 3);
      await page.mouse.up();
      await expect(canvas).toHaveCSS('cursor', 'grab');
      await page.keyboard.up('Space');
      await expect(canvas).not.toHaveCSS('cursor', /grab/);
      expect((await state(page)).character).toEqual(before.character);
      expect((await state(page)).paused).toBe(true);
      await page.getByRole('button', { name: 'Fit', exact: true }).click();
      expect((await state(page)).camera).toEqual(initial.camera);
    });

    test('pan clamps on all four sides, captures outside the canvas and releases on Space up or blur', async ({ page }) => {
      await page.goto('/#/island?version=v1&seed=42&paused=1');
      await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
      const canvas = page.locator('.p-stage canvas');
      const box = (await page.locator('.p-stage').boundingBox())!;
      const pointer = { x: Math.round(box.width / 2), y: Math.round(box.height / 2) };
      const initial = await state(page);
      const center = await worldAt(page, { x: box.width / 2, y: box.height / 2 });
      await wheel(page, pointer, -600);
      const zoom = initial.camera.zoom * Math.exp(1.2);
      await settled(page, zoom);
      const travelX = (box.width / initial.camera.zoom - box.width / zoom) / 2;
      const travelY = (box.height / initial.camera.zoom - box.height / zoom) / 2;
      for (const [dx, dy, xSign, ySign] of [[5000, 5000, -1, -1], [-5000, -5000, 1, 1]]) {
        await canvas.focus();
        await page.keyboard.down('Space');
        await page.mouse.move(box.x + pointer.x, box.y + pointer.y);
        await page.mouse.down();
        await page.mouse.move(box.x + pointer.x + dx, box.y + pointer.y + dy);
        const edge = await worldAt(page, { x: box.width / 2, y: box.height / 2 });
        expect(edge.x).toBeCloseTo(center.x + travelX * xSign, 3);
        expect(edge.y).toBeCloseTo(center.y + travelY * ySign, 3);
        const clamped = (await state(page)).camera;
        await page.mouse.move(box.x + pointer.x + dx * 1.2, box.y + pointer.y + dy * 1.2);
        expect((await state(page)).camera).toEqual(clamped);
        await page.mouse.move(box.x + pointer.x + dx * 1.2 - Math.sign(dx) * 20,
          box.y + pointer.y + dy * 1.2 - Math.sign(dy) * 20);
        const reversed = await worldAt(page, { x: box.width / 2, y: box.height / 2 });
        expect(reversed.x).toBeCloseTo(edge.x + Math.sign(dx) * 20 / zoom, 3);
        expect(reversed.y).toBeCloseTo(edge.y + Math.sign(dy) * 20 / zoom, 3);
        const released = (await state(page)).camera;
        await page.keyboard.up('Space');
        await expect(canvas).not.toHaveCSS('cursor', /grab/);
        await page.mouse.move(box.x + pointer.x, box.y + pointer.y);
        expect((await state(page)).camera).toEqual(released);
        await page.mouse.up();
      }
      await page.getByRole('button', { name: 'Fit', exact: true }).click();
      await canvas.focus();
      await page.keyboard.down('Space');
      await page.mouse.move(box.x + pointer.x, box.y + pointer.y);
      await page.mouse.down();
      await page.mouse.move(box.x + pointer.x + 100, box.y + pointer.y + 100);
      expect((await state(page)).camera).toEqual(initial.camera);
      expect((await state(page)).character).toEqual(initial.character);
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await expect(canvas).not.toHaveCSS('cursor', /grab/);
      await page.mouse.up();
      await page.keyboard.up('Space');
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.locator('.p-stage').click({ position: { x: 8, y: 8 } });
      await expect.poll(async () => (await state(page)).character.route.length).toBeGreaterThan(0);
    });

    test('real wheel input retargets during easing without snapping back to the character', async ({ page }) => {
      await page.goto('/#/island?version=v1&seed=42');
      await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
      const initial = await state(page);
      const box = (await page.locator('.p-stage').boundingBox())!;
      await page.locator('.p-stage').evaluate(node => {
        node.addEventListener('wheel', event => {
          (node as HTMLElement).dataset.testWheelDelta = String((event as WheelEvent).deltaY);
        }, { once: true });
      });
      await page.mouse.move(box.x + 450, box.y + 400);
      await page.mouse.wheel(0, -120);
      await expect.poll(async () => (await state(page)).camera.zoom).toBeGreaterThan(initial.camera.zoom);
      const nativeDelta = Number(await page.locator('.p-stage').getAttribute('data-test-wheel-delta'));
      expect(nativeDelta).toBeLessThan(0);
      await page.mouse.move(box.x + 600, box.y + 400);
      const anchor = await page.locator('.p-stage').evaluate(node => {
        const bounds = node.getBoundingClientRect();
        const pointer = { x: 600, y: 400 };
        const origin = window.__pilot!.worldToScreen!({ x: 0, y: 0 });
        const unit = window.__pilot!.worldToScreen!({ x: 1, y: 1 });
        const world = { x: (pointer.x - origin.x) / (unit.x - origin.x), y: (pointer.y - origin.y) / (unit.y - origin.y) };
        node.dispatchEvent(new WheelEvent('wheel', {
          bubbles: true, cancelable: true, clientX: bounds.left + pointer.x,
          clientY: bounds.top + pointer.y, deltaY: 40,
        }));
        return world;
      });
      await settled(page, initial.camera.zoom * Math.exp((-nativeDelta - 40) * 0.006));
      expect((await project(page, anchor)).x).toBeCloseTo(600, 3);
      expect((await project(page, anchor)).y).toBeCloseTo(400, 3);
      const stationary = (await state(page)).camera;
      await expect.poll(async () => (await state(page)).elapsed).toBeGreaterThan(initial.elapsed + 1);
      expect((await state(page)).camera).toEqual(stationary);
    });

    test('clamps both limits without drift, supports reverse and moved-pointer input, and Fit cancels easing', async ({ page }) => {
      await page.goto('/#/island?version=v1&seed=42&paused=1');
      await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
      const initial = await state(page);
      const box = (await page.locator('.p-stage').boundingBox())!;
      const pointer = { x: Math.round(box.width * 0.35), y: Math.round(box.height * 0.4) };
      for (let index = 0; index < 4; index++) await wheel(page, pointer, -120);
      await settled(page, 32);
      const maximum = (await state(page)).camera;
      await wheel(page, { x: 10, y: 10 }, -600);
      expect((await state(page)).camera).toEqual(maximum);
      const movedPointer = { x: Math.round(box.width * 0.62), y: Math.round(box.height * 0.6) };
      const movedAnchor = await worldAt(page, movedPointer);
      await wheel(page, movedPointer, 120);
      await settled(page, 32 * Math.exp(-0.72));
      expect((await project(page, movedAnchor)).x).toBeCloseTo(movedPointer.x, 3);
      expect((await project(page, movedAnchor)).y).toBeCloseTo(movedPointer.y, 3);
      for (let index = 0; index < 4; index++) await wheel(page, pointer, 120);
      await settled(page, initial.camera.zoom);
      const minimum = (await state(page)).camera;
      await wheel(page, movedPointer, 600);
      expect((await state(page)).camera).toEqual(minimum);
      await wheel(page, pointer, -120);
      await page.getByRole('button', { name: 'Fit', exact: true }).click();
      expect((await state(page)).camera).toEqual(initial.camera);
      await page.waitForTimeout(300);
      expect((await state(page)).camera).toEqual(initial.camera);
      await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
      await settled(page, initial.camera.zoom * 1.5);
      await page.locator('.p-stage').click({ position: { x: 8, y: 8 } });
      await page.keyboard.press('f');
      expect((await state(page)).camera).toEqual(initial.camera);
    });
  });
}

test('small trackpad deltas, line/page units, keyboard zoom and resize preserve the inspected view', async ({ page }) => {
  await page.goto('/#/island?version=v1&seed=42&paused=1');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  const initial = await state(page);
  const box = (await page.locator('.p-stage').boundingBox())!;
  const pointer = { x: Math.round(box.width * 0.3), y: Math.round(box.height * 0.3) };
  await wheel(page, pointer, 0);
  expect((await state(page)).camera).toEqual(initial.camera);
  await wheel(page, pointer, -1);
  await settled(page, initial.camera.zoom * Math.exp(0.006));
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await wheel(page, pointer, -3, 1);
  await settled(page, initial.camera.zoom * Math.exp(0.288));
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await wheel(page, pointer, -1, 2);
  await settled(page, initial.camera.zoom * Math.exp(Math.min(1.2, box.height * 0.006)));
  const before = await state(page);
  const center = await worldAt(page, { x: box.width / 2, y: box.height / 2 });
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect.poll(async () => (await page.locator('.p-stage').boundingBox())!.width).not.toBe(box.width);
  const resized = (await page.locator('.p-stage').boundingBox())!;
  await expect.poll(async () => Math.abs((await project(page, center)).x - resized.width / 2)).toBeLessThan(0.001);
  expect((await project(page, center)).y).toBeCloseTo(resized.height / 2, 3);
  expect((await state(page)).camera.zoom).toBeCloseTo(before.camera.zoom, 6);
  await page.locator('.p-stage').click({ position: { x: 8, y: 8 } });
  await page.keyboard.press('+');
  await settled(page, before.camera.zoom * 1.5);
});
