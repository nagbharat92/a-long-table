import { expect, test, type Page } from '@playwright/test';
import { CHARACTER_EAR_MARKINGS, generateAppearance, linkedAccessoryColor, linkedEarColor } from '../../src/core/character-appearance';
import { CHARACTER_ACCESSORIES } from '../../src/core/character-accessory';
import { CHARACTER_EXPRESSIONS } from '../../src/core/character-expression';
import { CHARACTER_EAR_SHAPES } from '../../src/core/character-ear-shape';

async function openCustomization(page: Page, seed = '42'): Promise<void> {
  await page.goto(`/#/character?tab=customization&colorSeed=${seed}`);
  await expect(page.getByRole('button', { name: 'Customization', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('alert')).toBeHidden();
  await expect(page.getByRole('group', { name: 'Color palettes' }).getByRole('button')).toHaveCount(8);
  await expect(page.getByRole('region', { name: 'Character preview', exact: true }).locator('canvas')).toHaveCount(1);
}

async function artwork(page: Page): Promise<string> {
  return page.locator('.customization-character').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL());
}

test('accessory designs preserve the face and contour, and None restores the uncovered character', async ({ page }) => {
  await openCustomization(page);
  const choices = page.getByRole('group', { name: 'Accessories', exact: true });
  await expect(choices.getByRole('button')).toHaveCount(3);
  await choices.getByRole('button', { name: 'None', exact: true }).click();
  await expect(page.getByLabel('Accessory color', { exact: true })).toBeDisabled();
  const first = await artwork(page);
  const baseline = await page.locator('.customization-character').evaluate(canvas =>
    Array.from((canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 18, 29).data));
  const footer = await page.getByRole('button', { name: 'Generate character', exact: true }).boundingBox();
  const images = new Set<string>();
  for (const { type, name, description } of CHARACTER_ACCESSORIES) {
    const choice = choices.getByRole('button', { name, exact: true });
    await choice.click();
    await expect(choice).toHaveAttribute('aria-pressed', 'true');
    await expect(choices.locator('[aria-pressed="true"]')).toHaveCount(1);
    await expect(page.getByLabel('Accessory details', { exact: true })).toHaveText(description);
    await expect(page.getByLabel('Accessory color', { exact: true }))[type === 'none' ? 'toBeDisabled' : 'toBeEnabled']();
    const preserved = await page.locator('.customization-character').evaluate((canvas, original) => {
      const pixels = (canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 18, 29).data;
      for (let i = 0; i < pixels.length; i += 4) {
        const y = Math.floor(i / 4 / 18);
        if (pixels[i + 3] !== original[i + 3]) return false;
        if (y < 19 || y > 25 || original[i + 3] === 0 || (original[i] === 0 && original[i + 1] === 0 && original[i + 2] === 0)) {
          if (pixels.slice(i, i + 4).some((value, channel) => value !== original[i + channel])) return false;
        }
      }
      return true;
    }, baseline);
    expect(preserved).toBe(true);
    images.add(await artwork(page));
    expect(await page.getByRole('button', { name: 'Generate character', exact: true }).boundingBox()).toEqual(footer);
  }
  expect(images.size).toBe(3);
  await choices.getByRole('button', { name: 'None', exact: true }).click();
  expect(await artwork(page)).toBe(first);
  await expect(page.getByRole('alert')).toBeHidden();
});

test('accessory colors, independent edits, downloads and seeded replay remain consistent', async ({ page }) => {
  await openCustomization(page);
  const choices = page.getByRole('group', { name: 'Accessories', exact: true });
  await choices.getByRole('button', { name: 'Bandana', exact: true }).click();
  await page.getByRole('button', { name: 'Mint', exact: true }).click();
  await expect(page.getByLabel('Accessory color', { exact: true })).toHaveValue(linkedAccessoryColor({ coat: '#d4ebdf', shade: '#aed0be' }));
  await page.getByLabel('Accessory color', { exact: true }).fill('#a54c6b');
  await page.getByRole('button', { name: 'Randomize color', exact: true }).click();
  await page.getByRole('button', { name: 'Curious', exact: true }).click();
  await page.getByRole('button', { name: 'Inner ears', exact: true }).click();
  await page.getByRole('button', { name: 'Motion', exact: true }).click();
  await page.getByRole('button', { name: 'Customization', exact: true }).click();
  await expect(choices.getByRole('button', { name: 'Bandana', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Accessory color', { exact: true })).toHaveValue('#a54c6b');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download recipe' }).click();
  const stream = await (await downloadPromise).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(JSON.parse(Buffer.concat(chunks).toString())).toMatchObject({
    version: 8, parameters: { accessory: { type: 'bandana', color: '#a54c6b', colorMode: 'custom' } },
  });
  await page.getByRole('button', { name: 'Match accessory to coat', exact: true }).click();
  const coat = await page.getByLabel('Coat', { exact: true }).inputValue();
  const shade = await page.getByLabel('Shading', { exact: true }).inputValue();
  await expect(page.getByLabel('Accessory color', { exact: true })).toHaveValue(linkedAccessoryColor({ coat, shade }));
  await page.getByRole('button', { name: 'Generate character', exact: true }).click();
  const seed = await page.getByRole('textbox', { name: 'Character seed', exact: true }).inputValue();
  const expected = generateAppearance(Number(seed)).parameters.accessory;
  const generated = await artwork(page);
  await page.reload();
  const name = CHARACTER_ACCESSORIES.find(option => option.type === expected.type)!.name;
  await expect(choices.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Accessory color', { exact: true })).toHaveValue(expected.color);
  expect(await artwork(page)).toBe(generated);
});

test('face and body markings have no controls and accessory edits preserve ears and expression', async ({ page }) => {
  await openCustomization(page);
  const accessories = page.getByRole('group', { name: 'Accessories', exact: true });
  await expect(page.getByRole('group', { name: 'Coat patterns', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Cheeks', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Cheek color', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cheek circles', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Curious', exact: true }).click();
  await page.getByRole('button', { name: 'Inner ears', exact: true }).click();
  await page.getByLabel('Ear color', { exact: true }).fill('#aa6677');
  const coat = await page.getByLabel('Coat', { exact: true }).inputValue();
  await accessories.getByRole('button', { name: 'Bandana', exact: true }).click();
  await page.getByLabel('Accessory color', { exact: true }).fill('#a54c6b');
  for (const name of ['None', 'Collar', 'Bandana']) {
    await accessories.getByRole('button', { name, exact: true }).click();
    await expect(page.getByLabel('Accessory color', { exact: true })).toHaveValue('#a54c6b');
    await expect(page.getByLabel('Coat', { exact: true })).toHaveValue(coat);
    await expect(page.getByLabel('Ear color', { exact: true })).toHaveValue('#aa6677');
    await expect(page.getByRole('button', { name: 'Inner ears', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Curious', exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  await accessories.getByRole('button', { name: 'None', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download recipe' }).click();
  const stream = await (await downloadPromise).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(JSON.parse(Buffer.concat(chunks).toString())).toMatchObject({
    parameters: { pattern: { type: 'solid' }, accessory: { type: 'none', color: '#a54c6b' } },
  });
});

test('one large seeded rabbit preserves head and body ink and alpha and reproduces on reload', async ({ page }) => {
  await openCustomization(page);
  const first = await artwork(page);
  const bounds = await page.locator('.customization-character').boundingBox();
  expect(bounds!.height).toBeGreaterThanOrEqual(348);
  const previewBounds = await page.locator('.customization-preview').boundingBox();
  const panelBounds = await page.locator('.inspector').boundingBox();
  expect(previewBounds!.x + previewBounds!.width).toBeLessThanOrEqual(panelBounds!.x);
  const pixelsMatch = await page.evaluate(async () => {
    const source = new Image();
    source.src = '/assets/rabbit.png';
    await source.decode();
    const canvas = document.createElement('canvas');
    canvas.width = source.width; canvas.height = source.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(source, 0, 0);
    const original = context.getImageData(0, 0, source.width, source.height).data;
    const variation = document.querySelector<HTMLCanvasElement>('.customization-character')!;
    const changed = variation.getContext('2d')!.getImageData(0, 0, source.width, source.height).data;
    let recolored = 0;
    const eyePixels = new Set([13 * 18 + 2, 14 * 18 + 2, 13 * 18 + 11, 14 * 18 + 11]);
    for (let i = 6 * 18 * 4; i < original.length; i += 4) {
      if (original[i + 3] !== changed[i + 3]) return false;
      if (!eyePixels.has(i / 4) && original[i] === 0 && original[i + 1] === 0 && original[i + 2] === 0 &&
          (changed[i] !== 0 || changed[i + 1] !== 0 || changed[i + 2] !== 0)) return false;
      if (original[i + 3] && original[i] !== changed[i]) recolored++;
    }
    return recolored > 100;
  });
  expect(pixelsMatch).toBe(true);
  await page.reload();
  await expect(page.locator('.customization-preview')).toBeVisible();
  expect(await artwork(page)).toEqual(first);
  await page.getByRole('button', { name: 'Generate character', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Character seed', exact: true })).not.toHaveValue('42');
  expect(await artwork(page)).not.toEqual(first);
  await page.reload();
  await expect(page.locator('.customization-preview')).toBeVisible();
  const second = await artwork(page);
  await page.getByRole('textbox', { name: 'Character seed', exact: true }).fill('42');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  expect(await artwork(page)).toEqual(first);
  expect(second).not.toEqual(first);
});

test('swatches, manual edits, reset and download all update the same character', async ({ page }) => {
  await openCustomization(page);
  const initial = await artwork(page);
  const results = new Set<string>();
  const swatches = page.getByRole('group', { name: 'Color palettes' }).getByRole('button');
  for (const swatch of await swatches.all()) {
    await swatch.click();
    await expect(swatch).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.color-swatch[aria-pressed="true"]')).toHaveCount(1);
    results.add(await artwork(page));
  }
  expect(results.size).toBe(8);
  await page.getByRole('button', { name: 'Biscuit', exact: true }).click();
  await expect(page.getByLabel('Coat', { exact: true })).toHaveValue('#edd5b8');
  await expect(page.getByLabel('Shading', { exact: true })).toHaveValue('#ceb394');
  const biscuit = await artwork(page);
  await page.getByLabel('Coat', { exact: true }).fill('#e8b99a');
  expect(await artwork(page)).not.toBe(biscuit);
  await expect(page.getByLabel('Selected palette', { exact: true })).toHaveText('Custom');
  await expect(page.locator('.color-swatch[aria-pressed="true"]')).toHaveCount(0);
  await page.getByLabel('Shading', { exact: true }).fill('#b57c69');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download recipe' }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(JSON.parse(Buffer.concat(chunks).toString())).toMatchObject({
    version: 8, seed: 42, parameters: { color: { coat: '#e8b99a', shade: '#b57c69' } },
  });
  await page.getByRole('button', { name: 'Reset palette' }).click();
  expect(await artwork(page)).toEqual(initial);
  await expect(page.getByRole('button', { name: 'Reset palette' })).toBeDisabled();
});

test('bad input preserves the character and reports an error, then recovers', async ({ page }) => {
  await openCustomization(page);
  const before = await artwork(page);
  await page.getByRole('textbox', { name: 'Character seed', exact: true }).fill('4294967296');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Character seed must be');
  expect(await artwork(page)).toEqual(before);
  await page.getByRole('textbox', { name: 'Character seed', exact: true }).fill('0');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('alert')).toBeHidden();
  await expect(page.locator('.customization-preview')).toHaveAttribute('data-seed', '0');
});

test('Customization preserves Creation edits, Motion controls and its own edits when switching tabs', async ({ page }) => {
  await page.goto('/#/character');
  await page.getByRole('slider', { name: 'Position X', exact: true }).fill('2');
  await page.getByRole('button', { name: 'Customization', exact: true }).click();
  await expect(page.locator('.customization-preview')).toBeVisible();
  await page.getByRole('button', { name: 'Mint', exact: true }).click();
  const character = await artwork(page);
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Creation', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Position X', exact: true })).toHaveValue('2');
  await expect(page.locator('.customization-preview')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Motion', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Hop', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Customization', exact: true }).click();
  expect(await artwork(page)).toEqual(character);
  await expect(page.getByRole('button', { name: 'Mint', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('opening without a seed and using R produce fresh characters with reproducible URLs', async ({ page }) => {
  await page.goto('/#/character?tab=customization');
  await expect(page.locator('.customization-preview')).toBeVisible();
  const firstSeed = await page.locator('.customization-preview').getAttribute('data-seed');
  expect(page.url()).toContain(`colorSeed=${firstSeed}`);
  const first = await artwork(page);
  await page.locator('.customization-preview').click({ position: { x: 20, y: 20 } });
  await page.keyboard.press('r');
  await expect(page.locator('.customization-preview')).not.toHaveAttribute('data-seed', firstSeed!);
  expect(await artwork(page)).not.toEqual(first);
  const generatedSeed = await page.locator('.customization-preview').getAttribute('data-seed');
  expect(page.url()).toContain(`colorSeed=${generatedSeed}`);
  await page.goto('/#/character?tab=customization');
  await expect(page.locator('.customization-preview')).toBeVisible();
  await expect(page.locator('.customization-preview')).not.toHaveAttribute('data-seed', generatedSeed!);
});

test('an invalid URL seed reports the problem and leaves Creation usable', async ({ page }) => {
  await page.goto('/#/character?tab=customization&colorSeed=invalid');
  await expect(page.getByRole('alert')).toContainText('Character seed must be');
  await expect(page.getByRole('button', { name: 'Creation', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('slider', { name: 'Position X', exact: true })).toBeVisible();
  await page.getByRole('slider', { name: 'Position X', exact: true }).fill('1');
  await expect(page.getByRole('alert')).toBeHidden();
});

test('legacy Colors URLs open Customization with the current soft palette', async ({ page }) => {
  await page.goto('/#/character?tab=colors&colorSeed=42');
  await expect(page.getByRole('button', { name: 'Customization', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Coat', { exact: true })).toHaveValue(generateAppearance(42).parameters.color.coat);
  await expect(page).toHaveURL(/tab=customization&colorSeed=42/);
  await expect(page.getByRole('button', { name: 'Colors', exact: true })).toHaveCount(0);
});

test('only the parameters scroll while Generate character, tabs and preview stay fixed', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 650 });
  await openCustomization(page);
  const generate = page.getByRole('button', { name: 'Generate character', exact: true });
  const before = await generate.boundingBox();
  expect(before!.y + before!.height).toBeLessThanOrEqual(650);
  const preview = await page.locator('.customization-character').boundingBox();
  const tabs = await page.locator('.character-tabs').boundingBox();
  await page.locator('.customization-parameters').evaluate(element => { element.scrollTop = element.scrollHeight; });
  expect(await page.locator('.customization-parameters').evaluate(element => element.scrollTop)).toBeGreaterThan(100);
  expect(await generate.boundingBox()).toEqual(before);
  expect(await page.locator('.customization-character').boundingBox()).toEqual(preview);
  expect(await page.locator('.character-tabs').boundingBox()).toEqual(tabs);
  await expect(generate).toBeInViewport();
  await generate.click();
  await expect(page.locator('.customization-preview')).not.toHaveAttribute('data-seed', '42');
});

test('all ear choices use authored masks on the actual sprite without changing the head or body', async ({ page }) => {
  await openCustomization(page);
  await page.getByRole('group', { name: 'Ear shape', exact: true }).getByRole('button', { name: 'Upright', exact: true }).click();
  const choices = page.getByRole('group', { name: 'Ear markings' });
  await expect(choices.getByRole('button')).toHaveCount(5);
  await choices.getByRole('button', { name: 'Both marked', exact: true }).click();
  await page.getByLabel('Ear color', { exact: true }).fill('#aa6677');
  await choices.getByRole('button', { name: 'Plain', exact: true }).click();
  await expect(page.getByLabel('Ear color', { exact: true })).toBeDisabled();
  const base = await page.locator('.customization-character').evaluate(canvas =>
    Array.from((canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 18, 29).data));
  const images = new Set<string>();
  const expectedSide = 'left';
  for (const { type, name } of CHARACTER_EAR_MARKINGS) {
    const choice = choices.getByRole('button', { name, exact: true });
    await choice.click();
    await expect(choice).toHaveAttribute('aria-pressed', 'true');
    await expect(choices.locator('[aria-pressed="true"]')).toHaveCount(1);
    images.add(await artwork(page));
    const changed = await page.locator('.customization-character').evaluate((canvas, original) => {
      const pixels = (canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 18, 29).data;
      const changes: string[] = [];
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels.slice(i, i + 4).some((value, channel) => value !== original[i + channel])) {
          changes.push(`${(i / 4) % 18},${Math.floor(i / 4 / 18)}`);
        }
      }
      return changes;
    }, base);
    const expected: string[] = [];
    for (const x of [5, 6, 11, 12]) {
      for (let y = 1; y <= 5; y++) {
        if (type === 'plain' || (type === 'tips' && y > 2)) continue;
        if (type === 'single' && (x < 9 ? 'left' : 'right') !== expectedSide) continue;
        if (type === 'inner' && (y < 2 || y > 4 || (x !== 6 && x !== 11))) continue;
        expected.push(`${x},${y}`);
      }
    }
    expect(new Set(changed)).toEqual(new Set(expected));
  }
  expect(images.size).toBe(5);
  await expect(page.getByRole('alert')).toBeHidden();
});

test('four ear shapes change only the ears, retain markings and colors, and never shift the preview', async ({ page }) => {
  await openCustomization(page);
  const choices = page.getByRole('group', { name: 'Ear shape', exact: true });
  await expect(choices.getByRole('button')).toHaveText(CHARACTER_EAR_SHAPES.map(option => option.name));
  await page.getByRole('button', { name: 'Inner ears', exact: true }).click();
  await page.getByLabel('Ear color', { exact: true }).fill('#aa6677');
  await page.getByRole('button', { name: 'Curious', exact: true }).click();
  await page.getByRole('group', { name: 'Accessories', exact: true }).getByRole('button', { name: 'Bandana', exact: true }).click();
  await choices.getByRole('button', { name: 'Upright', exact: true }).click();
  const base = await page.locator('.customization-character').evaluate(canvas =>
    Array.from((canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 18, 29).data));
  const bounds = await page.locator('.customization-character').boundingBox();
  const footer = await page.getByRole('button', { name: 'Generate character', exact: true }).boundingBox();
  const silhouettes = new Set<string>();
  for (const { name } of CHARACTER_EAR_SHAPES) {
    const choice = choices.getByRole('button', { name, exact: true });
    await choice.click();
    await expect(choice).toHaveAttribute('aria-pressed', 'true');
    await expect(choices.locator('[aria-pressed="true"]')).toHaveCount(1);
    await expect(page.getByLabel('Ear color', { exact: true })).toHaveValue('#aa6677');
    await expect(page.getByRole('button', { name: 'Inner ears', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Curious', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Bandana', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const pixels = await page.locator('.customization-character').evaluate(canvas =>
      Array.from((canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 18, 29).data));
    expect(pixels.slice(6 * 18 * 4)).toEqual(base.slice(6 * 18 * 4));
    silhouettes.add(pixels.filter((_, index) => index % 4 === 3).join(','));
    expect(await page.locator('.customization-character').boundingBox()).toEqual(bounds);
    expect(await page.getByRole('button', { name: 'Generate character', exact: true }).boundingBox()).toEqual(footer);
  }
  expect(silhouettes.size).toBe(4);
  await choices.getByRole('button', { name: 'Upright', exact: true }).click();
  await choices.getByRole('button', { name: 'Softly bent', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(choices.getByRole('button', { name: 'Softly bent', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Motion', exact: true }).click();
  await page.getByRole('button', { name: 'Customization', exact: true }).click();
  await expect(choices.getByRole('button', { name: 'Softly bent', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('alert')).toBeHidden();
});

test('ear shape survives independent edits and downloads, while seed URLs reproduce generated shapes', async ({ page }) => {
  await openCustomization(page);
  const choices = page.getByRole('group', { name: 'Ear shape', exact: true });
  await choices.getByRole('button', { name: 'One floppy', exact: true }).click();
  await page.getByRole('button', { name: 'Snow', exact: true }).click();
  await page.getByRole('button', { name: 'Randomize color', exact: true }).click();
  await page.getByRole('button', { name: 'Both marked', exact: true }).click();
  await page.getByLabel('Ear color', { exact: true }).fill('#aa6677');
  await expect(choices.getByRole('button', { name: 'One floppy', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download recipe' }).click();
  const stream = await (await downloadPromise).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(JSON.parse(Buffer.concat(chunks).toString())).toMatchObject({
    parameters: { pattern: { type: 'solid' }, ears: { type: 'both', shape: 'one-floppy', color: '#aa6677', colorMode: 'custom' } },
  });
  await page.getByRole('button', { name: 'Generate character', exact: true }).click();
  const seed = await page.getByRole('textbox', { name: 'Character seed', exact: true }).inputValue();
  const expected = generateAppearance(Number(seed)).parameters.ears.shape;
  const name = CHARACTER_EAR_SHAPES.find(option => option.type === expected)!.name;
  await expect(choices.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
  const generated = await artwork(page);
  await page.reload();
  await expect(choices.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await artwork(page)).toBe(generated);
});

test('ear colors link to the coat and manual overrides survive color changes and tab switches', async ({ page }) => {
  await openCustomization(page);
  const choices = page.getByRole('group', { name: 'Ear markings' });
  await choices.getByRole('button', { name: 'Tips', exact: true }).click();
  const initial = await page.getByLabel('Ear color', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Snow', exact: true }).click();
  await expect(page.getByLabel('Ear color', { exact: true })).not.toHaveValue(initial);
  await expect(page.getByRole('button', { name: 'Ear color follows coat', exact: true })).toBeDisabled();
  const colors = {
    coat: await page.getByLabel('Coat', { exact: true }).inputValue(),
    shade: await page.getByLabel('Shading', { exact: true }).inputValue(),
  };
  await choices.getByRole('button', { name: 'Inner ears', exact: true }).click();
  await expect(page.getByLabel('Ear color', { exact: true })).toHaveValue(linkedEarColor(colors, 'inner'));
  await page.getByLabel('Ear color', { exact: true }).fill('#aa6677');
  await page.getByRole('button', { name: 'Mint', exact: true }).click();
  await page.getByRole('button', { name: 'Randomize color', exact: true }).click();
  await expect(page.getByLabel('Ear color', { exact: true })).toHaveValue('#aa6677');
  await page.getByRole('button', { name: 'Motion', exact: true }).click();
  await page.getByRole('button', { name: 'Customization', exact: true }).click();
  await expect(choices.getByRole('button', { name: 'Inner ears', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Ear color', { exact: true })).toHaveValue('#aa6677');
  await page.getByRole('button', { name: 'Match ear color to coat', exact: true }).click();
  const currentColors = {
    coat: await page.getByLabel('Coat', { exact: true }).inputValue(),
    shade: await page.getByLabel('Shading', { exact: true }).inputValue(),
  };
  await expect(page.getByLabel('Ear color', { exact: true })).toHaveValue(linkedEarColor(currentColors, 'inner'));
});

test('the single ear accent stays fixed and recipes preserve ears with deterministic replay', async ({ page }) => {
  await openCustomization(page);
  await page.getByRole('button', { name: 'One marked ear', exact: true }).click();
  await page.getByLabel('Ear color', { exact: true }).fill('#aa6677');
  const firstLayout = await page.getByLabel('Ear layout', { exact: true }).textContent();
  expect(firstLayout).toBe('Left ear accent on a balanced coat.');
  await page.getByRole('button', { name: 'Randomize color', exact: true }).click();
  await expect(page.getByLabel('Ear layout', { exact: true })).toHaveText(firstLayout!);
  await expect(page.getByLabel('Ear color', { exact: true })).toHaveValue('#aa6677');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download recipe' }).click();
  const stream = await (await downloadPromise).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(JSON.parse(Buffer.concat(chunks).toString())).toMatchObject({
    version: 8, seed: 42,
    parameters: { ears: { type: 'single', color: '#aa6677', colorMode: 'custom' } },
  });
  await page.getByRole('button', { name: 'Generate character', exact: true }).click();
  const seed = await page.getByRole('textbox', { name: 'Character seed', exact: true }).inputValue();
  const expected = generateAppearance(Number(seed)).parameters.ears;
  await expect(page.getByRole('button', { name: 'Ear color follows coat', exact: true })).toBeDisabled();
  const current = await artwork(page);
  await page.reload();
  await expect(page.getByLabel('Ear color', { exact: true })).toHaveValue(expected.color);
  const name = CHARACTER_EAR_MARKINGS.find(option => option.type === expected.type)!.name;
  await expect(page.getByRole('group', { name: 'Ear markings' }).getByRole('button', { name, exact: true }))
    .toHaveAttribute('aria-pressed', 'true');
  expect(await artwork(page)).toBe(current);
});

test('four expressions use complete authored faces and preserve everything outside the face drawings', async ({ page }) => {
  await openCustomization(page);
  const choices = page.getByRole('group', { name: 'Facial expressions' });
  await expect(choices.getByRole('button')).toHaveCount(4);
  await choices.getByRole('button', { name: 'Neutral', exact: true }).click();
  const base = await page.locator('.customization-character').evaluate(canvas =>
    Array.from((canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 18, 29).data));
  const eyePixels = {
    neutral: [13 * 18 + 2, 14 * 18 + 2, 13 * 18 + 11, 14 * 18 + 11],
    happy: [
      12 * 18 + 3, 13 * 18 + 2, 13 * 18 + 3, 13 * 18 + 4, 14 * 18 + 2, 14 * 18 + 4,
      12 * 18 + 11, 13 * 18 + 10, 13 * 18 + 11, 13 * 18 + 12, 14 * 18 + 10, 14 * 18 + 12,
    ],
    sleepy: [
      12 * 18 + 2, 12 * 18 + 3, 12 * 18 + 4, 12 * 18 + 5, 13 * 18 + 4, 14 * 18 + 3, 14 * 18 + 4,
      12 * 18 + 10, 12 * 18 + 11, 12 * 18 + 12, 12 * 18 + 13, 13 * 18 + 12, 14 * 18 + 11, 14 * 18 + 12,
    ],
    curious: [
      9 * 18 + 3, 9 * 18 + 4, 11 * 18 + 3, 12 * 18 + 2, 12 * 18 + 4,
      13 * 18 + 2, 13 * 18 + 3, 13 * 18 + 4, 14 * 18 + 3,
      12 * 18 + 10, 12 * 18 + 11, 12 * 18 + 12, 13 * 18 + 11, 13 * 18 + 12, 14 * 18 + 11,
    ],
  };
  const eyeWhites = {
    neutral: [], happy: [],
    sleepy: [13 * 18 + 3, 13 * 18 + 11],
    curious: [12 * 18 + 3, 13 * 18 + 10],
  };
  const images = new Set<string>();
  const footer = await page.getByRole('button', { name: 'Generate character', exact: true }).boundingBox();
  for (const { type, name, description } of CHARACTER_EXPRESSIONS) {
    const choice = choices.getByRole('button', { name, exact: true });
    await choice.click();
    await expect(choice).toHaveAttribute('aria-pressed', 'true');
    await expect(choices.locator('[aria-pressed="true"]')).toHaveCount(1);
    await expect(page.getByLabel('Expression details', { exact: true })).toHaveText(description);
    await expect(page.getByRole('img', { name: new RegExp(`^Customized rabbit, ${name.toLowerCase()} expression,`) })).toBeVisible();
    const pixels = await page.locator('.customization-character').evaluate(canvas =>
      Array.from((canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 18, 29).data));
    const allowed = new Set([...eyePixels.neutral, ...eyePixels[type], ...eyeWhites[type]]);
    for (let index = 0; index < pixels.length; index += 4) {
      expect(pixels[index + 3]).toBe(base[index + 3]);
      if (!allowed.has(index / 4)) expect(pixels.slice(index, index + 4)).toEqual(base.slice(index, index + 4));
    }
    for (const index of eyePixels[type]) expect(pixels.slice(index * 4, index * 4 + 4)).toEqual([0, 0, 0, 255]);
    for (const index of eyeWhites[type]) expect(pixels.slice(index * 4, index * 4 + 4)).toEqual([255, 249, 237, 255]);
    images.add(await artwork(page));
    expect(await page.getByRole('button', { name: 'Generate character', exact: true }).boundingBox()).toEqual(footer);
  }
  expect(images.size).toBe(4);
});

test('expressions survive independent edits and tab switches and are included in downloads and seeded replay', async ({ page }) => {
  await openCustomization(page);
  const choices = page.getByRole('group', { name: 'Facial expressions' });
  await choices.getByRole('button', { name: 'Sleepy', exact: true }).click();
  await page.getByRole('button', { name: 'Randomize color', exact: true }).click();
  await page.getByRole('button', { name: 'Inner ears', exact: true }).click();
  await page.getByLabel('Ear color', { exact: true }).fill('#aa6677');
  await page.getByRole('button', { name: 'Motion', exact: true }).click();
  await page.getByRole('button', { name: 'Customization', exact: true }).click();
  await expect(choices.getByRole('button', { name: 'Sleepy', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download recipe' }).click();
  const stream = await (await downloadPromise).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(JSON.parse(Buffer.concat(chunks).toString())).toMatchObject({
    version: 8, seed: 42, parameters: {
      expression: { type: 'sleepy' },
      ears: { type: 'inner', color: '#aa6677', colorMode: 'custom' },
      pattern: { type: 'solid' },
    },
  });
  await page.getByRole('button', { name: 'Generate character', exact: true }).click();
  const seed = await page.getByRole('textbox', { name: 'Character seed', exact: true }).inputValue();
  const expression = generateAppearance(Number(seed)).parameters.expression.type;
  const option = CHARACTER_EXPRESSIONS.find(option => option.type === expression)!;
  await expect(choices.getByRole('button', { name: option.name, exact: true })).toHaveAttribute('aria-pressed', 'true');
  const generated = await artwork(page);
  await page.reload();
  await expect(choices.getByRole('button', { name: option.name, exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await artwork(page)).toBe(generated);
  await page.getByRole('textbox', { name: 'Character seed', exact: true }).fill('42');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  const original = CHARACTER_EXPRESSIONS.find(option => option.type === generateAppearance(42).parameters.expression.type)!;
  await expect(choices.getByRole('button', { name: original.name, exact: true })).toHaveAttribute('aria-pressed', 'true');
});
