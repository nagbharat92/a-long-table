import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('all foliage assets retain their editor and real PNG export', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const tab of [
    'bush', 'grass', 'ferns', 'moss', 'reeds', 'trees', 'leaves', 'seeds',
    'rocks', 'pebbles', 'wood', 'roots', 'mushrooms', 'vegetables', 'fruit', 'shells',
  ]) {
    await page.goto(`/#/foliage?tab=${tab}`);
    await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
    const state = await page.evaluate(() => window.__pilot!.snapshot() as {
      family: string; tab: string; dimensions?: { width: number; height: number };
    });
    expect(state).toMatchObject({ family: 'foliage', tab });
    await expect(page.locator('.p-primary-controls button').first()).toBeVisible();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download PNG', exact: true }).click();
    const path = await (await pending).path();
    if (!path) throw new Error(`The ${tab} PNG was not saved.`);
    const png = await readFile(path);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    if (state.dimensions) {
      expect(png.readUInt32BE(16)).toBe(state.dimensions.width);
      expect(png.readUInt32BE(20)).toBe(state.dimensions.height);
    }
  }
  expect(errors).toEqual([]);
});

test('species, Cat tail rig edits and combined export survive workspace changes', async ({ page }) => {
  await page.goto('/#/character?colorSeed=42&paused=1');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  const species = page.getByRole('group', { name: 'Character species', exact: true });
  for (const [label, value] of [['Bear', 'bear'], ['Bunny', 'rabbit'], ['Cat', 'cat']]) {
    await species.getByRole('button', { name: label, exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window.__pilot!.snapshot() as { species: string }).species)).toBe(value);
  }
  await page.getByRole('combobox', { name: 'Character part', exact: true }).selectOption('tail');
  const angle = page.getByRole('slider', { name: 'Angle', exact: true });
  await angle.fill('15');
  const edited = await page.evaluate(() => window.__pilot!.snapshot() as {
    rig: { parts: { tail: { angle: number } } }; appearance: { parameters: unknown };
  });
  expect(edited.rig.parts.tail.angle).toBe(15);
  const workspace = page.getByRole('group', { name: 'Character workspace', exact: true });
  await workspace.getByRole('button', { name: 'Motion', exact: true }).click();
  await page.getByRole('group', { name: 'Character motion', exact: true }).getByRole('button', { name: 'Shallows', exact: true }).click();
  await workspace.getByRole('button', { name: 'Customization', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download recipe', exact: true }).click();
  const path = await (await pending).path();
  if (!path) throw new Error('The combined character recipe was not saved.');
  const recipe = JSON.parse(await readFile(path, 'utf8'));
  expect(recipe.parameters).toEqual(edited.appearance.parameters);
  expect(recipe.rig.setup.parts.tail.angle).toBe(15);
  await workspace.getByRole('button', { name: 'Creation', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Angle', exact: true })).toHaveValue('15');
});

test('Navigation paints real fixture terrain and supports pointer-driven movement', async ({ page }) => {
  await page.goto('/#/navigation');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  interface State {
    world: { width: number; height: number; tileSize: number; cells: Record<number, number> };
    character: { position: { x: number; y: number } };
  }
  const initial = await page.evaluate(() => window.__pilot!.snapshot() as State);
  const index = Object.entries(initial.world.cells).find(([, value]) => value !== 0)?.[0];
  if (index === undefined) throw new Error('The navigation fixture has no editable land.');
  const cell = Number(index);
  const point = {
    x: (cell % initial.world.width + 0.5) * initial.world.tileSize,
    y: (Math.floor(cell / initial.world.width) + 0.5) * initial.world.tileSize,
  };
  const screen = await page.evaluate(point => window.__pilot!.worldToScreen!(point), point);
  const tool = page.getByRole('combobox', { name: 'Terrain tool', exact: true });
  await tool.selectOption('block');
  await page.mouse.click(screen.x, screen.y);
  await expect.poll(() => page.evaluate(index => (window.__pilot!.snapshot() as State).world.cells[index], cell)).toBe(0);
  await tool.selectOption('sand');
  await page.mouse.click(screen.x, screen.y);
  await expect.poll(() => page.evaluate(index => (window.__pilot!.snapshot() as State).world.cells[index], cell)).not.toBe(0);
  await tool.selectOption('move');
  const current = await page.evaluate(() => window.__pilot!.snapshot() as State);
  // Keep the ground click outside the rabbit's selection bounds.
  const target = { x: 34, y: 26 };
  const click = await page.evaluate(point => window.__pilot!.worldToScreen!(point), target);
  await page.mouse.click(click.x, click.y);
  await expect.poll(() => page.evaluate(() => (window.__pilot!.snapshot() as State).character.position)).not.toEqual(current.character.position);
});
