import { expect, test, type Page } from '@playwright/test';
import '../../src/debug';
import { buildMotionArtwork } from '../../src/core/character-face';
import { rigBounds, rigPixelAt, rigPoint, transformRig } from '../../src/core/character-rig';
import { HOP_DISTANCE, motionSourceBounds, sampleRabbitMotion } from '../../src/core/character-motion';
import type { Point } from '../../src/core/contracts';
import type Phaser from 'phaser';

async function openMotion(page: Page): Promise<void> {
  await page.goto('/#/character?tab=motion&paused=1');
  await page.waitForFunction(() => window.__longTable?.ready);
  await expect(page.getByRole('alert')).toBeHidden();
}

async function artwork(page: Page) {
  const pixels = await page.evaluate(async () => {
    const read = async (file: string) => {
      const image = new Image();
      image.src = `/assets/${file}.png`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return Array.from(context.getImageData(0, 0, image.width, image.height).data);
    };
    return { source: await read('rabbit'), blink: await read('rabbit-blink') };
  });
  const source = new Uint8ClampedArray(pixels.source);
  return { source, ...buildMotionArtwork(source, new Uint8ClampedArray(pixels.blink)) };
}

async function canvasColors(page: Page, points: Point[]): Promise<number[][]> {
  const screen = await page.evaluate(points => points.map(point => {
    const { view, simulation } = window.__longTable!;
    return view.worldToScreen({
      x: simulation.character.position.x - simulation.character.facingDirection * (point.x - 9) * 12 / 29,
      y: simulation.character.position.y + (point.y - 29) * 12 / 29,
    });
  }), points);
  const png = await page.locator('canvas').screenshot();
  return page.evaluate(async ({ base64, points }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const scale = image.width / document.querySelector('canvas')!.getBoundingClientRect().width;
    return points.map(point => {
      if (point.x < 0 || point.y < 0 || point.x * scale >= image.width || point.y * scale >= image.height) {
        throw new Error('An animated feature left the visible canvas.');
      }
      return Array.from(context.getImageData(Math.floor(point.x * scale), Math.floor(point.y * scale), 1, 1).data);
    });
  }, { base64: png.toString('base64'), points: screen });
}

async function expectAttachedFace(page: Page, face: Awaited<ReturnType<typeof artwork>>['face']): Promise<void> {
  const pose = await page.evaluate(() => window.__longTable!.view.getCharacterMotion()!);
  const transforms = transformRig(pose.rig);
  const points: Point[] = [];
  for (const layer of face) {
    const scale = layer.feature.id === 'nose' ? pose.face.noseScale : pose.face.eyeScale;
    const offset = layer.feature.id === 'nose' ? pose.face.noseOffset : pose.face.eyeOffset;
    const pixels = pose.face.blink ? layer.blink : layer.pixels;
    for (let index = 0; index < pixels.length; index += 4) {
      if (!pixels[index + 3]) continue;
      const p = rigPoint(pose.rig, transforms, 'head', {
        x: layer.feature.pivot.x + offset.x + (index / 4 % 18 + 0.5 - layer.feature.pivot.x) * scale.x,
        y: layer.feature.pivot.y + offset.y + (Math.floor(index / 4 / 18) + 0.5 - layer.feature.pivot.y) * scale.y,
      });
      points.push({ x: p.x, y: p.y - pose.hop * 29 / 12 });
    }
  }
  expect(points.length).toBeGreaterThanOrEqual(5);
  expect(await canvasColors(page, points)).toEqual(points.map(() => [0, 0, 0, 255]));
}

test('the articulated neutral Motion drawing still reproduces every original opaque pixel', async ({ page }) => {
  await openMotion(page);
  const { source } = await artwork(page);
  const points: Point[] = [];
  const colors: number[][] = [];
  for (let index = 0; index < source.length; index += 4) {
    if (!source[index + 3]) continue;
    points.push({ x: index / 4 % 18 + 0.5, y: Math.floor(index / 4 / 18) + 0.5 });
    colors.push(Array.from(source.slice(index, index + 4)));
  }
  expect(await canvasColors(page, points)).toEqual(colors);
});

test('one motion version preserves playback and camera while applying Creation setup', async ({ page }, testInfo) => {
  await openMotion(page);
  await expect(page.getByRole('group', { name: 'Exaggeration', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Stiff|Follow-through|Exaggerated)$/ })).toHaveCount(0);
  const { face } = await artwork(page);
  await page.getByRole('slider', { name: 'Hop cycle', exact: true }).fill('23');
  const before = await page.evaluate(() => structuredClone(window.__longTable!.simulation.character));
  const camera = await page.evaluate(() => window.__longTable!.view.getCameraState());
  const pose = await page.evaluate(() => window.__longTable!.view.getCharacterMotion()!);
  const expected = sampleRabbitMotion(before);
  expect(pose).not.toHaveProperty('style');
  expect(pose.phase).toBe(expected.phase);
  expect(pose.rig.parts.head.angle).toBeCloseTo(expected.rig.parts.head.angle, 10);
  expect(pose.rig.parts.head.squashStretch).toBeCloseTo(expected.rig.parts.head.squashStretch, 10);
  await expectAttachedFace(page, face);
  await page.locator('canvas').screenshot({ path: testInfo.outputPath('follow-through-push.png') });
  await page.getByRole('button', { name: 'Creation', exact: true }).click();
  await page.getByRole('slider', { name: 'Angle', exact: true }).fill('5');
  const creation = await page.evaluate(() => window.__longTable!.view.getCharacterRig());
  await page.getByRole('button', { name: 'Motion', exact: true }).click();
  expect(await page.evaluate(() => window.__longTable!.simulation.character)).toEqual(before);
  expect(await page.evaluate(() => window.__longTable!.view.getCameraState())).toEqual(camera);
  const adjusted = await page.evaluate(() => window.__longTable!.view.getCharacterMotion()!);
  expect(adjusted.phase).toBe(pose.phase);
  expect(adjusted.rig.parts.head.angle).toBeCloseTo(pose.rig.parts.head.angle + 5, 10);
  await page.getByRole('button', { name: 'Creation', exact: true }).click();
  expect(await page.evaluate(() => window.__longTable!.view.getCharacterRig())).toEqual(creation);
  await page.goto('/#/play?paused=1');
  await page.waitForFunction(() => window.__longTable?.ready);
  const gameplay = await page.evaluate(() => structuredClone(window.__longTable!.simulation.character));
  const gameplayPose = await page.evaluate(() => window.__longTable!.view.getCharacterMotion()!);
  expect(gameplayPose).not.toHaveProperty('style');
  expect(gameplayPose.hop).toBeCloseTo(sampleRabbitMotion(gameplay).hop, 10);
  await expect(page.getByRole('alert')).toBeHidden();
});

for (const viewport of [{ width: 1280, height: 850 }, { width: 390, height: 844 }]) {
  test(`the resting silhouette is centered in both character tabs at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openMotion(page);
    const centered = async () => {
      const { center, width, height } = await page.evaluate(() => {
        const { simulation, view } = window.__longTable!;
        const canvas = document.querySelector('canvas')!.getBoundingClientRect();
        return {
          center: view.worldToScreen({ x: simulation.character.position.x, y: simulation.character.position.y - 6 }),
          width: canvas.width, height: canvas.height,
        };
      });
      expect(center.x).toBeCloseTo(width / 2, 2);
      expect(center.y).toBeCloseTo(height / 2, 2);
    };
    await centered();
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await centered();
    await page.getByRole('button', { name: 'Fit view', exact: true }).click();
    await centered();
    await page.getByRole('button', { name: 'Creation', exact: true }).click();
    await centered();
    await page.getByRole('button', { name: 'Fit view', exact: true }).click();
    await centered();
  });

  test(`motion cutouts, face and controls stay visible at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await openMotion(page);
    const { face } = await artwork(page);
    await expect(page.getByRole('combobox', { name: 'Playback speed', exact: true })).toBeInViewport();
    await expect(page.getByRole('group', { name: 'Exaggeration', exact: true })).toHaveCount(0);
    for (const phase of [12, 23, 32, 42, 57, 66, 76, 82, 87, 94, 98]) {
      await page.getByRole('slider', { name: 'Hop cycle', exact: true }).fill(String(phase));
      const pose = await page.evaluate(() => window.__longTable!.view.getCharacterMotion()!);
      const bounds = motionSourceBounds(pose);
      const corners = await page.evaluate(({ bounds, hop }) => {
        const { simulation, view } = window.__longTable!;
        const canvas = document.querySelector('canvas')!.getBoundingClientRect();
        return {
          width: canvas.width, height: canvas.height,
          points: [bounds.x, bounds.x + bounds.width].flatMap(x =>
            [bounds.y, bounds.y + bounds.height].map(y => view.worldToScreen({
              x: simulation.character.position.x + (x - 9) * 12 / 29,
              y: simulation.character.position.y + (y - 29) * 12 / 29 - hop,
            }))),
        };
      }, { bounds, hop: pose.hop });
      for (const point of corners.points) {
        expect(point.x, `phase ${phase}`).toBeGreaterThanOrEqual(0);
        expect(point.x, `phase ${phase}`).toBeLessThanOrEqual(corners.width);
        expect(point.y, `phase ${phase}`).toBeGreaterThanOrEqual(0);
        expect(point.y, `phase ${phase}`).toBeLessThanOrEqual(corners.height);
      }
      await expectAttachedFace(page, face);
      if ([23, 66, 82].includes(phase)) {
        await page.screenshot({ path: testInfo.outputPath(`motion-${phase}.png`) });
      }
    }
    const before = await page.evaluate(() => window.__longTable!.simulation.character.animationTime);
    const control = page.getByRole('button', { name: 'Step one frame', exact: true });
    await control.focus();
    await page.keyboard.press('Enter');
    await expect(control).toBeFocused();
    expect(await page.evaluate(() => window.__longTable!.simulation.character.animationTime)).toBeCloseTo(before + 1 / 60);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('alert')).toBeHidden();
  });
}

test('Idle visibly bobs with a stable head, freezes on pause and preserves feet, camera and Creation', async ({ page }, testInfo) => {
  await openMotion(page);
  const { face } = await artwork(page);
  await page.getByRole('button', { name: 'Idle', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Hop cycle', exact: true })).toBeDisabled();
  const initial = await page.evaluate(() => ({
    character: structuredClone(window.__longTable!.simulation.character),
    camera: window.__longTable!.view.getCameraState(),
  }));
  const neutral = await page.locator('canvas').screenshot();
  const pose = await page.evaluate(() => window.__longTable!.view.getCharacterMotion()!);
  const transforms = transformRig(pose.rig);
  expect(pose.rig.parts.body.offset.y).toBe(0);
  expect(transforms.head.scale).toEqual({ x: 1, y: 1 });
  expect(rigPoint(pose.rig, transforms, 'left-ear', { x: 6, y: 0 }).y).toBe(0);
  for (const [id, x] of [['left-foot', 5], ['right-foot', 13]] as const) {
    const sole = rigPoint(pose.rig, transforms, id, { x, y: 29 });
    expect(sole.x).toBeCloseTo(x, 10);
    expect(sole.y).toBeCloseTo(29, 10);
  }
  await expectAttachedFace(page, face);
  await page.screenshot({ path: testInfo.outputPath('idle-raised.png') });
  for (let index = 0; index < 28; index++) {
    await page.evaluate(() => window.__longTable!.view.stepCharacterFrame());
  }
  const compressed = await page.evaluate(() => window.__longTable!.view.getCharacterMotion()!);
  const compressedTransforms = transformRig(compressed.rig);
  expect(compressed.rig.parts.body.offset.y).toBeGreaterThan(1.9);
  expect(compressedTransforms.head.scale).toEqual({ x: 1, y: 1 });
  expect(compressedTransforms.head.position.y).toBeGreaterThan(20);
  expect(rigPoint(compressed.rig, compressedTransforms, 'left-ear', { x: 6, y: 0 }).y).toBeGreaterThan(2);
  for (const [id, x] of [['left-foot', 5], ['right-foot', 13]] as const) {
    const sole = rigPoint(compressed.rig, compressedTransforms, id, { x, y: 29 });
    expect(sole.x).toBeCloseTo(x, 10);
    expect(sole.y).toBeCloseTo(29, 10);
  }
  await expectAttachedFace(page, face);
  expect(await page.locator('canvas').screenshot()).not.toEqual(neutral);
  await page.screenshot({ path: testInfo.outputPath('idle-lowered.png') });
  const paused = await page.locator('canvas').screenshot();
  await page.waitForTimeout(200);
  expect(await page.locator('canvas').screenshot()).toEqual(paused);
  expect(await page.evaluate(() => window.__longTable!.view.getCameraState())).toEqual(initial.camera);
  expect(await page.evaluate(() => window.__longTable!.simulation.character.position)).toEqual(initial.character.position);
  expect(await page.evaluate(() => window.__longTable!.simulation.character.gaitDistance)).toBe(initial.character.gaitDistance);
  await page.getByRole('button', { name: 'Creation', exact: true }).click();
  const creation = await page.evaluate(() => window.__longTable!.view.getCharacterRig());
  expect(creation).toEqual((await import('../../src/core/character-rig')).createCharacterRig());
  await page.getByRole('button', { name: 'Motion', exact: true }).click();
  expect(await page.evaluate(() => window.__longTable!.view.getCharacterMotion())).toEqual(compressed);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__longTable!.simulation.character.animationTime)).toBeGreaterThan(0.57);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  expect(await page.locator('canvas').screenshot()).not.toEqual(paused);
  await expect(page.getByRole('alert')).toBeHidden();
});

test.describe('distance-readable idle', () => {
  test.use({ deviceScaleFactor: 1 });
  for (const width of [1280, 390]) {
    test(`the shape-stable bob remains visible at native sprite scale on a ${width}px viewport`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 850 });
      await openMotion(page);
      await page.getByRole('button', { name: 'Idle', exact: true }).click();
      await page.evaluate(() => window.__longTable!.view.zoomBy(0.01));
      const camera = await page.evaluate(() => window.__longTable!.view.getCameraState());
      expect(camera.zoom * 12 / 29).toBeCloseTo(1, 10);
      const silhouettes = [];
      for (const [label, frames] of [['raised', 0], ['lowered', 28]] as const) {
        await page.evaluate(frames => {
          for (let index = 0; index < frames; index++) window.__longTable!.view.stepCharacterFrame();
        }, frames);
        const png = await page.locator('canvas').screenshot({ path: testInfo.outputPath(`tiny-${label}.png`) });
        silhouettes.push(await page.evaluate(async base64 => {
          const image = new Image();
          image.src = `data:image/png;base64,${base64}`;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.width; canvas.height = image.height;
          const context = canvas.getContext('2d')!;
          context.drawImage(image, 0, 0);
          const pixels = context.getImageData(0, 0, image.width, image.height).data;
          let left = image.width, right = -1, top = image.height, bottom = -1;
          for (let index = 0; index < pixels.length; index += 4) {
            if (pixels[index] >= 32 || pixels[index + 1] >= 32 || pixels[index + 2] >= 32) continue;
            const x = index / 4 % image.width, y = Math.floor(index / 4 / image.width);
            left = Math.min(left, x); right = Math.max(right, x);
            top = Math.min(top, y); bottom = Math.max(bottom, y);
          }
          return { width: right - left + 1, height: bottom - top + 1, top, bottom };
        }, png.toString('base64')));
      }
      const [raised, lowered] = silhouettes;
      expect(raised.height).toBeGreaterThanOrEqual(29);
      expect(raised.height).toBeLessThanOrEqual(31);
      expect(raised.height - lowered.height).toBeGreaterThanOrEqual(2);
      expect(raised.height - lowered.height).toBeLessThanOrEqual(4);
      expect(lowered.width).toBe(raised.width);
      expect(lowered.top - raised.top).toBeGreaterThanOrEqual(2);
      expect(lowered.bottom).toBe(raised.bottom);
      expect(await page.evaluate(() => window.__longTable!.view.getCameraState())).toEqual(camera);
      await expect(page.getByRole('alert')).toBeHidden();
    });
  }
});

test('rendered ears sway together without pinching and feet remain flat during contact', async ({ page }) => {
  await openMotion(page);
  for (const facing of [-1, 1]) {
    for (const phase of [10, 22, 28, 42, 55, 65, 71, 77, 84, 92]) {
      await page.getByRole('slider', { name: 'Hop cycle', exact: true }).fill(String(phase));
      await page.evaluate(facing => { window.__longTable!.simulation.character.facing = facing; }, facing);
      const pose = await page.evaluate(() => window.__longTable!.view.getCharacterMotion()!);
      const transforms = transformRig(pose.rig);
      expect(transforms['left-ear'].angle * transforms['right-ear'].angle).toBeGreaterThanOrEqual(-1e-10);
      expect(Math.abs(transforms['left-ear'].angle - transforms['right-ear'].angle) * 180 / Math.PI).toBeLessThan(0.75);
      expect(transforms['left-arm'].angle).toBeCloseTo(transforms['right-arm'].angle, 10);
      const probes = [
        { id: 'left-ear' as const, point: { x: 6, y: 0.5 } },
        { id: 'right-ear' as const, point: { x: 12, y: 0.5 } },
        { id: 'left-foot' as const, point: { x: 5, y: 28.5 } },
        { id: 'right-foot' as const, point: { x: 13, y: 28.5 } },
      ].map(({ id, point }) => {
        const p = rigPoint(pose.rig, transforms, id, point);
        return { x: p.x, y: p.y - pose.hop * 29 / 12 };
      });
      expect(await canvasColors(page, probes)).toEqual(probes.map(() => [0, 0, 0, 255]));
      if (pose.hop === 0) {
        for (const [id, x] of [['left-foot', 5], ['right-foot', 13]] as const) {
          const sole = rigPoint(pose.rig, transforms, id, { x, y: 29 });
          expect(sole.x).toBeCloseTo(x, 10);
          expect(sole.y).toBeCloseTo(29, 10);
          expect(transforms[id].angle).toBeCloseTo(0, 10);
        }
      }
    }
  }
  await expect(page.getByRole('alert')).toBeHidden();
});

test('eyes and nose stay on the animated head throughout the expressive hop', async ({ page }, testInfo) => {
  await openMotion(page);
  const { face } = await artwork(page);
  const position = await page.evaluate(() => window.__longTable!.simulation.character.position);
  const frames = [];
  for (const phase of [0, 10, 15, 22, 28, 42, 55, 62, 65, 71, 77, 84, 92, 98]) {
    await page.getByRole('slider', { name: 'Hop cycle', exact: true }).fill(String(phase));
    const pose = await page.evaluate(() => window.__longTable!.view.getCharacterMotion()!);
    expect(pose.phase).toBeCloseTo(phase / 100);
    frames.push(pose);
    await expectAttachedFace(page, face);
    await page.locator('canvas').screenshot({ path: testInfo.outputPath(`hop-${phase}.png`) });
  }
  expect(new Set(frames.map(frame => frame.rig.parts.head.angle)).size).toBeGreaterThan(8);
  expect(new Set(frames.map(frame => frame.face.eyeScale.y)).size).toBeGreaterThan(8);
  expect(new Set(frames.map(frame => frame.face.noseOffset.y)).size).toBeGreaterThan(8);
  expect(await page.evaluate(() => window.__longTable!.simulation.character.position)).toEqual(position);
  await expect(page.getByRole('alert')).toBeHidden();
});

test('frame stepping and cycle inspection pause cleanly while applying saved Creation edits', async ({ page }) => {
  await openMotion(page);
  const before = await page.evaluate(() => window.__longTable!.simulation.character.animationTime);
  await page.getByRole('button', { name: 'Step one frame', exact: true }).click();
  expect(await page.evaluate(() => window.__longTable!.simulation.character.animationTime)).toBeCloseTo(before + 1 / 60);
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('slider', { name: 'Hop cycle', exact: true }).fill('24');
  const time = await page.evaluate(() => window.__longTable!.simulation.character.animationTime);
  const frame = await page.locator('canvas').screenshot();
  await page.waitForTimeout(200);
  expect(await page.locator('canvas').screenshot()).toEqual(frame);
  expect(await page.evaluate(() => window.__longTable!.simulation.character.animationTime)).toBe(time);
  await page.getByRole('combobox', { name: 'Playback speed', exact: true }).selectOption('0.25');
  await page.getByRole('button', { name: 'Creation', exact: true }).click();
  expect(await page.evaluate(() => window.__longTable!.view.getCharacterMotion())).toBeNull();
  await page.getByRole('slider', { name: 'Angle', exact: true }).fill('5');
  await page.getByRole('slider', { name: 'Squash / stretch', exact: true }).fill('-30');
  const creation = await page.evaluate(() => window.__longTable!.view.getCharacterRig());
  await page.getByRole('button', { name: 'Motion', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Playback speed', exact: true })).toHaveValue('0.25');
  expect(await page.locator('canvas').screenshot()).not.toEqual(frame);
  expect(await page.evaluate(() => window.__longTable!.simulation.character.animationTime)).toBe(time);
  await page.getByRole('button', { name: 'Creation', exact: true }).click();
  expect(await page.evaluate(() => window.__longTable!.view.getCharacterRig())).toEqual(creation);
  await expect(page.getByRole('alert')).toBeHidden();
});

test('slow playback changes animation time, not the ground anchor, and Idle disables cycle posing', async ({ page }) => {
  await openMotion(page);
  const position = await page.evaluate(() => window.__longTable!.simulation.character.position);
  await page.getByRole('combobox', { name: 'Playback speed', exact: true }).selectOption('0.25');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const quarter = await page.evaluate(() => window.__longTable!.simulation.character.animationTime);
  expect(quarter).toBeGreaterThan(0.1);
  expect(quarter).toBeLessThan(0.35);
  await page.getByRole('combobox', { name: 'Playback speed', exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const normal = await page.evaluate(() => window.__longTable!.simulation.character.animationTime);
  expect(normal - quarter).toBeGreaterThan(quarter * 2.5);
  expect(await page.evaluate(() => window.__longTable!.simulation.character.position)).toEqual(position);
  await page.getByRole('button', { name: 'Idle', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Hop cycle', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Hop', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Hop cycle', exact: true })).toBeEnabled();
});

test('gameplay uses the same articulated hop and attached facial features', async ({ page }) => {
  await page.goto('/#/play?paused=1');
  await page.waitForFunction(() => window.__longTable?.ready);
  const { face } = await artwork(page);
  await page.evaluate(distance => {
    const { simulation, view } = window.__longTable!;
    simulation.character.gaitDistance = 0.24 * distance;
    simulation.character.hop = { phase: 0.24, speed: 22, active: true };
    simulation.character.motionWeight = 1;
    simulation.character.facing = -1;
    view.zoomBy(100);
  }, HOP_DISTANCE);
  const pose = await page.evaluate(() => window.__longTable!.view.getCharacterMotion()!);
  expect(pose.phase).toBeCloseTo(0.24);
  expect(await page.evaluate(() => window.__longTable!.view.getCharacterRig())).toBeNull();
  await expectAttachedFace(page, face);
  await expect(page.getByRole('alert')).toBeHidden();
});

test('the real cutouts remain connected throughout the hop and its movement blend', async ({ page }) => {
  test.setTimeout(120000);
  await openMotion(page);
  const { layers } = await artwork(page);
  const failures: { phase: number; facing: number; weight: number; components: number }[] = [];
  const character = await page.evaluate(() => structuredClone(window.__longTable!.simulation.character));
  for (const facing of [-1, 0, 1]) {
    for (const weight of [0.25, 0.5, 1]) {
      for (let step = 0; step <= 100; step++) {
        character.gaitDistance = step / 100 * HOP_DISTANCE;
        character.hop = { phase: step === 100 ? 0 : step / 100, speed: 22, active: true };
        character.motionWeight = weight;
        character.facing = facing;
        const pose = sampleRabbitMotion(character);
        const transforms = transformRig(pose.rig);
        const bounds = rigBounds(pose.rig, layers);
        const width = Math.ceil(bounds.width * 4) + 4, height = Math.ceil(bounds.height * 4) + 4;
        const occupied = new Uint8Array(width * height);
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const point = { x: bounds.x - 0.5 + (x + 0.5) / 4, y: bounds.y - 0.5 + (y + 0.5) / 4 };
            occupied[y * width + x] = layers.some(layer => {
              const index = rigPixelAt(pose.rig, transforms[layer.id], layer, point);
              return index >= 0 && layer.pixels[index + 3] > 0;
            }) ? 1 : 0;
          }
        }
        let components = 0;
        for (let start = 0; start < occupied.length; start++) {
          if (!occupied[start]) continue;
          components++;
          const queue = [start];
          occupied[start] = 0;
          for (let cursor = 0; cursor < queue.length; cursor++) {
            const index = queue[cursor], x = index % width, y = Math.floor(index / width);
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
                const next = (y + dy) * width + x + dx;
                if (occupied[next]) { occupied[next] = 0; queue.push(next); }
              }
            }
          }
        }
        if (components !== 1) failures.push({ phase: step / 100, facing, weight, components });
      }
    }
  }
  expect(failures).toEqual([]);
});

test('the supplied blink frames affect only the attached eyes, including during a hop', async ({ page }) => {
  await openMotion(page);
  const { face } = await artwork(page);
  await page.getByRole('slider', { name: 'Hop cycle', exact: true }).fill('32');
  const before = await page.evaluate(() => window.__longTable!.view.getCharacterMotion()!.rig);
  for (const time of [4.57, 4.6, 4.7]) {
    await page.evaluate(time => { window.__longTable!.simulation.character.animationTime = time; }, time);
    const pose = await page.evaluate(() => window.__longTable!.view.getCharacterMotion()!);
    expect(pose.face.blink).toBe(time < 4.7);
    expect(pose.rig).toEqual(before);
    await expectAttachedFace(page, face);
  }
});

test('the actual view advances continuously and matches 15 through 144 Hz plus irregular frames', async ({ page }) => {
  await openMotion(page);
  const result = await page.evaluate(() => {
    const { simulation, view } = window.__longTable!;
    const controller = view as typeof view & { update(deltaMilliseconds: number): void; scene: Phaser.Scene };
    if (typeof controller.update !== 'function') throw new Error('The frame update entry point is unavailable.');
    const loop = controller.scene.game.loop;
    loop.stop();
    if (loop.smoothStep) throw new Error('The engine is still averaging elapsed time over frame counts.');
    let time = loop.lastTime;
    const frame = (seconds: number) => { time += seconds * 1000; loop.step(time); };
    const initial = structuredClone(simulation.character);
    const reset = () => {
      view.setPaused(true);
      Object.assign(simulation.character, structuredClone(initial));
      view.setCharacterMode('hop');
      view.setCharacterPlaybackSpeed(1);
      view.setPaused(false);
      frame(0);
    };
    reset();
    frame(1 / 144);
    const firstHighRefreshFrame = structuredClone(simulation.character);
    const patterns = [15, 30, 60, 120, 144].map(fps => [1 / fps]);
    patterns.push([0.011, 0.034, 0.007, 0.052]);
    const runs = patterns.map(pattern => {
      reset();
      const snapshots = [];
      for (const stage of [
        { seconds: 0.7, mode: 'hop' as const, playback: 1 },
        { seconds: 0.3, mode: 'shallows' as const, playback: 0.25 },
        { seconds: 0.6, mode: 'hop' as const, playback: 1 },
        { seconds: 0.8, mode: 'idle' as const, playback: 1 },
      ]) {
        view.setCharacterMode(stage.mode);
        view.setCharacterPlaybackSpeed(stage.playback);
        let elapsed = 0, index = 0;
        while (elapsed < stage.seconds - 1e-12) {
          const delta = Math.min(pattern[index++ % pattern.length], stage.seconds - elapsed);
          frame(delta);
          elapsed += delta;
        }
        snapshots.push({ character: structuredClone(simulation.character), pose: view.getCharacterMotion()! });
      }
      return snapshots;
    });
    view.setPaused(true);
    return { firstHighRefreshFrame, runs };
  });
  expect(result.firstHighRefreshFrame.animationTime).toBeCloseTo(1 / 144, 12);
  expect(result.firstHighRefreshFrame.hop.phase).toBeGreaterThan(0);
  for (const timeline of result.runs.slice(1)) {
    for (const [index, run] of timeline.entries()) {
      const expected = result.runs[0][index];
      expect(run.character.animationTime).toBeCloseTo(expected.character.animationTime, 10);
      expect(run.character.gaitDistance).toBeCloseTo(expected.character.gaitDistance, 10);
      expect(run.character.motionWeight).toBeCloseTo(expected.character.motionWeight, 10);
      expect(run.character.hop.phase).toBeCloseTo(expected.character.hop.phase, 10);
      expect(run.character.hop.speed).toBeCloseTo(expected.character.hop.speed, 10);
      expect(run.character.hop.active).toBe(expected.character.hop.active);
      expect(run.pose.hop).toBeCloseTo(expected.pose.hop, 10);
      for (const id of Object.keys(expected.pose.rig.parts) as (keyof typeof expected.pose.rig.parts)[]) {
        expect(run.pose.rig.parts[id].angle).toBeCloseTo(expected.pose.rig.parts[id].angle, 10);
        expect(run.pose.rig.parts[id].squashStretch).toBeCloseTo(expected.pose.rig.parts[id].squashStretch, 10);
        expect(run.pose.rig.parts[id].offset.x).toBeCloseTo(expected.pose.rig.parts[id].offset.x, 10);
        expect(run.pose.rig.parts[id].offset.y).toBeCloseTo(expected.pose.rig.parts[id].offset.y, 10);
      }
    }
  }
  await expect(page.getByRole('alert')).toBeHidden();
});

test('elapsed view updates also preserve physical gameplay speed across refresh rates', async ({ page }) => {
  await page.goto('/#/navigation?paused=1');
  await page.waitForFunction(() => window.__longTable?.ready);
  const runs = await page.evaluate(() => {
    const { simulation, view } = window.__longTable!;
    const controller = view as typeof view & { update(deltaMilliseconds: number): void };
    const initial = structuredClone(simulation.character);
    let target: Point | undefined;
    for (let y = 0; y < simulation.world.height && !target; y++) {
      for (let x = 0; x < simulation.world.width; x++) {
        const point = { x: (x + 0.5) * simulation.world.tileSize, y: (y + 0.5) * simulation.world.tileSize };
        const length = Math.hypot(point.x - initial.position.x, point.y - initial.position.y);
        if (length > 30 && length < 60 && simulation.navigation.speedAt(point) === 1
          && simulation.navigation.segmentClear(initial.position, point, true)) {
          target = point;
          break;
        }
      }
    }
    if (!target) throw new Error('The navigation fixture has no clear normal-speed test segment.');
    const results = [];
    for (const fps of [15, 30, 60, 120, 144]) {
      view.setPaused(true);
      simulation.character = structuredClone(initial);
      simulation.elapsed = 0;
      simulation.moveTo(target);
      view.setPaused(false);
      controller.update(0);
      for (let frame = 0; frame < fps; frame++) controller.update(1000 / fps);
      results.push({
        position: { ...simulation.character.position }, distance: simulation.character.gaitDistance,
        elapsed: simulation.elapsed, phase: simulation.character.hop.phase,
      });
    }
    view.setPaused(true);
    return results;
  });
  for (const run of runs) {
    expect(run.elapsed).toBeCloseTo(1, 10);
    expect(run.distance).toBeCloseTo(22, 8);
    expect(run.position.x).toBeCloseTo(runs[0].position.x, 8);
    expect(run.position.y).toBeCloseTo(runs[0].position.y, 8);
    expect(run.phase).toBeCloseTo(runs[0].phase, 8);
  }
  await expect(page.getByRole('alert')).toBeHidden();
});

test('live playback changes ease in time and pauses or long stalls never replay a backlog', async ({ page }) => {
  await openMotion(page);
  const result = await page.evaluate(() => {
    const { simulation, view } = window.__longTable!;
    const controller = view as typeof view & { update(deltaMilliseconds: number): void };
    view.setCharacterPlaybackSpeed(0.25);
    view.setPaused(false);
    controller.update(0);
    view.setCharacterPlaybackSpeed(1);
    controller.update(100);
    const rampUp = simulation.character.animationTime;
    for (let step = 0; step < 5; step++) controller.update(100);
    let before = simulation.character.animationTime;
    controller.update(100);
    const settled = simulation.character.animationTime - before;
    view.setCharacterPlaybackSpeed(0.25);
    before = simulation.character.animationTime;
    controller.update(100);
    const rampDown = simulation.character.animationTime - before;
    view.setPaused(true);
    before = simulation.character.animationTime;
    controller.update(5000);
    const paused = simulation.character.animationTime - before;
    view.setCharacterPlaybackSpeed(1);
    view.setPaused(false);
    controller.update(0);
    before = simulation.character.animationTime;
    controller.update(5000);
    const stalled = simulation.character.animationTime - before;
    view.setPaused(true);
    return { rampUp, settled, rampDown, paused, stalled };
  });
  expect(result.rampUp).toBeCloseTo(0.1 - 0.75 * (1 - Math.exp(-0.8)) / 8, 12);
  expect(result.settled).toBeGreaterThan(0.098);
  expect(result.rampDown).toBeGreaterThan(0.025);
  expect(result.rampDown).toBeLessThan(0.1);
  expect(result.paused).toBe(0);
  expect(result.stalled).toBeCloseTo(0.25, 12);
  await expect(page.getByRole('alert')).toBeHidden();
});

test('new playback controls are keyboard reachable and contained at narrow widths', async ({ page }, testInfo) => {
  await openMotion(page);
  for (const viewport of [{ width: 1280, height: 850 }, { width: 320, height: 780 }]) {
    await page.setViewportSize(viewport);
    const cycle = page.getByRole('slider', { name: 'Hop cycle', exact: true });
    await cycle.focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await expect(cycle).toHaveValue('1');
    await expect(cycle).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    const frame = page.getByRole('button', { name: 'Step one frame', exact: true });
    await frame.focus();
    await expect(frame).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`motion-${viewport.width}.png`) });
  }
  await expect(page.getByRole('alert')).toBeHidden();
});
