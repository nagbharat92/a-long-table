import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_WATER_SETTINGS, waterParameters } from '../../src/world-family/render/island-water-settings';
import { presentationImage } from './island-presentation';

test.use({
  headless: true,
  launchOptions: { executablePath: '/Applications/Microsoft Edge Canary.app/Contents/MacOS/Microsoft Edge Canary' },
});

const islandURL = '/#/island?version=v2&source=island&seed=153025&water=still&shadowQuality=512';
const surface = (page: Page) => page.locator('canvas[data-island-surface="true"]');
const waterSection = (page: Page) => page.locator('.p-section').filter({
  has: page.getByRole('heading', { name: 'Water art', exact: true }),
});
const colorNames = ['Shallow water color', 'Middle water color', 'Deep water color'];
const sliderNames = [
  'Depth blend softness', 'Shallow color noise', 'Deep color noise', 'Wave tip softness',
  'Middle color depth', 'Deep color depth', 'Noise patch size', 'Noise drift speed',
];

async function ready(page: Page, url = islandURL): Promise<void> {
  await page.goto(url);
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  await expect(surface(page)).toHaveAttribute('data-presentation', 'webgl');
}

async function parameters(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] ?? '')));
}

async function geometry(page: Page): Promise<Record<string, string | undefined>> {
  return surface(page).evaluate((node: HTMLCanvasElement) => Object.fromEntries(
    ['seed', 'view', 'yaw', 'projection', 'triangles', 'sourceTriangles', 'ramps', 'ascents', 'ascentKinds',
      'ascentSteps', 'terraceEdges', 'conditionedCorners', 'elevationHeights', 'maximumHeight',
      'seabedSourceTriangles', 'coastDryCells', 'uplandShoulderHeights']
      .map(key => [key, node.dataset[key]]),
  ));
}

async function setColor(page: Page, name: string, value: string): Promise<void> {
  // Do not open an OS-native color dialog in a disposable headless fixture.
  await page.getByLabel(name, { exact: true }).evaluate((node: HTMLInputElement, value) => {
    node.value = value;
    node.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function setSlider(page: Page, name: string, value: string): Promise<void> {
  await page.getByRole('slider', { name, exact: true }).fill(value);
}

async function openAdvanced(page: Page): Promise<void> {
  await waterSection(page).getByText('Advanced water', { exact: true }).click();
}

async function expectFrozen(page: Page): Promise<void> {
  const time = await surface(page).getAttribute('data-water-time');
  const pixels = await presentationImage(surface(page));
  await page.waitForTimeout(400);
  expect(await surface(page).getAttribute('data-water-time')).toBe(time);
  expect(await presentationImage(surface(page))).toBe(pixels);
}

test('water art has three native color pickers and labelled keyboard sliders with live readouts', async ({ page }) => {
  await ready(page);
  const controls = waterSection(page);
  await expect(controls.locator('input[type="color"]')).toHaveCount(3);
  await expect(controls.locator('input[type="range"]')).toHaveCount(8);
  for (const name of colorNames) {
    const picker = page.getByLabel(name, { exact: true });
    await expect(picker).toHaveAttribute('type', 'color');
    await picker.focus();
    await expect(picker).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(picker).not.toBeFocused();
  }
  await openAdvanced(page);
  for (const name of sliderNames) {
    const input = page.getByRole('slider', { name, exact: true });
    await expect(input).toHaveAttribute('type', 'range');
    await input.focus();
    await expect(input).toBeFocused();
  }
  const blend = page.getByRole('slider', { name: 'Depth blend softness', exact: true });
  await blend.focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await expect(blend).toHaveValue('0.05');
  await expect(controls.locator('label').filter({ has: blend }).locator('output')).toHaveText('0.05');
  await expect.poll(() => parameters(page)).toMatchObject({ waterBlendSoftness: '0.05' });
  await expect(page.getByRole('button', { name: 'Reset water', exact: true })).toBeEnabled();
});

test('water colors affect paused pixels immediately and all settings survive view changes and reload', async ({ page }) => {
  await ready(page, `${islandURL}&view=2&projection=current&sunAzimuth=133`);
  const before = await geometry(page);
  const time = await surface(page).getAttribute('data-water-time');
  for (const [name, value, parameter, rgb] of [
    ['Shallow water color', '#64d2dc', 'waterShallow', '100,210,220'],
    ['Middle water color', '#50a0e6', 'waterMiddle', '80,160,230'],
    ['Deep water color', '#1446a0', 'waterDeep', '20,70,160'],
  ]) {
    const pixels = await presentationImage(surface(page));
    await setColor(page, name, value);
    await expect.poll(() => parameters(page)).toMatchObject({ [parameter]: rgb });
    await expect.poll(() => presentationImage(surface(page))).not.toBe(pixels);
    expect(await geometry(page)).toEqual(before);
    expect(await surface(page).getAttribute('data-water-time')).toBe(time);
  }
  await openAdvanced(page);
  const settings = [
    ['Middle color depth', '6'], ['Deep color depth', '14'], ['Depth blend softness', '0.8'],
    ['Shallow color noise', '12'], ['Deep color noise', '3'], ['Noise patch size', '6'],
    ['Noise drift speed', '0.12'], ['Wave tip softness', '0.4'],
  ];
  for (const [name, value] of settings) await setSlider(page, name, value);
  const expected = {
    waterShallow: '100,210,220', waterMiddle: '80,160,230', waterDeep: '20,70,160',
    waterTransitionDepth: '6', waterDeepDepth: '14', waterBlendSoftness: '0.8',
    waterNoiseShallow: '12', waterNoiseDeep: '3', waterNoiseScale: '6', waterNoiseSpeed: '0.12',
    waveEndSoftness: '0.4', sunAzimuth: '133', seed: '153025', view: '2', water: 'still',
  };
  await expect.poll(() => parameters(page)).toMatchObject(expected);
  expect(await geometry(page)).toEqual(before);
  await expectFrozen(page);
  await page.getByRole('button', { name: 'Elevated oblique', exact: true }).click();
  await page.getByRole('button', { name: 'Current axes', exact: true }).click();
  expect(await parameters(page)).toMatchObject(expected);
  await page.reload();
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  await openAdvanced(page);
  for (const [name, value] of settings) await expect(page.getByRole('slider', { name, exact: true })).toHaveValue(value);
  for (const [name, value] of [
    ['Shallow water color', '#64d2dc'], ['Middle water color', '#50a0e6'], ['Deep water color', '#1446a0'],
  ]) await expect(page.getByLabel(name, { exact: true })).toHaveValue(value);
  expect(await geometry(page)).toEqual(before);
  expect(await surface(page).getAttribute('data-water-time')).toBe(time);
  expect(await parameters(page)).toMatchObject(expected);
  await expectFrozen(page);
});

test('reset only water preserves nonzero paused time, geometry, view, sun, layers and zoom', async ({ page }) => {
  await ready(page, `${islandURL.replace('water=still', 'water=animated')}&view=1&sunAzimuth=133&layers=water:surfaceHighlights=1`);
  await expect.poll(async () => Number(await surface(page).getAttribute('data-water-time'))).toBeGreaterThan(0.25);
  await page.getByRole('button', { name: 'Pause water', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const frame = page.locator('.landform-canvas-frame');
  await frame.evaluate(node => { node.scrollLeft = 20; node.scrollTop = 20; });
  const before = await geometry(page);
  const time = await surface(page).getAttribute('data-water-time');
  const magnification = await surface(page).getAttribute('data-magnification');
  const scroll = await frame.evaluate(node => [node.scrollLeft, node.scrollTop]);
  const original = await presentationImage(surface(page));
  const priorURL = await parameters(page);
  await setColor(page, 'Deep water color', '#184699');
  await setSlider(page, 'Shallow color noise', '16');
  await setSlider(page, 'Wave tip softness', '0.4');
  await expect.poll(() => parameters(page)).toMatchObject({ waterDeep: '24,70,153', waterNoiseShallow: '16', waveEndSoftness: '0.4' });
  await page.getByRole('button', { name: 'Reset water', exact: true }).click();
  const defaults = Object.fromEntries(waterParameters(DEFAULT_WATER_SETTINGS));
  await expect.poll(() => parameters(page)).toMatchObject(defaults);
  expect(await geometry(page)).toEqual(before);
  expect(await surface(page).getAttribute('data-water-time')).toBe(time);
  expect(await surface(page).getAttribute('data-magnification')).toBe(magnification);
  expect(await frame.evaluate(node => [node.scrollLeft, node.scrollTop])).toEqual(scroll);
  const afterURL = await parameters(page);
  for (const key of Object.keys(priorURL).filter(key => !(key in defaults))) expect(afterURL[key]).toBe(priorURL[key]);
  await expect(page.getByRole('slider', { name: 'Sun direction', exact: true })).toHaveValue('133');
  await expect(page.getByRole('button', { name: 'Animate water', exact: true })).toBeEnabled();
  await expect.poll(() => presentationImage(surface(page))).toBe(original);
  await expectFrozen(page);
});

test('ordered depth sliders retain fractional URL settings and cannot cross palette anchors', async ({ page }) => {
  await ready(page, `${islandURL}&waterTransitionDepth=3.55&waterDeepDepth=3.56`);
  await openAdvanced(page);
  const middle = page.getByRole('slider', { name: 'Middle color depth', exact: true });
  const deep = page.getByRole('slider', { name: 'Deep color depth', exact: true });
  await expect(middle).toHaveValue('3.55');
  await expect(deep).toHaveValue('3.56');
  await expect(deep).toHaveAttribute('step', 'any');
  await middle.focus();
  await page.keyboard.press('End');
  await deep.focus();
  await page.keyboard.press('Home');
  const params = await parameters(page);
  expect(Number(params.waterTransitionDepth)).toBeLessThan(Number(params.waterDeepDepth));
  await expect(page.getByRole('alert')).toBeHidden();
  await setSlider(page, 'Deep color depth', '8');
  await setSlider(page, 'Middle color depth', '7.9');
  await middle.focus();
  await page.keyboard.press('End');
  await expect.poll(async () => {
    const values = await parameters(page);
    return Number(values.waterTransitionDepth) < Number(values.waterDeepDepth);
  }).toBe(true);
  await expect(page.getByRole('alert')).toBeHidden();
});

test('unlit views and hidden water disable controls consistently without losing values', async ({ page }) => {
  await ready(page, `${islandURL}&waterNoiseShallow=12`);
  await openAdvanced(page);
  async function disabled(value: boolean): Promise<void> {
    for (const input of await waterSection(page).locator('input, button').all()) {
      if (value) await expect(input).toBeDisabled();
      else await expect(input).toBeEnabled();
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
  await page.getByRole('checkbox', { name: 'Water layer', exact: true }).uncheck();
  await disabled(true);
  await page.getByRole('checkbox', { name: 'Water layer', exact: true }).check();
  await disabled(false);
  await expect(page.getByRole('slider', { name: 'Shallow color noise', exact: true })).toHaveValue('12');
});

test('Landform study round-trip preserves the water palette and noise settings', async ({ page }) => {
  await ready(page, `${islandURL}&waterDeep=20,90,115&waterNoiseShallow=4`);
  await page.getByRole('link', { name: 'Landform study', exact: true }).click();
  await expect(page.locator('.pilot')).toHaveAttribute('data-study', 'landform');
  await expect.poll(() => parameters(page)).toMatchObject({ waterDeep: '20,90,115', waterNoiseShallow: '4' });
  await page.getByRole('link', { name: 'Whole island', exact: true }).click();
  await expect(surface(page)).toHaveAttribute('data-presentation', 'webgl');
  await expect(page.getByLabel('Deep water color', { exact: true })).toHaveValue('#145a73');
  await expect(page.getByRole('slider', { name: 'Shallow color noise', exact: true })).toHaveValue('4');
  await expect.poll(() => parameters(page)).toMatchObject({ seed: '153025', waterDeep: '20,90,115', waterNoiseShallow: '4' });
});

test('noise alone animates water, but disabled patches, zero speed or zero amplitudes are calm', async ({ page }) => {
  const layers = 'water:surfaceResponse=0,surfaceHighlights=0,waves=0,shoreFoam=0,colorPatches=1';
  await ready(page, `${islandURL.replace('water=still', 'water=animated')}&layers=${layers}&waterNoiseShallow=12&waterNoiseDeep=3`);
  const motion = page.getByRole('button', { name: 'Pause water', exact: true });
  const meta = page.locator('[data-layer-meta="water"]');
  await expect(motion).toBeEnabled();
  await expect(meta).toHaveText('Animated');
  const initial = await presentationImage(surface(page));
  await expect.poll(async () => Number(await surface(page).getAttribute('data-water-time'))).toBeGreaterThan(0.25);
  await expect.poll(() => presentationImage(surface(page))).not.toBe(initial);
  await page.locator('[data-layer-card="water"] summary').click();
  const patches = page.getByRole('checkbox', { name: 'Water Color patches', exact: true });
  await patches.uncheck();
  await expect(meta).toHaveText('Calm');
  await expect(page.getByRole('button', { name: 'Water motion off', exact: true })).toBeDisabled();
  await expectFrozen(page);
  await patches.check();
  await expect(motion).toBeEnabled();
  await openAdvanced(page);
  await setSlider(page, 'Noise drift speed', '0');
  await expect(meta).toHaveText('Calm');
  await expectFrozen(page);
  await setSlider(page, 'Shallow color noise', '0');
  await setSlider(page, 'Deep color noise', '0');
  await setSlider(page, 'Noise drift speed', '0.2');
  await expect(meta).toHaveText('Calm');
  await expect(page.getByRole('button', { name: 'Water motion off', exact: true })).toBeDisabled();
  await expectFrozen(page);
  await setSlider(page, 'Deep color noise', '1');
  await expect(meta).toHaveText('Animated');
  const resumed = Number(await surface(page).getAttribute('data-water-time'));
  await expect.poll(async () => Number(await surface(page).getAttribute('data-water-time'))).toBeGreaterThan(resumed);
});

test('390px controls stay within the flat scrolling panel and leave Generate fixed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  const generate = page.locator('.p-primary-controls').getByRole('button', { name: 'Generate', exact: true });
  const before = await generate.boundingBox();
  await openAdvanced(page);
  for (const name of [...colorNames, ...sliderNames]) {
    const control = page.getByLabel(name, { exact: true });
    await control.focus();
    await expect(control).toBeFocused();
    const bounds = await control.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  }
  await expect(generate).toBeInViewport();
  expect(await generate.boundingBox()).toEqual(before);
  expect(await page.evaluate(() => ({
    page: document.documentElement.scrollWidth > innerWidth,
    panel: [...document.querySelectorAll('.p-panel-scroll')].some(node => node.scrollWidth > node.clientWidth),
  }))).toEqual({ page: false, panel: false });
});

test('reduced motion keeps default noise still through water editing', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page, islandURL.replace('&water=still', ''));
  await expect(page.getByRole('button', { name: 'Animate water', exact: true })).toBeEnabled();
  await setColor(page, 'Middle water color', '#4b90ac');
  await expect.poll(() => parameters(page)).toMatchObject({ waterMiddle: '75,144,172', water: 'still' });
  await expectFrozen(page);
});

test('CPU fallback backdrop keeps water colors and inspection flags when surface response is off', async ({ page }) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = new Proxy(HTMLCanvasElement.prototype.getContext, {
      apply(target, receiver, args) {
        if (args[0] === 'webgl' || args[0] === 'webgl2') return null;
        return Reflect.apply(target, receiver, args);
      },
    });
  });
  await page.goto(`${islandURL}&layers=water:surfaceResponse=0,surfaceHighlights=0,shoreFoam=0&waterNoiseDeep=4`);
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  await expect(surface(page)).toHaveAttribute('data-presentation', 'cpu');
  const backdrop = page.locator('.island-ocean-backdrop');
  await expect(backdrop).toBeVisible();
  const pixels = () => backdrop.evaluate((node: HTMLCanvasElement) => node.toDataURL());
  const before = await geometry(page);
  const initial = await pixels();
  await setColor(page, 'Deep water color', '#1446a0');
  await expect.poll(() => parameters(page)).toMatchObject({ waterDeep: '20,70,160' });
  await expect.poll(pixels).not.toBe(initial);
  await page.locator('[data-layer-card="water"] summary').click();
  const noisy = await pixels();
  await page.getByRole('checkbox', { name: 'Water Color patches', exact: true }).uncheck();
  await expect(backdrop).toBeVisible();
  await expect.poll(pixels).not.toBe(noisy);
  const lit = await pixels();
  await page.getByRole('checkbox', { name: 'Water Lighting / shadows', exact: true }).uncheck();
  await expect(backdrop).toBeVisible();
  await expect.poll(pixels).not.toBe(lit);
  await expect(page.getByRole('button', { name: 'Water motion off', exact: true })).toBeDisabled();
  expect(await geometry(page)).toEqual(before);
  await expectFrozen(page);
  await page.getByRole('checkbox', { name: 'Water layer', exact: true }).uncheck();
  await expect(backdrop).toBeHidden();
});

for (const parameter of [
  'waterShallow=256,20,30', 'waterMiddle=1.5,20,30', 'waterDeep=%23ffffff',
  'waterTransitionDepth=0', 'waterTransitionDepth=12&waterDeepDepth=12',
  'waterDeepDepth=17', 'waterBlendSoftness=1.1', 'waterNoiseShallow=NaN',
  'waterNoiseDeep=7', 'waterNoiseScale=0', 'waterNoiseSpeed=Infinity',
  'waveEndSoftness=0.41', 'waterNoiseSpeed=0.2&waterNoiseSpeed=0.3',
]) {
  test(`invalid water URL surfaces the shared-shell error: ${parameter}`, async ({ page }) => {
    await page.goto(`${islandURL}&${parameter}`);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('The study needs attention');
    await expect(page.getByRole('alert')).toContainText(/water|wave/i);
    await expect(page.locator('.p-panel')).toHaveCount(1);
  });
}
