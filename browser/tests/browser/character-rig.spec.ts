import { expect, test, type Page } from '@playwright/test';
import '../../src/debug';
import { buildRigLayers, createCharacterRig, RABBIT_PARTS, rigBounds, rigPixelAt, rigPoint, transformRig } from '../../src/core/character-rig';
import type { Rectangle } from '../../src/core/contracts';

async function openCreation(page: Page): Promise<void> {
  await page.goto('/#/character');
  await page.waitForFunction(() => window.__longTable?.ready);
  await expect(page.getByRole('alert')).toBeHidden();
}

async function slider(page: Page, name: string, value: number): Promise<void> {
  await page.getByRole('slider', { name, exact: true }).fill(String(value));
}

async function rabbitPixels(page: Page): Promise<Uint8ClampedArray> {
  return new Uint8ClampedArray(await page.evaluate(async () => {
    const image = new Image();
    image.src = '/assets/rabbit.png';
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    return Array.from(context.getImageData(0, 0, image.width, image.height).data);
  }));
}

async function sourceClip(page: Page, region: Rectangle): Promise<Rectangle> {
  return page.evaluate(region => {
    const { view, simulation } = window.__longTable!;
    const canvas = document.querySelector('canvas')!.getBoundingClientRect();
    const point = (x: number, y: number) => view.worldToScreen({
      x: simulation.character.position.x + (x - 9) * 12 / 29,
      y: simulation.character.position.y + (y - 29) * 12 / 29,
    });
    const a = point(region.x, region.y);
    const b = point(region.x + region.width, region.y + region.height);
    return { x: canvas.x + a.x, y: canvas.y + a.y, width: b.x - a.x, height: b.y - a.y };
  }, region);
}

async function blackBounds(page: Page, png: Buffer): Promise<{ width: number; height: number }> {
  return page.evaluate(async base64 => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    let left = image.width, top = image.height, right = -1, bottom = -1;
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const index = (y * image.width + x) * 4;
        if (pixels[index] !== 0 || pixels[index + 1] !== 0 || pixels[index + 2] !== 0 || pixels[index + 3] !== 255) continue;
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
    if (right < left || bottom < top) throw new Error('The inspected region contains no black artwork.');
    return { width: right - left + 1, height: bottom - top + 1 };
  }, png.toString('base64'));
}

async function downloadRig(page: Page): Promise<string> {
  const button = page.getByRole('button', { name: 'Download rig' });
  if (!await button.isVisible()) await page.getByText('Rig data', { exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await button.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('rabbit-rig.json');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString();
}

test('removed demo URLs fall back to Creation with only the existing character tabs', async ({ page }) => {
  await page.goto('/#/character?tab=directions');
  await page.waitForFunction(() => window.__longTable?.ready);
  const tabs = page.locator('.character-tabs');
  await expect(tabs.getByRole('button')).toHaveText(['Creation', 'Motion', 'Customization']);
  await expect(page.getByRole('button', { name: 'Creation', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.runtime')).toHaveAttribute('data-character-tab', 'creation');
  await expect(page.getByRole('combobox', { name: 'Character part' })).toBeVisible();
  await expect(page.getByRole('alert')).toBeHidden();
});

test('creation has eight real parts, matches the original at rest, and freezes motion', async ({ page }) => {
  await openCreation(page);
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(page.locator('.runtime-header .toolbar')).toHaveCount(1);
  await expect(page.locator('.runtime > .toolbar, .runtime-footer')).toHaveCount(0);
  await expect(page.getByRole('complementary')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Creation', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('combobox', { name: 'Character part' }).locator('option')).toHaveCount(8);
  const initial = await page.evaluate(() => ({
    time: window.__longTable!.simulation.character.animationTime,
    audit: window.__longTable!.view.getCharacterRigAudit(),
    position: { ...window.__longTable!.simulation.character.position },
  }));
  expect(initial.audit).toEqual({ restDifferencePixels: 0, jointCount: 7, uncoveredJoints: [] });
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.__longTable!.simulation.character.animationTime)).toBe(initial.time);
  await slider(page, 'Explode', 100);
  expect(await page.evaluate(() => window.__longTable!.simulation.character.position)).toEqual(initial.position);
  await expect(page.getByLabel('Joint center check')).toHaveText('Assemble to inspect joints');
  await slider(page, 'Explode', 0);
  await expect(page.getByLabel('Joint center check')).toHaveText('7 joint centers covered');
});

test('part selection, pose limits, editable pivots, export and reset work', async ({ page }) => {
  await openCreation(page);
  await slider(page, 'Explode', 100);
  const point = await page.evaluate(() => {
    const { view, simulation } = window.__longTable!;
    const canvas = document.querySelector('canvas')!.getBoundingClientRect();
    const p = view.worldToScreen({
      x: simulation.character.position.x + (-9.5 - 9) * 12 / 29,
      y: simulation.character.position.y + (22.5 - 29) * 12 / 29,
    });
    return { x: canvas.x + p.x, y: canvas.y + p.y };
  });
  await page.mouse.click(point.x, point.y);
  await expect(page.getByRole('combobox', { name: 'Character part' })).toHaveValue('left-arm');
  await page.getByRole('combobox', { name: 'Character part' }).selectOption('head');
  await expect(page.getByRole('slider', { name: 'Angle', exact: true })).toHaveAttribute('max', '12');
  await slider(page, 'Angle', 8);
  await page.getByText('Pivot', { exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Pivot Y', exact: true }).fill('30');
  await page.getByRole('spinbutton', { name: 'Pivot Y', exact: true }).press('Tab');
  await expect(page.getByRole('alert')).toContainText('Pivot Y must be from 0 to 29');
  expect(await page.evaluate(() => window.__longTable!.view.getCharacterRig()!.parts.head.pivot.y)).toBe(18);
  await page.getByRole('spinbutton', { name: 'Pivot Y', exact: true }).fill('17.5');
  await page.getByRole('spinbutton', { name: 'Pivot Y', exact: true }).press('Tab');
  await expect(page.getByRole('alert')).toBeHidden();
  expect(await page.evaluate(() => window.__longTable!.view.getCharacterRig()!.parts.head)).toEqual({
    angle: 8, pivot: { x: 9, y: 17.5 }, offset: { x: 0, y: 0 }, squashStretch: 0,
  });
  const data = JSON.parse(await downloadRig(page));
  expect(data.layers).toHaveLength(8);
  expect(data.pose.head).toEqual({
    angle: 8, pivot: { x: 9, y: 17.5 }, offset: { x: 0, y: 0 }, squashStretch: 0, scale: { x: 1, y: 1 },
  });
  await page.getByRole('button', { name: 'Reset rig' }).click();
  expect(await page.evaluate(() => window.__longTable!.view.getCharacterRig()!.parts.head)).toEqual({
    angle: 0, pivot: { x: 9, y: 18 }, offset: { x: 0, y: 0 }, squashStretch: 0,
  });
  await expect(page.getByRole('slider', { name: 'Explode', exact: true })).toHaveValue('0');
  await expect(page.getByRole('alert')).toBeHidden();
});

test('positioning is always available and reset restores the neutral rig', async ({ page }) => {
  await openCreation(page);
  await expect(page.getByRole('group', { name: 'Rig model', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Original', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Positioning', exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Part positioning', exact: true })).toBeVisible();
  const baselineState = await page.evaluate(() => window.__longTable!.view.getCharacterRig());
  const baseline = await page.locator('canvas').screenshot();
  const zoom = await page.evaluate(() => window.__longTable!.view.getCameraState().zoom);
  await slider(page, 'Position Y', -2);
  const moved = await page.locator('canvas').screenshot();
  expect(moved).not.toEqual(baseline);
  expect(await page.evaluate(() => window.__longTable!.view.getCharacterRig()!.parts.head)).toEqual({
    angle: 0, pivot: { x: 9, y: 18 }, offset: { x: 0, y: -2 }, squashStretch: 0,
  });
  expect(await page.evaluate(() => window.__longTable!.view.getCameraState().zoom)).toBe(zoom);
  const picked = await page.evaluate(() => {
    const { view, simulation } = window.__longTable!;
    return view.pickCharacterRigPart({
      x: simulation.character.position.x + 0.5 * 12 / 29,
      y: simulation.character.position.y + (8.5 - 29) * 12 / 29,
    });
  });
  expect(picked).toBe('head');
  expect(await page.evaluate(() => window.__longTable!.view.getCharacterRig())).toEqual({
    ...baselineState, parts: { ...baselineState!.parts, head: {
      ...baselineState!.parts.head, offset: { x: 0, y: -2 },
    } },
  });
  await expect(page.getByRole('slider', { name: 'Position Y', exact: true })).toHaveValue('-2');
  expect(await page.locator('canvas').screenshot()).toEqual(moved);
  await page.getByRole('button', { name: 'Reset position', exact: true }).click();
  expect(await page.locator('canvas').screenshot()).toEqual(baseline);
  await expect(page.getByRole('group', { name: 'Part positioning', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset position', exact: true })).toBeDisabled();
  await expect(page.getByRole('alert')).toBeHidden();
});

test('position offsets respect selection, preserve pivots on reset, and always export', async ({ page }) => {
  await openCreation(page);
  await slider(page, 'Position X', 1.5);
  await slider(page, 'Position Y', -1);
  await slider(page, 'Angle', 6);
  await page.getByText('Pivot', { exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Pivot Y', exact: true }).fill('17.5');
  await page.getByRole('spinbutton', { name: 'Pivot Y', exact: true }).press('Tab');
  await page.getByRole('combobox', { name: 'Character part' }).selectOption('left-arm');
  await expect(page.getByRole('slider', { name: 'Position X', exact: true })).toHaveValue('0');
  await slider(page, 'Position X', -0.5);
  await page.getByRole('combobox', { name: 'Character part' }).selectOption('head');
  await expect(page.getByRole('slider', { name: 'Position X', exact: true })).toHaveValue('1.5');
  const positioned = JSON.parse(await downloadRig(page));
  expect(positioned.schemaVersion).toBe(5);
  expect(positioned.positioning).toEqual({ space: 'parent', limit: 3 });
  expect(positioned.pose.head).toEqual({
    angle: 6, pivot: { x: 9, y: 17.5 }, offset: { x: 1.5, y: -1 }, squashStretch: 0, scale: { x: 1, y: 1 },
  });
  await page.getByRole('button', { name: 'Reset position', exact: true }).click();
  expect(await page.evaluate(() => window.__longTable!.view.getCharacterRig()!.parts.head)).toEqual({
    angle: 6, pivot: { x: 9, y: 17.5 }, offset: { x: 0, y: 0 }, squashStretch: 0,
  });
  expect(await page.evaluate(() => window.__longTable!.view.getCharacterRig()!.parts['left-arm'].offset.x)).toBe(-0.5);
  await page.getByRole('button', { name: 'Reset rig', exact: true }).click();
  const reset = await page.evaluate(() => window.__longTable!.view.getCharacterRig());
  expect(reset).toEqual(createCharacterRig());
  const exportedReset = JSON.parse(await downloadRig(page));
  expect(exportedReset.schemaVersion).toBe(5);
  expect(exportedReset.pose.head.offset).toEqual({ x: 0, y: 0 });
  await slider(page, 'Position Y', 1);
  await page.getByRole('slider', { name: 'Position Y', exact: true }).blur();
  await page.keyboard.press('r');
  await expect(page.getByRole('slider', { name: 'Position Y', exact: true })).toHaveValue('0');
  await expect(page.getByRole('group', { name: 'Part positioning', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toBeHidden();
});

test('manual squash and stretch reshape the torso, keep rigid children and feet, and restore neutral exactly', async ({ page }) => {
  await openCreation(page);
  await page.getByRole('combobox', { name: 'Character part' }).selectOption('body');
  const shape = page.getByRole('slider', { name: 'Squash / stretch', exact: true });
  await expect(shape).toHaveValue('0');
  await expect(shape).toHaveAttribute('aria-valuetext', 'Neutral');
  const setup = await page.evaluate(() => window.__longTable!.view.getCharacterRig()!);
  const neutral = transformRig(setup);
  const baseline = await page.locator('canvas').screenshot();
  const time = await page.evaluate(() => window.__longTable!.simulation.character.animationTime);
  for (const value of [-100, 100]) {
    await slider(page, 'Squash / stretch', value);
    await expect(shape).toHaveAttribute('aria-valuetext', `${value < 0 ? 'Squash' : 'Stretch'} 100%`);
    expect(await page.locator('canvas').screenshot()).not.toEqual(baseline);
    const state = await page.evaluate(() => window.__longTable!.view.getCharacterRig()!);
    expect(state.parts).toEqual({
      ...setup.parts, body: { ...setup.parts.body, squashStretch: value / 100 },
    });
    const transforms = transformRig(state);
    for (const id of ['left-foot', 'right-foot'] as const) expect(transforms[id]).toEqual(neutral[id]);
    for (const part of RABBIT_PARTS.filter(part => part.id !== 'body')) {
      expect(transforms[part.id].scale).toEqual({ x: 1, y: 1 });
    }
    const point = rigPoint(state, transforms, 'body', { x: 9.5, y: 23.5 });
    const picked = await page.evaluate(point => {
      const { view, simulation } = window.__longTable!;
      return view.pickCharacterRigPart({
        x: simulation.character.position.x + (point.x - 9) * 12 / 29,
        y: simulation.character.position.y + (point.y - 29) * 12 / 29,
      });
    }, point);
    expect(picked).toBe('body');
    await expect(page.getByLabel('Joint center check')).toHaveText('7 joint centers covered');
  }
  expect(await page.evaluate(() => window.__longTable!.simulation.character.animationTime)).toBe(time);
  await slider(page, 'Squash / stretch', 0);
  expect(await page.locator('canvas').screenshot()).toEqual(baseline);
  expect(await page.evaluate(() => window.__longTable!.view.getCharacterRig())).toEqual(setup);
});

test('selected-part shapes are exported, remembered separately, and reset without disturbing position controls', async ({ page }) => {
  await openCreation(page);
  await slider(page, 'Squash / stretch', -60);
  await slider(page, 'Position Y', 1);
  await slider(page, 'Angle', 4);
  await page.getByRole('button', { name: 'Reset position', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Squash / stretch', exact: true })).toHaveValue('-60');
  await expect(page.getByRole('slider', { name: 'Angle', exact: true })).toHaveValue('4');
  await page.getByRole('combobox', { name: 'Character part' }).selectOption('left-arm');
  await expect(page.getByRole('slider', { name: 'Squash / stretch', exact: true })).toHaveValue('0');
  await slider(page, 'Squash / stretch', 35);
  await page.getByRole('combobox', { name: 'Character part' }).selectOption('head');
  await expect(page.getByRole('slider', { name: 'Squash / stretch', exact: true })).toHaveValue('-60');
  const data = JSON.parse(await downloadRig(page));
  expect(data.schemaVersion).toBe(5);
  expect(data.bodyShape).toBeUndefined();
  expect(data.pose.head.scale.x).toBeCloseTo(1.6);
  expect(data.pose.head.scale.y).toBeCloseTo(0.52);
  expect(data.pose.head).toMatchObject({
    angle: 4, pivot: { x: 9, y: 18 }, offset: { x: 0, y: 0 }, squashStretch: -0.6,
  });
  expect(data.pose['left-arm'].squashStretch).toBe(0.35);
  expect(data.pose.body.squashStretch).toBe(0);
  await page.getByRole('button', { name: 'Reset rig', exact: true }).click();
  expect(await page.evaluate(() => window.__longTable!.view.getCharacterRig())).toEqual(createCharacterRig());
  await expect(page.getByRole('slider', { name: 'Squash / stretch', exact: true })).toHaveAttribute('aria-valuetext', 'Neutral');
  await slider(page, 'Squash / stretch', 50);
  await page.getByRole('slider', { name: 'Squash / stretch', exact: true }).blur();
  await page.keyboard.press('r');
  await expect(page.getByRole('slider', { name: 'Squash / stretch', exact: true })).toHaveValue('0');
  await expect(page.getByRole('alert')).toBeHidden();
});

test('Head selection reshapes the actual head pixels without changing the torso pixels', async ({ page }) => {
  await openCreation(page);
  await slider(page, 'Explode', 100);
  await page.getByRole('button', { name: 'Joints', exact: true }).click();
  const select = page.getByRole('combobox', { name: 'Character part' });
  await select.selectOption('body');
  const headLayer = buildRigLayers(await rabbitPixels(page)).filter(layer => layer.id === 'head');
  const bodyClip = await sourceClip(page, { x: 2, y: 16, width: 14, height: 14 });
  const setup = await page.evaluate(() => window.__longTable!.view.getCharacterRig()!);
  const headClip = await sourceClip(page, rigBounds(setup, headLayer));
  const bodyPixels = await page.screenshot({ clip: bodyClip });
  await blackBounds(page, bodyPixels);
  const neutral = await blackBounds(page, await page.screenshot({ clip: headClip }));
  for (const value of [-100, 100]) {
    await select.selectOption('head');
    await slider(page, 'Squash / stretch', value);
    const state = await page.evaluate(() => window.__longTable!.view.getCharacterRig()!);
    expect(state.parts.head.squashStretch).toBe(value / 100);
    expect(state.parts.body.squashStretch).toBe(0);
    await select.selectOption('body');
    expect(await page.screenshot({ clip: bodyClip })).toEqual(bodyPixels);
    const changedClip = await sourceClip(page, rigBounds(state, headLayer));
    const head = await blackBounds(page, await page.screenshot({ clip: changedClip }));
    if (value < 0) {
      expect(head.width).toBeGreaterThanOrEqual(neutral.width * 1.95);
      expect(head.height).toBeLessThanOrEqual(neutral.height * 0.25);
    } else {
      expect(head.width).toBeLessThanOrEqual(neutral.width * 0.45);
      expect(head.height).toBeGreaterThanOrEqual(neutral.height * 2.45);
    }
    await select.selectOption('head');
    await expect(page.getByRole('slider', { name: 'Squash / stretch', exact: true })).toHaveValue(String(value));
  }
});

test('all forehead outline strokes follow the head through strong squash, stretch and rotation', async ({ page }) => {
  await openCreation(page);
  await page.getByRole('button', { name: 'Joints', exact: true }).click();
  const source = await rabbitPixels(page);
  const blackX = Array.from({ length: 18 }, (_, x) => x).filter(x => {
    const index = (6 * 18 + x) * 4;
    return source[index] === 0 && source[index + 1] === 0 && source[index + 2] === 0 && source[index + 3] === 255;
  });
  expect(blackX).toEqual([3, 4, 7, 8, 9, 10, 13, 14]);
  const select = page.getByRole('combobox', { name: 'Character part' });
  for (const shape of [-100, -50, 0, 50, 100]) {
    for (const angle of [-12, 0, 12]) {
      await select.selectOption('head');
      await slider(page, 'Squash / stretch', shape);
      await slider(page, 'Angle', angle);
      await select.selectOption('left-foot');
      const state = await page.evaluate(() => window.__longTable!.view.getCharacterRig()!);
      const transforms = transformRig(state);
      const points = blackX.map(x => rigPoint(state, transforms, 'head', { x: x + 0.5, y: 6.5 }));
      const screen = await page.evaluate(points => {
        const { view, simulation } = window.__longTable!;
        return points.map(point => view.worldToScreen({
          x: simulation.character.position.x + (point.x - 9) * 12 / 29,
          y: simulation.character.position.y + (point.y - 29) * 12 / 29,
        }));
      }, points);
      const png = await page.locator('canvas').screenshot();
      const colors = await page.evaluate(async ({ base64, points }) => {
        const image = new Image(); image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        const scale = image.width / document.querySelector('canvas')!.getBoundingClientRect().width;
        return points.map(point => Array.from(context.getImageData(
          Math.floor(point.x * scale), Math.floor(point.y * scale), 1, 1,
        ).data));
      }, { base64: png.toString('base64'), points: screen });
      expect(colors, `forehead pixels at shape ${shape}, angle ${angle}`).toEqual(blackX.map(() => [0, 0, 0, 255]));
    }
  }
});

test('real torso and arm layers have complete, independent outlines and preserve Neutral exactly', async ({ page }) => {
  await openCreation(page);
  const source = await rabbitPixels(page);
  const before = source.slice();
  const layers = buildRigLayers(source);
  const blackPixels = (id: string): number[][] => {
    const pixels = layers.find(layer => layer.id === id)!.pixels;
    const points: number[][] = [];
    for (let y = 0; y < 29; y++) {
      for (let x = 0; x < 18; x++) {
        const index = (y * 18 + x) * 4;
        if (pixels[index] === 0 && pixels[index + 1] === 0 && pixels[index + 2] === 0 && pixels[index + 3] === 255) {
          points.push([x, y]);
        }
      }
    }
    return points;
  };
  expect(blackPixels('body')).toEqual([
    ...Array.from({ length: 7 }, (_, y) => [[4, y + 19], [13, y + 19]]).flat(),
    ...Array.from({ length: 10 }, (_, x) => [x + 4, 26]),
  ]);
  expect(blackPixels('left-arm')).toEqual([[3, 20], [3, 21], [2, 22], [2, 23], [2, 24], [3, 25], [4, 25]]);
  expect(blackPixels('right-arm')).toEqual([[14, 20], [14, 21], [15, 22], [15, 23], [15, 24], [13, 25], [14, 25]]);
  expect(source).toEqual(before);
  expect(await page.evaluate(() => window.__longTable!.view.getCharacterRigAudit()!.restDifferencePixels)).toBe(0);
  const exported = JSON.parse(await downloadRig(page));
  expect(exported.schemaVersion).toBe(5);
  expect(exported.layers.find((part: { id: string }) => part.id === 'body').underpainting).toEqual(
    RABBIT_PARTS.find(part => part.id === 'body')!.underpainting,
  );
});

test('all eight rendered part outlines deform together through squash, stretch and both rotation limits', async ({ page }) => {
  test.setTimeout(120000);
  await openCreation(page);
  const layers = buildRigLayers(await rabbitPixels(page));
  for (const part of RABBIT_PARTS) {
    const layer = layers.find(candidate => candidate.id === part.id)!;
    const strokes = Array.from({ length: 18 * 29 }, (_, index) => index).filter(index =>
      layer.pixels[index * 4] === 0 && layer.pixels[index * 4 + 1] === 0
      && layer.pixels[index * 4 + 2] === 0 && layer.pixels[index * 4 + 3] === 255,
    );
    expect(strokes.length, `${part.id} has its own outline`).toBeGreaterThan(0);
    for (const shape of [-1, -0.5, 0, 0.5, 1]) {
      for (const angle of [-part.limit, 0, part.limit]) {
        const state = createCharacterRig();
        state.explode = 1;
        state.joints = false;
        state.selected = part.id === 'head' || part.parent === 'head' ? 'right-foot' : 'head';
        state.parts[part.id].squashStretch = shape;
        state.parts[part.id].angle = angle;
        await page.evaluate(state => window.__longTable!.view.setCharacterRig(state), state);
        await page.getByRole('button', { name: 'Fit view', exact: true }).click();
        const transforms = transformRig(state);
        const points = strokes.map(index => rigPoint(state, transforms, part.id, {
          x: index % 18 + 0.5, y: Math.floor(index / 18) + 0.5,
        })).filter(point => {
          const top = [...layers].reverse().find(candidate => {
            const index = rigPixelAt(state, transforms[candidate.id], candidate, point);
            return index >= 0 && candidate.pixels[index + 3] > 0;
          });
          return top?.id === part.id;
        });
        expect(points.length, `${part.id} entire outline is visible at ${shape}, ${angle}`).toBe(strokes.length);
        const screen = await page.evaluate(points => {
          const { view, simulation } = window.__longTable!;
          return points.map(point => view.worldToScreen({
            x: simulation.character.position.x + (point.x - 9) * 12 / 29,
            y: simulation.character.position.y + (point.y - 29) * 12 / 29,
          }));
        }, points);
        const png = await page.locator('canvas').screenshot();
        const colors = await page.evaluate(async ({ base64, points }) => {
          const image = new Image();
          image.src = `data:image/png;base64,${base64}`;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.width; canvas.height = image.height;
          const context = canvas.getContext('2d')!;
          context.drawImage(image, 0, 0);
          const scale = image.width / document.querySelector('canvas')!.getBoundingClientRect().width;
          return points.map(point => Array.from(context.getImageData(
            Math.floor(point.x * scale), Math.floor(point.y * scale), 1, 1,
          ).data));
        }, { base64: png.toString('base64'), points: screen });
        expect(colors, `${part.id} outline at shape ${shape}, angle ${angle}`).toEqual(points.map(() => [0, 0, 0, 255]));
      }
    }
  }
});

test('pose edits keep the camera steady and Fit includes combined extreme and exploded parts', async ({ page }) => {
  await openCreation(page);
  const layers = buildRigLayers(await rabbitPixels(page));
  const zoom = await page.evaluate(() => window.__longTable!.view.getCameraState().zoom);
  const select = page.getByRole('combobox', { name: 'Character part' });
  for (const id of ['body', 'head', 'left-ear', 'right-ear']) {
    await select.selectOption(id);
    await slider(page, 'Squash / stretch', 100);
    await slider(page, 'Angle', 6);
  }
  await slider(page, 'Explode', 100);
  expect(await page.evaluate(() => window.__longTable!.view.getCameraState().zoom)).toBe(zoom);
  const state = await page.evaluate(() => window.__longTable!.view.getCharacterRig()!);
  const bounds = rigBounds(state, layers);
  await page.getByRole('button', { name: 'Fit view', exact: true }).click();
  const frame = await sourceClip(page, bounds);
  const canvas = await page.locator('canvas').boundingBox();
  expect(frame.x).toBeGreaterThanOrEqual(canvas!.x);
  expect(frame.y).toBeGreaterThanOrEqual(canvas!.y);
  expect(frame.x + frame.width).toBeLessThanOrEqual(canvas!.x + canvas!.width);
  expect(frame.y + frame.height).toBeLessThanOrEqual(canvas!.y + canvas!.height);
  const fittedZoom = await page.evaluate(() => window.__longTable!.view.getCameraState().zoom);
  expect(fittedZoom).toBeLessThan(zoom);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  expect(await page.evaluate(() => window.__longTable!.view.getCameraState().zoom)).toBeGreaterThan(fittedZoom);
  await expect(page.getByRole('alert')).toBeHidden();
});

test('part controls edit only their selected part and whole-rig controls are separate', async ({ page }) => {
  await openCreation(page);
  const selected = page.getByRole('group', { name: 'Selected part', exact: true });
  const whole = page.getByRole('group', { name: 'Whole rig', exact: true });
  for (const name of ['Squash / stretch', 'Angle', 'Position X', 'Position Y']) {
    await expect(selected.getByRole('slider', { name, exact: true })).toBeVisible();
    await expect(whole.getByRole('slider', { name, exact: true })).toHaveCount(0);
  }
  for (const name of ['Explode', 'Range test']) {
    await expect(whole.getByRole('slider', { name, exact: true })).toBeVisible();
    await expect(selected.getByRole('slider', { name, exact: true })).toHaveCount(0);
  }
  const select = page.getByRole('combobox', { name: 'Character part' });
  for (const [index, part] of RABBIT_PARTS.entries()) {
    await select.selectOption(part.id);
    const before = await page.evaluate(() => window.__longTable!.view.getCharacterRig()!);
    await slider(page, 'Squash / stretch', -20 - index * 10);
    await slider(page, 'Angle', 4);
    await slider(page, 'Position X', 0.5);
    await slider(page, 'Position Y', -0.5);
    const after = await page.evaluate(() => window.__longTable!.view.getCharacterRig()!);
    expect(after.parts[part.id]).toEqual({
      ...before.parts[part.id], angle: 4, offset: { x: 0.5, y: -0.5 }, squashStretch: (-20 - index * 10) / 100,
    });
    for (const other of RABBIT_PARTS.filter(candidate => candidate.id !== part.id)) {
      expect(after.parts[other.id]).toEqual(before.parts[other.id]);
    }
  }
  for (const [index, part] of RABBIT_PARTS.entries()) {
    await select.selectOption(part.id);
    await expect(page.getByRole('slider', { name: 'Squash / stretch', exact: true })).toHaveValue(String(-20 - index * 10));
    await expect(page.getByRole('slider', { name: 'Angle', exact: true })).toHaveValue('4');
    await expect(page.getByRole('slider', { name: 'Position X', exact: true })).toHaveValue('0.5');
    await expect(page.getByRole('slider', { name: 'Position Y', exact: true })).toHaveValue('-0.5');
  }
  const beforePreview = await page.evaluate(() => window.__longTable!.view.getCharacterRig()!.parts);
  await slider(page, 'Range test', 60);
  await select.selectOption('head');
  await slider(page, 'Angle', 2);
  const afterPreview = await page.evaluate(() => window.__longTable!.view.getCharacterRig()!);
  expect(afterPreview.stress).toBe(0);
  for (const part of RABBIT_PARTS.filter(part => part.id !== 'head')) {
    expect(afterPreview.parts[part.id]).toEqual(beforePreview[part.id]);
  }
  await expect(page.getByRole('alert')).toBeHidden();
});

test('rendered feet stay pixel-identical while the exploded torso changes shape', async ({ page }) => {
  await openCreation(page);
  await slider(page, 'Explode', 100);
  await page.getByRole('combobox', { name: 'Character part' }).selectOption('body');
  await page.getByRole('button', { name: 'Joints', exact: true }).click();
  const clips: Rectangle[] = [];
  for (const x of [-7, 16]) clips.push(await sourceClip(page, { x, y: 32, width: 10, height: 9 }));
  const feet: Buffer[] = [];
  for (const clip of clips) {
    const png = await page.screenshot({ clip });
    await blackBounds(page, png);
    feet.push(png);
  }
  for (const shape of [-100, -50, 50, 100]) {
    await slider(page, 'Squash / stretch', shape);
    for (const [index, clip] of clips.entries()) expect(await page.screenshot({ clip })).toEqual(feet[index]);
  }
});

test('the authored joint centers remain covered through individual and combined trial poses', async ({ page }) => {
  await openCreation(page);
  const gaps = await page.evaluate((parts) => {
    const view = window.__longTable!.view;
    const setup = view.getCharacterRig()!;
    const failures: string[] = [];
    for (const part of parts) {
      for (let angle = -part.limit; angle <= part.limit; angle++) {
        const state = structuredClone(setup);
        state.parts[part.id].angle = angle;
        view.setCharacterRig(state);
        const audit = view.getCharacterRigAudit()!;
        if (audit.uncoveredJoints.length) failures.push(`${part.id} ${angle}: ${audit.uncoveredJoints.join(',')}`);
      }
    }
    for (let mask = 0; mask < 256; mask++) {
      const state = structuredClone(setup);
      parts.forEach((part, index) => { state.parts[part.id].angle = part.limit * (mask & (1 << index) ? 1 : -1); });
      view.setCharacterRig(state);
      const audit = view.getCharacterRigAudit()!;
      if (audit.uncoveredJoints.length) failures.push(`corner ${mask}: ${audit.uncoveredJoints.join(',')}`);
    }
    for (let stress = -100; stress <= 100; stress++) {
      const state = { ...structuredClone(setup), stress: stress / 100 };
      view.setCharacterRig(state);
      const audit = view.getCharacterRigAudit()!;
      if (audit.uncoveredJoints.length) failures.push(`range ${stress}: ${audit.uncoveredJoints.join(',')}`);
    }
    for (let shape = -100; shape <= 100; shape++) {
      const state = structuredClone(setup);
      state.parts.body.squashStretch = shape / 100;
      view.setCharacterRig(state);
      const audit = view.getCharacterRigAudit()!;
      if (audit.uncoveredJoints.length) failures.push(`shape ${shape}: ${audit.uncoveredJoints.join(',')}`);
    }
    view.setCharacterRig(setup);
    return failures;
  }, RABBIT_PARTS.map(({ id, limit }) => ({ id, limit })));
  expect(gaps).toEqual([]);
});

test('creation and shared motion retain independent settings without mutating gameplay', async ({ page }) => {
  await openCreation(page);
  await slider(page, 'Position Y', -1);
  await slider(page, 'Squash / stretch', -75);
  await slider(page, 'Explode', 75);
  await slider(page, 'Angle', 4);
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  const creationZoom = await page.evaluate(() => window.__longTable!.view.getCameraState().zoom);
  await page.getByRole('button', { name: 'Motion', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Hop', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__longTable!.simulation.character.animationTime)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__longTable!.view.getCharacterRig())).toBeNull();
  await expect(page.getByRole('slider', { name: 'Squash / stretch', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Shallows', exact: true }).click();
  await page.getByRole('button', { name: 'Creation', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Explode', exact: true })).toHaveValue('75');
  await expect(page.getByRole('slider', { name: 'Angle', exact: true })).toHaveValue('4');
  await expect(page.getByRole('group', { name: 'Part positioning', exact: true })).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Position Y', exact: true })).toHaveValue('-1');
  await expect(page.getByRole('slider', { name: 'Squash / stretch', exact: true })).toHaveValue('-75');
  expect(await page.evaluate(() => window.__longTable!.view.getCameraState().zoom)).toBe(creationZoom);
  await page.getByRole('button', { name: 'Motion', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Shallows', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/#/play');
  await page.waitForFunction(() => window.__longTable?.ready);
  expect(await page.evaluate(() => window.__longTable!.view.getCharacterRig())).toBeNull();
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(page.getByRole('alert')).toBeHidden();
});

test('creation remains keyboard reachable and contained at narrow widths', async ({ page }) => {
  await openCreation(page);
  for (const viewport of [{ width: 1280, height: 850 }, { width: 320, height: 780 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.getByText('Pivot', { exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('slider', { name: 'Explode', exact: true })).toBeFocused();
    await slider(page, 'Explode', 100);
    await expect(page.getByRole('slider', { name: 'Explode', exact: true })).toBeInViewport();
    const geometry = await page.evaluate(() => {
      const stage = document.querySelector('.stage')!.getBoundingClientRect();
      const canvas = document.querySelector('canvas')!.getBoundingClientRect();
      return { widthError: Math.abs(canvas.width - stage.width), stageHeight: stage.height };
    });
    expect(geometry.widthError).toBeLessThanOrEqual(1);
    expect(geometry.stageHeight).toBeGreaterThanOrEqual(260);
  }
  await page.getByRole('button', { name: 'Creation', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Motion', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('combobox', { name: 'Character part' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('slider', { name: 'Squash / stretch', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('slider', { name: 'Squash / stretch', exact: true })).toHaveValue('-1');
});

test('position controls are keyboard usable and contained on desktop and narrow screens', async ({ page }) => {
  await openCreation(page);
  for (const viewport of [{ width: 1280, height: 850 }, { width: 320, height: 780 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    const x = page.getByRole('slider', { name: 'Position X', exact: true });
    await x.focus();
    await page.keyboard.press('Home');
    await expect(x).toHaveValue('-3');
    await page.keyboard.press('ArrowRight');
    await expect(x).toHaveValue('-2.5');
    await page.keyboard.press('Tab');
    const y = page.getByRole('slider', { name: 'Position Y', exact: true });
    await expect(y).toBeFocused();
    await expect(y).toBeInViewport();
    await page.keyboard.press('End');
    await expect(y).toHaveValue('3');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Reset position', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(x).toHaveValue('0');
    await expect(y).toHaveValue('0');
    await expect(page.locator('.runtime-header .toolbar')).toHaveCount(1);
    await expect(page.getByRole('complementary')).toHaveCount(1);
  }
  await expect(page.getByRole('alert')).toBeHidden();
});

test('squash and stretch is keyboard usable on desktop and narrow screens', async ({ page }) => {
  await openCreation(page);
  const shape = page.getByRole('slider', { name: 'Squash / stretch', exact: true });
  for (const viewport of [{ width: 1280, height: 850 }, { width: 320, height: 780 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.getByRole('combobox', { name: 'Character part' }).focus();
    await page.keyboard.press('Tab');
    await expect(shape).toBeFocused();
    await expect(shape).toBeInViewport();
    await page.keyboard.press('Home');
    await expect(shape).toHaveValue('-100');
    await expect(shape).toHaveAttribute('aria-valuetext', 'Squash 100%');
    await page.keyboard.press('ArrowRight');
    await expect(shape).toHaveValue('-99');
    await page.keyboard.press('End');
    await expect(shape).toHaveValue('100');
    await expect(shape).toHaveAttribute('aria-valuetext', 'Stretch 100%');
    await shape.fill('0');
    await expect(shape).toHaveAttribute('aria-valuetext', 'Neutral');
  }
  await expect(page.getByRole('alert')).toBeHidden();
});

test('rig picking and source-pixel zoom also work at fractional display density', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1000, height: 760 }, deviceScaleFactor: 1.25,
    baseURL: process.env.APP_URL ?? 'http://127.0.0.1:5185',
  });
  try {
    const page = await context.newPage();
    await openCreation(page);
    await slider(page, 'Explode', 100);
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    const measurements = await page.evaluate(() => {
      const { view, simulation } = window.__longTable!;
      const foot = simulation.character.position;
      const point = { x: foot.x, y: foot.y + (1 - 29) * 12 / 29 };
      const screen = view.worldToScreen(point);
      const roundTrip = view.screenToWorld(screen);
      const canvas = document.querySelector('canvas')!;
      return {
        roundTrip: Math.hypot(point.x - roundTrip.x, point.y - roundTrip.y),
        sourceMagnification: view.getCameraState().zoom * devicePixelRatio * 12 / 29,
        backingError: Math.abs(canvas.width - canvas.getBoundingClientRect().width * devicePixelRatio),
        picked: view.pickCharacterRigPart(point),
      };
    });
    expect(measurements.roundTrip).toBeLessThan(0.001);
    expect(measurements.sourceMagnification).toBeCloseTo(Math.round(measurements.sourceMagnification));
    expect(measurements.backingError).toBeLessThanOrEqual(1);
    expect(measurements.picked).toBe('head');
  } finally {
    await context.close();
  }
});

test('actual source cutouts remain connected in fully framed sampled poses on a 4x inspection grid', async ({ page }) => {
  await openCreation(page);
  const layers = buildRigLayers(await rabbitPixels(page));
  const poses = [createCharacterRig()];
  for (const id of ['body', 'head'] as const) {
    for (let shape = -100; shape <= 100; shape += 10) {
      const pose = createCharacterRig();
      pose.parts[id].squashStretch = shape / 100;
      poses.push(pose);
    }
  }
  for (const part of RABBIT_PARTS) {
    for (const sign of [-1, 1]) {
      const pose = createCharacterRig();
      pose.parts[part.id].angle = part.limit * sign;
      poses.push(pose);
    }
  }
  for (let stress = -100; stress <= 100; stress += 10) poses.push({ ...createCharacterRig(), stress: stress / 100 });
  for (let mask = 0; mask < 256; mask += 17) {
    const pose = createCharacterRig();
    RABBIT_PARTS.forEach((part, index) => { pose.parts[part.id].angle = part.limit * (mask & (1 << index) ? 1 : -1); });
    poses.push(pose);
  }
  const failures: { pose: number; components: number }[] = [];
  for (const [poseIndex, pose] of poses.entries()) {
    const transforms = transformRig(pose);
    const bounds = rigBounds(pose, layers);
    const width = Math.ceil(bounds.width * 4) + 4, height = Math.ceil(bounds.height * 4) + 4;
    const occupied = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const point = { x: bounds.x - 0.5 + (x + 0.5) / 4, y: bounds.y - 0.5 + (y + 0.5) / 4 };
        occupied[y * width + x] = layers.some(layer => {
          const index = rigPixelAt(pose, transforms[layer.id], layer, point);
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
            const neighbor = (y + dy) * width + x + dx;
            if (occupied[neighbor]) { occupied[neighbor] = 0; queue.push(neighbor); }
          }
        }
      }
    }
    if (components !== 1) failures.push({ pose: poseIndex, components });
  }
  expect(failures).toEqual([]);
});
