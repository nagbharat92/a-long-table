import { expect, test } from '@playwright/test';
import { presentationPixels } from './island-presentation';

for (const seed of [12, 153025, 71]) {
test(`GPU terrain and procedural coastal colors retain the software reference on seed ${seed}`,async ({ browser },testInfo) => {
  const context = await browser.newContext({ viewport: { width: 1440,height: 960 } });
  const gpuPage = await context.newPage(), cpuPage = await context.newPage();
  await cpuPage.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype,'getContext',{ value: function (this: HTMLCanvasElement,type: string,...args: unknown[]) {
      return type.includes('webgl') ? null : Reflect.apply(original,this,[type,...args]);
    } });
  });
  try {
      const url = `http://127.0.0.1:5186/#/island?version=v2&source=island&seed=${seed}&water=still&shadowQuality=512&sunElevation=25`;
      await gpuPage.goto(url);
      await cpuPage.goto(url);
      for (const page of [gpuPage,cpuPage]) await expect(page.locator('.pilot')).toHaveAttribute('data-ready','true');
      const gpu = gpuPage.locator('.island-orbit-canvas'), cpu = cpuPage.locator('[data-island-surface]');
      await expect(gpu).toBeVisible();
      await expect(cpu).toBeVisible();
      const gpuPixels = await presentationPixels(gpuPage.locator('[data-island-surface]'));
      const cpuPixels = await presentationPixels(cpu);
      const placement = await gpuPage.locator('[data-island-surface]').evaluate((node: HTMLCanvasElement) => {
        const gpu = document.querySelector<HTMLCanvasElement>('.island-orbit-canvas')!;
        const a = node.getBoundingClientRect(), b = gpu.getBoundingClientRect(), scale = Number(node.dataset.magnification);
        return { width: gpu.width,height: gpu.height,offsetX: (a.left-b.left)/scale,offsetY: (a.top-b.top)/scale };
      });
      const dimensions = await cpu.evaluate((node: HTMLCanvasElement) => ({ width: node.width,height: node.height,grass: node.dataset.grassCount }));
      expect(await gpu.getAttribute('data-grass-count')).toBe(dimensions.grass);
      const counts = { land: 0,coast: 0,landMatched: 0,coastMatched: 0 };
      for (let y = 2; y < dimensions.height-2; y += 2) {
        for (let x = 2; x < dimensions.width-2; x += 2) {
          const i = (y*dimensions.width+x)*4;
          if (cpuPixels[i+3] !== 255) continue;
          const coast = cpuPixels[i+2] > cpuPixels[i] && cpuPixels[i+2] > cpuPixels[i+1]-35;
          const category = coast ? 'coast' : 'land';
          counts[category]++;
          const gx = Math.floor(x+0.5+placement.offsetX), gy = Math.floor(y+0.5+placement.offsetY);
          let difference = Infinity;
          // Raster edge rules and fractional-grid origins differ by at most a
          // source pixel; compare nearby actual colors, not a rescaled image.
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const j = ((gy+dy)*placement.width+gx+dx)*4;
            difference = Math.min(difference,Math.max(...[0,1,2].map(c => Math.abs(cpuPixels[i+c]-gpuPixels[j+c]))));
          }
          if (difference <= 16) counts[coast ? 'coastMatched' : 'landMatched']++;
        }
      }
      console.info(`Island CPU/GPU art reference seed ${seed}, procedural coast: ${JSON.stringify(counts)}`);
      expect(counts.land).toBeGreaterThan(1000);
      expect(counts.coast).toBeGreaterThan(100);
      expect(counts.landMatched/counts.land).toBeGreaterThan(0.94);
      expect(counts.coastMatched/counts.coast).toBeGreaterThan(0.90);
      for (const [label,page] of [['gpu',gpuPage],['cpu-reference',cpuPage]] as const) {
        const path = testInfo.outputPath(`island-${label}-${seed}-procedural.png`);
        await page.locator('.island-ocean-scene').screenshot({ path });
        await testInfo.attach(`island-${label}-${seed}-procedural`,{ path,contentType: 'image/png' });
      }
  } finally { await context.close(); }
});
}
