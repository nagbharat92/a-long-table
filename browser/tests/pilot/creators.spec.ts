import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import type { CharacterAppearance } from '../../src/core/character-appearance';
import type { TreeAppearance } from '../../src/tree-source/core/tree-assets';

interface CharacterState {
  seed: number;
  appearance: CharacterAppearance;
}
interface TreeState {
  appearance: TreeAppearance;
  wind: { mode: number; preset: number; strength: number; speed: number; direction: number };
  seconds: number;
  paused: boolean;
}
async function character(page: Page): Promise<CharacterState> {
  return page.evaluate(() => window.__pilot!.snapshot() as CharacterState);
}
async function trees(page: Page): Promise<TreeState> {
  return page.evaluate(() => window.__pilot!.snapshot() as TreeState);
}
async function open(page: Page, route: string): Promise<void> {
  await page.goto(`/#/${route}`);
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
}
async function jsonDownload(page: Page, name: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name, exact: true }).click();
  const file = await (await pending).path();
  if (!file) throw new Error('The recipe download was not saved.');
  return JSON.parse(await readFile(file, 'utf8'));
}

test('character edits stay independent across workspaces and download the real combined recipe', async ({ page }) => {
  await open(page, 'character?colorSeed=42&tab=customization&paused=1');
  await page.getByRole('button', { name: 'Happy', exact: true }).click();
  await page.getByRole('button', { name: 'One floppy', exact: true }).click();
  await page.getByLabel('Ear color', { exact: true }).fill('#123456');
  await page.getByRole('button', { name: 'Bandana', exact: true }).click();
  await page.getByRole('button', { name: 'Sky', exact: true }).click();
  const current = await character(page);
  expect(current.appearance.parameters.expression?.type).toBe('happy');
  expect(current.appearance.parameters.ears?.shape).toBe('one-floppy');
  expect(current.appearance.parameters.ears?.color).toBe('#123456');
  expect(current.appearance.parameters.accessory?.type).toBe('bandana');
  expect(current.appearance.parameters.pattern.type).toBe('solid');
  for (const name of ['Creation', 'Motion', 'Customization']) {
    await page.getByRole('group', { name: 'Character workspace', exact: true }).getByRole('button', { name, exact: true }).click();
    expect((await character(page)).appearance).toEqual(current.appearance);
  }
  const recipe = await jsonDownload(page, 'Download recipe');
  expect(recipe.version).toBe(current.appearance.version);
  expect(recipe.parameters).toEqual(current.appearance.parameters);
  expect(recipe).toHaveProperty('rig.setup.parts.head');
  expect((await character(page)).appearance).toEqual(current.appearance);
});

test('character seed validation preserves edits and seed application reproduces generation', async ({ page }) => {
  await open(page, 'character?colorSeed=42&tab=customization&paused=1');
  const before = await character(page);
  await page.getByLabel('Character seed', { exact: true }).fill('-1');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect((await character(page)).appearance).toEqual(before.appearance);
  await page.getByLabel('Character seed', { exact: true }).fill('52');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(async () => (await character(page)).seed).toBe(52);
  const changed = await character(page);
  await page.reload();
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  expect((await character(page)).appearance).toEqual(changed.appearance);
});

test('tree appearance, motion, stepping and exports use the existing real model', async ({ page }) => {
  await open(page, 'trees?treeSeed=9');
  await page.getByRole('button', { name: 'Pause wind', exact: true }).click();
  const before = await trees(page);
  await page.getByRole('button', { name: 'Sparse', exact: true }).click();
  const edited = await trees(page);
  expect(edited.appearance.growth).not.toBe(before.appearance.growth);
  expect((await trees(page)).appearance).toEqual(edited.appearance);
  await page.getByRole('button', { name: 'Whole tree', exact: true }).click();
  await page.getByRole('button', { name: 'Gusts', exact: true }).click();
  const strength = page.getByRole('slider', { name: 'Wind strength', exact: true });
  await strength.focus();
  await page.keyboard.press('End');
  const moved = await trees(page);
  expect(moved.wind.mode).toBe(1);
  expect(moved.wind.preset).toBe(2);
  expect(moved.wind.strength).toBeGreaterThan(before.wind.strength);
  await page.getByRole('button', { name: 'Step 0.25 s', exact: true }).click();
  const stepped = await trees(page);
  expect(stepped.seconds).toBeCloseTo(moved.seconds + 0.25, 6);
  await page.getByRole('button', { name: 'Sparse', exact: true }).click();
  expect(await trees(page)).toEqual(stepped);
  const recipe = await jsonDownload(page, 'Download recipe');
  expect(recipe).toEqual(stepped.appearance);
  const motion = await jsonDownload(page, 'Download motion');
  expect(motion).toMatchObject({ version: 1, appearance: stepped.appearance, wind: stepped.wind, paused: true });
  expect(motion.seconds).toBeCloseTo(stepped.seconds, 6);
  const pngPending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PNG', exact: true }).click();
  const path = await (await pngPending).path();
  if (!path) throw new Error('The PNG download was not saved.');
  const png = await readFile(path);
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect(png.readUInt32BE(16)).toBe(80);
  expect(png.readUInt32BE(20)).toBe(176);
  expect(await trees(page)).toEqual(stepped);
});

test('tree secondary tools do not block playback or change the user pause setting', async ({ page }) => {
  await open(page, 'trees?treeSeed=9');
  await page.getByText('Preview settings', { exact: true }).click();
  const before = await trees(page);
  await page.getByRole('button', { name: 'Line / outlined' }).click();
  await expect(page.locator('.pilot')).toHaveAttribute('data-skin', 'line');
  await expect.poll(async () => (await trees(page)).seconds).toBeGreaterThan(before.seconds);
  expect((await trees(page)).paused).toBe(false);
  await page.getByRole('button', { name: 'Pause wind', exact: true }).click();
  const paused = await trees(page);
  await page.getByText('Preview settings', { exact: true }).click();
  await page.waitForTimeout(250);
  expect(await trees(page)).toEqual(paused);
});

for (const viewport of [{ width: 1440, height: 960 }, { width: 1280, height: 800 }]) {
  for (const route of ['character?colorSeed=42&tab=customization&paused=1', 'trees?treeSeed=9']) {
    test(`${route} has one non-overlapping panel and pinned generation at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await open(page, route);
      const panel = page.getByRole('complementary', { name: 'Study controls' });
      const first = await panel.boundingBox();
      expect(first).not.toBeNull();
      const stage = await page.locator('.p-stage').boundingBox();
      expect(stage!.x + stage!.width).toBeLessThanOrEqual(first!.x);
      expect(first!.y).toBe(0);
      expect(first!.height).toBe(viewport.height);
      expect(first!.x + first!.width).toBe(viewport.width);
      const generate = page.getByRole('button', { name: route.startsWith('character') ? 'Generate character' : 'Generate tree', exact: true });
      const generateBounds = await generate.boundingBox();
      const subject = await page.locator('.p-stage').boundingBox();
      const categories = route.startsWith('character') ? ['Creation', 'Motion', 'Customization'] : ['Sparse', 'Drooping'];
      for (const name of categories) {
        const group = route.startsWith('character') ? page.getByRole('group', { name: 'Character workspace', exact: true }) : page;
        await group.getByRole('button', { name, exact: true }).click();
        const bounds = await panel.boundingBox();
        expect(bounds).toEqual(first);
        expect(await page.locator('.p-stage').boundingBox()).toEqual(subject);
        const outside = await page.locator('.p-stage canvas').evaluateAll((canvases, scene) =>
          canvases.some(canvas => {
            const rect = canvas.getBoundingClientRect();
            return rect.x < scene!.x || rect.right > scene!.x + scene!.width || rect.y < scene!.y || rect.bottom > scene!.y + scene!.height;
          }), stage);
        expect(outside).toBe(false);
      }
      await page.getByText('Preview settings', { exact: true }).click();
      await page.getByRole('button', { name: 'Line / outlined' }).click();
      const scroll = page.getByRole('region', { name: 'Editing and tools' });
      expect(await scroll.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
      expect(await generate.boundingBox()).toEqual(generateBounds);
      expect(await generate.evaluate(node => {
        const rect = node.getBoundingClientRect();
        return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === node;
      })).toBe(true);
      const seedBefore = route.startsWith('character') ? (await character(page)).seed : (await trees(page)).appearance.seed;
      await generate.click();
      const seedAfter = route.startsWith('character') ? (await character(page)).seed : (await trees(page)).appearance.seed;
      expect(seedAfter).not.toBe(seedBefore);
      expect(await panel.locator('button,input,a,summary').evaluateAll(nodes => nodes.some(node => {
        const rect = node.getBoundingClientRect();
        const parent = node.closest('.p-panel')!.getBoundingClientRect();
        return rect.width > 0 && (rect.left < parent.left || rect.right > parent.right);
      }))).toBe(false);
      expect(errors).toEqual([]);
    });
  }
}

test('Home navigation disposes the previous scene and exposes only one active experience', async ({ page }) => {
  await open(page, 'play?seed=42');
  for (const [id, label] of [
    ['character', 'Character Explorer'], ['foliage', 'Foliage Explorer'],
    ['play', 'Play'], ['foliage', 'Foliage Explorer'], ['character', 'Character Explorer'],
  ]) {
    await page.getByRole('navigation', { name: 'Project', exact: true }).getByRole('link', { name: 'Home', exact: true }).click();
    await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
    const directory = id === 'play' ? page : page.getByRole('navigation', { name: 'Explorers', exact: true });
    await directory.getByRole('link', { name: id === 'play' ? label : new RegExp(label), exact: id === 'play' }).click();
    await expect(page.locator('.pilot')).toHaveAttribute('data-route', id);
    await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('main.pilot')).toHaveCount(1);
    await expect(page.locator('dialog')).toHaveCount(0);
    await expect(page.getByRole('complementary', { name: 'Study controls' })).toHaveCount(1);
    expect(await page.evaluate(() => window.__pilot?.route)).toBe(id);
  }
});
