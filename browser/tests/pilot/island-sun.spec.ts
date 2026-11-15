import { expect, test, type Locator, type Page } from '@playwright/test';
import { presentationImage, presentationPixels } from './island-presentation';

const islandURL = '/#/island?version=v2&source=island&seed=12&water=still';
const surface = (page: Page) => page.locator('canvas[data-island-surface="true"]');
const sliderNames = ['Sun direction', 'Sun elevation', 'Sun intensity', 'Sky fill', 'Sun warmth', 'Shadow strength', 'Shadow softness'];

async function ready(page: Page, url = islandURL): Promise<void> {
  await page.goto(url);
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
}

async function setSlider(page: Page, name: string, value: string): Promise<void> {
  await page.getByRole('slider', { name, exact: true }).fill(value);
}

async function pixels(canvas: Locator): Promise<string> {
  return presentationImage(canvas);
}

async function geometry(canvas: Locator): Promise<Record<string, string | undefined>> {
  return canvas.evaluate((node: HTMLCanvasElement) => Object.fromEntries(
    ['seed', 'triangles', 'sourceTriangles', 'ramps', 'ascents', 'ascentKinds', 'ascentSteps',
      'terraceEdges', 'conditionedCorners', 'elevationHeights', 'maximumHeight']
      .map(key => [key, node.dataset[key]]),
  ));
}

test('Whole island loads no scale artwork and has no scale labels in either appearance', async ({ page }) => {
  const rabbits: string[] = [];
  page.on('request', request => { if (/rabbit[^/]*\.png/i.test(request.url())) rabbits.push(request.url()); });
  await ready(page);
  await expect(surface(page)).toHaveAttribute('data-scale-references', '0');
  await expect(page.locator('.p-stage figcaption')).not.toContainText(/rabbit|scale/i);
  await expect(page.locator('.p-tools')).not.toContainText(/rabbit|scale reference/i);
  await page.getByRole('button', { name: 'Blockout', exact: true }).click();
  await expect(surface(page)).toHaveAttribute('data-scale-references', '0');
  await expect(surface(page)).toHaveAttribute('data-appearance', 'blockout');
  expect(rabbits).toEqual([]);
});

test('sun direction changes actual land and paused ocean bytes without changing geometry', async ({ page }) => {
  await ready(page, `${islandURL}&sunAzimuth=35&sunElevation=25&shadowQuality=512`);
  const canvas = surface(page);
  const ocean = page.locator('.island-orbit-canvas');
  const before = await geometry(canvas);
  const waterTime = await canvas.getAttribute('data-water-time');
  const landIndices = await (async () => {
    const data = await presentationPixels(canvas);
    const indices: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 255 && data[i + 1] > data[i + 2] + 12 && data[i + 1] > data[i]) indices.push(i);
    }
    return indices;
  })();
  expect(landIndices.length).toBeGreaterThan(100);
  const landBytes = async () => {
    const data = await presentationPixels(canvas);
    let hash = 2166136261;
    for (const index of landIndices) for (let c = 0; c < 3; c++) hash = Math.imul(hash ^ data[index + c], 16777619);
    return hash >>> 0;
  };
  const originalLand = await landBytes();
  const originalOcean = await pixels(ocean);
  await setSlider(page, 'Sun direction', '215');
  await expect(canvas).toHaveAttribute('data-sun-azimuth', '215');
  await expect.poll(landBytes).not.toBe(originalLand);
  await expect.poll(() => pixels(ocean)).not.toBe(originalOcean);
  expect(await geometry(canvas)).toEqual(before);
  expect(await canvas.getAttribute('data-water-time')).toBe(waterTime);
  const paused = await pixels(canvas);
  await page.waitForTimeout(300);
  expect(await pixels(canvas)).toBe(paused);
  await expect(canvas).toHaveAttribute('data-lighting', 'directional-ambient-shadow');
});

test('all sun settings round-trip through URLs, water toggles, generation, projections and reload', async ({ page }) => {
  await ready(page, `${islandURL}&layers=water:surfaceHighlights=1`);
  for (const [name, value] of [
    ['Sun direction', '270'], ['Sun elevation', '35'], ['Sun intensity', '1.5'], ['Sky fill', '0.25'],
    ['Sun warmth', '0.75'], ['Shadow strength', '0.8'],
  ]) await setSlider(page, name, value);
  await page.getByRole('combobox', { name: 'Shadow mode', exact: true }).selectOption('contact');
  await setSlider(page, 'Shadow softness', '4');
  await page.getByRole('combobox', { name: 'Shadow quality', exact: true }).selectOption('512');
  await expect(surface(page)).toHaveAttribute('data-shadow-quality', '512');
  const expected = {
    sunAzimuth: '270', sunElevation: '35', sunIntensity: '1.5', skyFill: '0.25', sunWarmth: '0.75',
    shadowStrength: '0.8', shadowSoftness: '4', shadowMode: 'contact', shadowQuality: '512',
  };
  const parameters = () => page.evaluate(() => Object.fromEntries(new URLSearchParams(location.hash.split('?')[1])));
  expect(await parameters()).toMatchObject(expected);
  await page.getByRole('button', { name: 'Animate water', exact: true }).click();
  await page.getByRole('button', { name: 'Pause water', exact: true }).click();
  await page.getByRole('button', { name: 'Current axes', exact: true }).click();
  await expect(surface(page)).toHaveAttribute('data-terrace-edges', 'grid');
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(surface(page)).toHaveAttribute('data-seed', '13');
  expect(await parameters()).toMatchObject(expected);
  await page.reload();
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  for (const [name, value] of [
    ['Sun direction', '270'], ['Sun elevation', '35'], ['Sun intensity', '1.5'], ['Sky fill', '0.25'],
    ['Sun warmth', '0.75'], ['Shadow strength', '0.8'], ['Shadow softness', '4'],
  ]) await expect(page.getByRole('slider', { name, exact: true })).toHaveValue(value);
  await expect(surface(page)).toHaveAttribute('data-projection', 'current');
  await expect(surface(page)).toHaveAttribute('data-shadow-mode', 'contact');
  await expect(surface(page)).toHaveAttribute('data-shadow-softness', '4');
  await expect(surface(page)).toHaveAttribute('data-shadow-quality', '512');
});

test('unlit views disable sun controls but wireframe remains lit and settings survive toggles', async ({ page }) => {
  await ready(page, `${islandURL}&sunAzimuth=123&shadowMode=contact&shadowQuality=512`);
  async function disabled(value: boolean): Promise<void> {
    const controls = [
      ...sliderNames.map(name => page.getByRole('slider', { name, exact: true })),
      ...['Shadow mode', 'Shadow quality'].map(name => page.getByRole('combobox', { name, exact: true })),
      page.getByRole('button', { name: 'Reset sun', exact: true }),
    ];
    for (const control of controls) {
      if (value) await expect(control).toBeDisabled();
      else await expect(control).toBeEnabled();
    }
  }
  for (const name of ['Projection checker', 'Material regions']) {
    await page.getByRole('checkbox', { name, exact: true }).check();
    await disabled(true);
    await page.getByRole('checkbox', { name, exact: true }).uncheck();
    await disabled(false);
  }
  await page.getByRole('checkbox', { name: 'Triangle wireframe', exact: true }).check();
  await disabled(false);
  await page.getByRole('button', { name: 'Elevation plan', exact: true }).click();
  await disabled(true);
  await page.getByRole('button', { name: 'Elevated oblique', exact: true }).click();
  await page.getByRole('button', { name: 'Blockout', exact: true }).click();
  await disabled(true);
  await page.getByRole('button', { name: 'Environment', exact: true }).click();
  await disabled(false);
  await expect(page.getByRole('slider', { name: 'Sun direction', exact: true })).toHaveValue('123');
});

test('keyboard inputs update readouts and reset restores defaults including after reload', async ({ page }) => {
  await ready(page);
  const controls = page.locator('.p-section').filter({ has: page.getByRole('heading', { name: 'Sun and shadows', exact: true }) });
  const defaults = await controls.locator('input, select').evaluateAll(nodes => nodes.map(node => (node as HTMLInputElement).value));
  const readouts = await controls.locator('output').allTextContents();
  const direction = page.getByRole('slider', { name: 'Sun direction', exact: true });
  await direction.focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await expect(direction).toHaveValue('1');
  await expect(controls.locator('output').first()).toHaveText('1°');
  await expect(surface(page)).toHaveAttribute('data-sun-azimuth', '1');
  await page.getByRole('combobox', { name: 'Shadow mode', exact: true }).selectOption('contact');
  await setSlider(page, 'Shadow softness', '7');
  await expect(controls.locator('output').last()).toHaveText('7°');
  await page.getByRole('button', { name: 'Reset sun', exact: true }).click();
  await expect.poll(() => controls.locator('input, select').evaluateAll(nodes => nodes.map(node => (node as HTMLInputElement).value))).toEqual(defaults);
  expect(await controls.locator('output').allTextContents()).toEqual(readouts);
  await expect(surface(page)).toHaveAttribute('data-sun-azimuth', defaults[0]);
  await page.reload();
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  expect(await controls.locator('input, select').evaluateAll(nodes => nodes.map(node => (node as HTMLInputElement).value))).toEqual(defaults);
});

for (const parameter of [
  'sunAzimuth=361', 'sunElevation=9', 'sunIntensity=NaN', 'skyFill=1.1', 'sunWarmth=-1',
  'shadowStrength=Infinity', 'shadowSoftness=9', 'shadowMode=unknown', 'shadowQuality=256',
]) {
  test(`invalid sun URL surfaces a shared-shell error: ${parameter}`, async ({ page }) => {
    await page.goto(`${islandURL}&${parameter}`);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('The study needs attention');
    await expect(page.getByRole('alert')).toContainText(/sun|shadow|sky/i);
    await expect(page.locator('.p-panel')).toHaveCount(1);
  });
}
