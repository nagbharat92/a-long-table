import { expect, test } from '@playwright/test';
import { createIslandOcean } from '../../src/world-family/render/island-ocean';
import { createIslandSun, DEFAULT_SUN } from '../../src/world-family/render/island-sun';
import { createSunlitOcean } from '../../src/world-family/render/island-sun-water';
import { presentationPixels } from './island-presentation';

test('visible offshore pixels use the CPU reference patch palette, one-unit snap and drifting crests',async ({ page }) => {
  const reference = createSunlitOcean(createIslandOcean(153025),createIslandSun([],{
    ...DEFAULT_SUN,intensity: 0,skyFill: 1,mapSize: 512,
  }));
  await page.goto('/#/island?version=v2&source=island&seed=153025&water=still&shadowQuality=512&sunIntensity=0&skyFill=1&layers=water:surfaceResponse=0,surfaceHighlights=1');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready','true');
  const surface = page.locator('[data-island-surface]');
  const dimensions = (await page.locator('figcaption').textContent())!.match(/(\d+) × (\d+) world units/)!;
  const read = async () => {
    const meta = await page.locator('.island-orbit-canvas').evaluate((node: HTMLCanvasElement) => ({
      width: node.width,height: node.height,x: Number(node.dataset.originX),y: Number(node.dataset.originY),
      seconds: Number(node.dataset.waterTime),
    }));
    return { ...meta,pixels: await presentationPixels(surface) };
  };
  const before = await read();
  await page.getByRole('button',{ name: 'Animate water',exact: true }).click();
  await expect.poll(async () => Number(await surface.getAttribute('data-water-time'))).toBeGreaterThan(1.1);
  await page.getByRole('button',{ name: 'Pause water',exact: true }).click();
  const after = await read();
  let samples = 0, changed = 0, waveSamples = 0;
  for (let y = 2; y < before.height-2; y += 3) {
    for (let x = 2; x < before.width-2; x += 3) {
      const sum = (y+0.5-before.y-2.5)/0.425, difference = (x+0.5-before.x)/0.85;
      const point = { x: (sum+difference)/2,y: (sum-difference)/2 };
      if (point.x > -64 && point.y > -64 && point.x < Number(dimensions[1])+64 && point.y < Number(dimensions[2])+64) continue;
      // Avoid testing float roundoff exactly at a world pixel boundary.
      if ([point.x,point.y].some(value => Math.abs(value-Math.round(value)) < 0.0001)) continue;
      const start = reference.sample(point.x,point.y,0);
      const end = reference.sample(point.x,point.y,after.seconds);
      const i = (y*before.width+x)*4;
      for (let c = 0; c < 3; c++) {
        expect(Math.abs(before.pixels[i+c]-start[c])).toBeLessThanOrEqual(1);
        expect(Math.abs(after.pixels[i+c]-end[c])).toBeLessThanOrEqual(1);
      }
      if (start.some((value,c) => value !== end[c])) {
        waveSamples++;
        if (before.pixels.slice(i,i+3).some((value,c) => value !== after.pixels[i+c])) changed++;
      }
      samples++;
    }
  }
  expect(samples).toBeGreaterThan(1000);
  expect(waveSamples).toBeGreaterThan(10);
  expect(changed).toBeGreaterThan(10);
});
