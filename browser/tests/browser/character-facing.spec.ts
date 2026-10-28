import { expect, test } from '@playwright/test';
import type Phaser from 'phaser';
import '../../src/debug';

test('facing mirrors every animated layer around the anchor without changing setup, phase or camera', async ({ page }) => {
  await page.goto('/#/character?tab=customization&colorSeed=42&paused=1');
  await page.getByRole('button', { name: 'Both floppy', exact: true }).click();
  await page.getByRole('button', { name: 'Curious', exact: true }).click();
  await page.getByRole('button', { name: 'Bandana', exact: true }).click();
  await page.getByRole('button', { name: 'Creation', exact: true }).click();
  await page.getByRole('slider', { name: 'Position X', exact: true }).fill('1.5');
  await page.getByRole('slider', { name: 'Angle', exact: true }).fill('5');
  const setup = await page.evaluate(() => window.__longTable!.view.getCharacterRig());
  await page.getByRole('button', { name: 'Motion', exact: true }).click();
  const drawing = () => page.evaluate(() => {
    const { view, simulation } = window.__longTable!;
    const controller = view as typeof view & { scene: Phaser.Scene };
    const images = controller.scene.children.list.filter((child): child is Phaser.GameObjects.Image =>
      child.type === 'Image' && (child as Phaser.GameObjects.Image).texture.key.startsWith('motion-'));
    return {
      position: { ...simulation.character.position }, camera: view.getCameraState(),
      appearance: view.getCharacterAppearance(), pose: view.getCharacterMotion()!,
      layers: images.map(image => {
        const matrix = image.getWorldTransformMatrix();
        return { key: image.texture.key, a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, x: matrix.tx, y: matrix.ty };
      }),
    };
  });
  for (const mode of ['Hop', 'Shallows', 'Idle']) {
    await page.getByRole('button', { name: mode, exact: true }).click();
    for (const phase of mode === 'Idle' ? [0] : [0, 24, 66]) {
      await page.getByRole('combobox', { name: 'Facing direction', exact: true }).selectOption('1');
      if (mode !== 'Idle') await page.getByRole('slider', { name: 'Hop cycle', exact: true }).fill(String(phase));
      const right = await drawing();
      const rightPixels = await page.getByLabel('Animated pixel-art rabbit', { exact: true }).screenshot();
      await page.getByRole('combobox', { name: 'Facing direction', exact: true }).selectOption('-1');
      await expect(page.getByRole('combobox', { name: 'Facing direction', exact: true })).toHaveValue('-1');
      const left = await drawing();
      expect(left.pose).toEqual({
        ...right.pose, facingDirection: -1,
        summary: { ...right.pose.summary, rotation: right.pose.summary.rotation === 0 ? 0 : -right.pose.summary.rotation },
      });
      expect(left.position).toEqual(right.position);
      expect(left.camera).toEqual(right.camera);
      expect(left.appearance).toEqual(right.appearance);
      expect(left.layers.length).toBeGreaterThanOrEqual(12);
      expect(left.layers.every(layer => layer.a > 0)).toBe(true);
      expect(right.layers.every(layer => layer.a < 0)).toBe(true);
      for (const [index, layer] of left.layers.entries()) {
        const original = right.layers[index];
        expect(layer.key).toBe(original.key);
        expect(layer.a).toBeCloseTo(-original.a, 5);
        expect(layer.c).toBeCloseTo(-original.c, 5);
        expect(layer.x).toBeCloseTo(2 * left.position.x - original.x, 5);
        expect(layer.b).toBeCloseTo(original.b, 5);
        expect(layer.d).toBeCloseTo(original.d, 5);
        expect(layer.y).toBeCloseTo(original.y, 5);
      }
      expect(await page.getByLabel('Animated pixel-art rabbit', { exact: true }).screenshot()).not.toEqual(rightPixels);
    }
  }
  await page.getByRole('button', { name: 'Hop', exact: true }).click();
  await page.getByRole('slider', { name: 'Hop cycle', exact: true }).fill('42');
  await page.getByRole('button', { name: 'Step one frame', exact: true }).click();
  expect((await drawing()).pose.facingDirection).toBe(-1);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__longTable!.simulation.character.animationTime)).toBeGreaterThan(0.1);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  expect((await drawing()).pose.facingDirection).toBe(-1);
  await page.getByRole('button', { name: 'Creation', exact: true }).click();
  expect(await page.evaluate(() => window.__longTable!.view.getCharacterRig())).toEqual(setup);
  await page.getByRole('button', { name: 'Motion', exact: true }).click();
  expect((await drawing()).pose.facingDirection).toBe(-1);
  await page.getByRole('button', { name: 'Reset this explorer', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Facing direction', exact: true })).toHaveValue('-1');
  expect((await drawing()).pose.facingDirection).toBe(-1);
  await expect(page.getByRole('alert')).toBeHidden();
});

test('real navigation travel automatically turns every layer and stopping retains the heading', async ({ page }) => {
  await page.goto('/#/navigation?fixture=test&paused=1');
  await page.waitForFunction(() => window.__longTable?.ready);
  for (const sign of [-1, 1]) {
    const result = await page.evaluate(sign => {
      const { simulation, view } = window.__longTable!;
      const start = { ...simulation.character.position };
      const target = { x: start.x + sign * 8, y: start.y };
      if (!simulation.navigation.segmentClear(start, target)) throw new Error('Facing test needs a clear horizontal route.');
      simulation.moveTo(target);
      for (let frame = 0; frame < 180; frame++) simulation.advance(1 / 60);
      (view as typeof view & { update(delta: number): void }).update(0);
      const controller = view as typeof view & { scene: Phaser.Scene };
      return {
        start, target, position: simulation.character.position,
        heading: simulation.character.facingDirection, active: simulation.character.hop.active,
        scales: controller.scene.children.list.filter((child): child is Phaser.GameObjects.Image =>
          child.type === 'Image' && (child as Phaser.GameObjects.Image).texture.key.startsWith('motion-'))
          .map(image => image.scaleX),
      };
    }, sign);
    expect(result.position).toEqual(result.target);
    expect(result.position.x - result.start.x).toBe(sign * 8);
    expect(result.heading).toBe(sign);
    expect(result.active).toBe(false);
    expect(result.scales.length).toBeGreaterThanOrEqual(11);
    // The source artwork faces left: left travel is unmirrored, right travel is mirrored.
    expect(result.scales.every(scale => Math.sign(scale) === -sign)).toBe(true);
  }
  await expect(page.getByRole('alert')).toBeHidden();
});
