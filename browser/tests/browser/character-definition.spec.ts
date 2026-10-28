import { expect, test, type Page } from '@playwright/test';
import '../../src/debug';
import { generateAppearance } from '../../src/core/character-appearance';
import { sampleRabbitMotion } from '../../src/core/character-motion';

async function openCharacter(page: Page): Promise<void> {
  await page.goto('/#/character?tab=customization&colorSeed=42');
  await expect(page.getByRole('group', { name: 'Ear shape', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toBeHidden();
}

async function download(page: Page, name: string): Promise<Record<string, unknown>> {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name, exact: true }).click();
  const stream = await (await pending).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString());
}

test('one customized character flows into Creation and Motion, including full folded ears and accessories', async ({ page }) => {
  await openCharacter(page);
  await page.getByLabel('Coat', { exact: true }).fill('#20aa80');
  await page.getByRole('button', { name: 'Both floppy', exact: true }).click();
  await page.getByRole('button', { name: 'Inner ears', exact: true }).click();
  await page.getByLabel('Ear color', { exact: true }).fill('#e77f99');
  await page.getByRole('button', { name: 'Curious', exact: true }).click();
  await page.getByRole('button', { name: 'Bandana', exact: true }).click();
  await page.getByLabel('Accessory color', { exact: true }).fill('#3d56de');
  const expected = await page.evaluate(() => window.__longTable!.view.getCharacterAppearance());
  expect(expected).toMatchObject({
    parameters: {
      color: { coat: '#20aa80' }, ears: { shape: 'both-floppy', type: 'inner', color: '#e77f99' },
      expression: { type: 'curious' }, accessory: { type: 'bandana', color: '#3d56de' },
    },
  });
  await page.getByRole('button', { name: 'Creation', exact: true }).click();
  expect(await page.evaluate(() => window.__longTable!.view.getCharacterRigAudit()?.restDifferencePixels)).toBe(0);
  expect(await page.evaluate(() => window.__longTable!.view.getCharacterAppearance())).toEqual(expected);
  const owner = await page.evaluate(() => {
    const { view, simulation } = window.__longTable!;
    return view.pickCharacterRigPart({
      x: simulation.character.position.x + (1.5 - 9) * 12 / 29,
      y: simulation.character.position.y + (4.5 - 29) * 12 / 29,
    });
  });
  expect(owner).toBe('left-ear');
  await page.getByRole('button', { name: 'Motion', exact: true }).click();
  await page.getByRole('slider', { name: 'Hop cycle', exact: true }).fill('40');
  const pose = await page.evaluate(() => window.__longTable!.view.getCharacterMotion());
  expect(pose?.phase).toBeCloseTo(0.4);
  expect(await page.evaluate(() => window.__longTable!.view.getCharacterAppearance())).toEqual(expected);
  await page.getByRole('button', { name: 'Step one frame', exact: true }).click();
  expect(await page.evaluate(() => window.__longTable!.view.getCharacterMotion()?.phase)).not.toBe(pose?.phase);
  await page.getByRole('button', { name: 'Customization', exact: true }).click();
  await expect(page.getByLabel('Coat', { exact: true })).toHaveValue('#20aa80');
  await expect(page.getByRole('button', { name: 'Both floppy', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('alert')).toBeHidden();
});

test('rig edits drive the customized animation, survive generation, and are included in both downloads', async ({ page }) => {
  await openCharacter(page);
  await page.getByRole('button', { name: 'One floppy', exact: true }).click();
  await page.getByRole('button', { name: 'Creation', exact: true }).click();
  await page.getByRole('slider', { name: 'Position X', exact: true }).fill('1.5');
  await page.getByRole('slider', { name: 'Angle', exact: true }).fill('5');
  await page.getByRole('slider', { name: 'Explode', exact: true }).fill('100');
  const setup = await page.evaluate(() => window.__longTable!.view.getCharacterRig());
  await page.getByRole('button', { name: 'Motion', exact: true }).click();
  await page.getByRole('slider', { name: 'Hop cycle', exact: true }).fill('30');
  const character = await page.evaluate(() => structuredClone(window.__longTable!.simulation.character));
  const animated = await page.evaluate(() => window.__longTable!.view.getCharacterMotion());
  const expected = sampleRabbitMotion(character, setup!);
  expect(animated?.rig.parts.head.angle).toBeCloseTo(expected.rig.parts.head.angle, 10);
  expect(animated?.rig.parts.head.offset.x).toBeCloseTo(expected.rig.parts.head.offset.x, 10);
  expect(animated?.rig.parts.head.pivot).toEqual(expected.rig.parts.head.pivot);
  expect(animated?.rig.explode).toBe(0);
  expect(animated?.rig.parts.head.offset.x).toBeCloseTo(sampleRabbitMotion(character).rig.parts.head.offset.x + 1.5);
  await page.getByRole('button', { name: 'Creation', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Explode', exact: true })).toHaveValue('100');
  await expect(page.getByRole('slider', { name: 'Angle', exact: true })).toHaveValue('5');
  await page.getByText('Rig data', { exact: true }).click();
  const rigRecipe = await download(page, 'Download rig');
  expect(rigRecipe).toMatchObject({
    character: { parameters: { ears: { shape: 'one-floppy' } }, rig: { setup: { explode: 0, parts: { head: { angle: 5, offset: { x: 1.5 } } } } } },
  });
  await page.getByRole('button', { name: 'Customization', exact: true }).click();
  const recipe = await download(page, 'Download recipe');
  expect(recipe).toMatchObject({
    parameters: { ears: { shape: 'one-floppy' } },
    rig: { setup: { explode: 0, parts: { head: { angle: 5, offset: { x: 1.5 } } } } },
  });
  await page.getByRole('button', { name: 'Generate character', exact: true }).click();
  await page.getByRole('button', { name: 'Creation', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Position X', exact: true })).toHaveValue('1.5');
  await expect(page.getByRole('slider', { name: 'Angle', exact: true })).toHaveValue('5');
  await page.getByRole('button', { name: 'Reset rig', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Position X', exact: true })).toHaveValue('0');
  expect(await page.evaluate(() => window.__longTable!.view.getCharacterAppearance())).not.toBeNull();
  await expect(page.getByRole('alert')).toBeHidden();
});

test('seeded Motion and Creation URLs load the same generated character without visiting Customization first', async ({ page }) => {
  for (const tab of ['motion', 'creation']) {
    await page.goto(`/#/character?tab=${tab}&colorSeed=123`);
    await page.waitForFunction(() => window.__longTable?.ready);
    await expect(page.getByRole('alert')).toBeHidden();
    expect(await page.evaluate(() => window.__longTable!.view.getCharacterAppearance())).toEqual(generateAppearance(123));
    if (tab === 'creation') expect(await page.evaluate(() => window.__longTable!.view.getCharacterRigAudit()?.restDifferencePixels)).toBe(0);
  }
  await page.goto('/#/play');
  await page.waitForFunction(() => window.__longTable?.ready);
  expect(await page.evaluate(() => window.__longTable!.view.getCharacterAppearance())).toBeNull();
});
