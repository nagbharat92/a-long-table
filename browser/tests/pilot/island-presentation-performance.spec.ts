import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    islandWork: { raster: number; uploads: number; uploadBytes: number; draws: number };
    islandFrames: { time: number; yaw: number; turning: string; gpu: boolean; cpu: boolean; clock: number }[];
  }
}

for (const seed of [12,153025,902479]) {
  test(`persistent presentation has no turn-boundary raster/upload work, seed ${seed}`, async ({ page },testInfo) => {
    await page.addInitScript(() => {
      window.islandWork = { raster: 0,uploads: 0,uploadBytes: 0,draws: 0 };
      for (const name of ['putImageData','createImageData'] as const) {
        const original = CanvasRenderingContext2D.prototype[name];
        Object.defineProperty(CanvasRenderingContext2D.prototype,name,{ value: function (this: CanvasRenderingContext2D,...args: unknown[]) {
          if (this.canvas.matches('[data-island-surface],.island-ocean-backdrop')) window.islandWork.raster++;
          return Reflect.apply(original,this,args);
        } });
      }
      for (const name of ['texImage2D','texSubImage2D','bufferData','bufferSubData'] as const) {
        const original = WebGLRenderingContext.prototype[name];
        Object.defineProperty(WebGLRenderingContext.prototype,name,{ value: function (...args: unknown[]) {
          window.islandWork.uploads++;
          window.islandWork.uploadBytes += args.reduce<number>((sum,arg) => sum+(ArrayBuffer.isView(arg) ? arg.byteLength : 0),0);
          return Reflect.apply(original,this,args);
        } });
      }
      const original = WebGLRenderingContext.prototype.drawArrays;
      WebGLRenderingContext.prototype.drawArrays = function (...args) {
        window.islandWork.draws++;
        return Reflect.apply(original,this,args);
      };
    });
    const loadStart = Date.now();
    await page.goto(`/#/island?version=v2&source=island&seed=${seed}&water=still&shadowQuality=512&layers=water:surfaceHighlights=1,waves=1,shoreFoam=1`);
    const surface = page.locator('[data-island-surface]');
    await expect(page.locator('.pilot')).toHaveAttribute('data-ready','true');
    await expect(surface).toHaveAttribute('data-presentation','webgl');
    const coldLoadMs = Date.now()-loadStart;
    const initial = await page.evaluate(() => ({ ...window.islandWork }));
    expect(initial.raster).toBe(0);
    const gpu = await page.locator('.island-orbit-canvas').elementHandle();
    await page.evaluate(() => {
      const cpu = document.querySelector<HTMLCanvasElement>('[data-island-surface]')!;
      const gpu = document.querySelector<HTMLCanvasElement>('.island-orbit-canvas')!;
      window.islandFrames = [];
      new MutationObserver(() => window.islandFrames.push({
        time: performance.now(),yaw: Number(cpu.dataset.yaw),turning: cpu.dataset.turning!,
        gpu: !gpu.hidden,cpu: getComputedStyle(cpu).visibility !== 'hidden',clock: Number(cpu.dataset.waterTime),
      })).observe(cpu,{ attributes: true,attributeFilter: ['data-yaw','data-turning'] });
    });
    const turns: { duration: number; maxGap: number; endpointGap: number; frames: number }[] = [];
    for (const view of [1,2,3,0]) {
      await page.evaluate(() => { window.islandFrames = []; });
      await page.getByRole('button',{ name: 'Rotate island right',exact: true }).click();
      await expect(surface).toHaveAttribute('data-turning','false');
      await expect(surface).toHaveAttribute('data-view',String(view));
      const samples = await page.evaluate(() => window.islandFrames);
      expect(samples.length).toBeGreaterThan(10);
      expect(samples.every(sample => sample.gpu && !sample.cpu)).toBe(true);
      const gaps = samples.slice(1).map((sample,i) => sample.time-samples[i].time);
      turns.push({ duration: samples.at(-1)!.time-samples[0].time,
        maxGap: Math.max(...gaps),endpointGap: gaps.at(-1)!,frames: samples.length });
      expect(await gpu!.evaluate(node => node === document.querySelector('.island-orbit-canvas') && !(node as HTMLCanvasElement).hidden)).toBe(true);
      const work = await page.evaluate(() => window.islandWork);
      expect(work.raster).toBe(0);
      expect(work.uploads).toBe(initial.uploads);
      expect(work.uploadBytes).toBe(initial.uploadBytes);
    }

    // Broad bounds detect a blocking endpoint rebuild, not an asserted device FPS.
    expect(turns.every(turn => turn.duration >= 475 && turn.duration < 1600)).toBe(true);
    for (const turn of turns) expect(turn.endpointGap).toBeLessThan(100);
    const report = { seed,coldLoadMs,turns,initial,environment: await page.evaluate(() => ({
      userAgent: navigator.userAgent,dpr: devicePixelRatio,viewport: [innerWidth,innerHeight],
      renderer: (() => { const gl = document.querySelector<HTMLCanvasElement>('.island-orbit-canvas')!.getContext('webgl')!;
        const debug = gl.getExtension('WEBGL_debug_renderer_info');
        return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) as string : 'not exposed'; })(),
    })) };
    console.info(`Island bounded browser measurement: ${JSON.stringify(report)}`);
    await testInfo.attach(`island-performance-${seed}`,{ body: JSON.stringify(report,null,2),contentType: 'application/json' });
    const pausedDraws = await page.evaluate(() => window.islandWork.draws);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.islandWork.draws)).toBe(pausedDraws);
    await page.getByRole('button',{ name: 'Animate water',exact: true }).click();
    await expect.poll(async () => Number(await surface.getAttribute('data-water-time'))).toBeGreaterThan(0.1);
    const clock = Number(await surface.getAttribute('data-water-time'));
    await page.evaluate(() => { window.islandFrames = []; });
    await page.getByRole('button',{ name: 'Rotate island right',exact: true }).click();
    await expect(surface).toHaveAttribute('data-turning','false');
    const movingClocks = await page.evaluate(() => window.islandFrames.filter(frame => frame.turning === 'true' && frame.yaw > 0 && frame.yaw < Math.PI/2).map(frame => frame.clock));
    expect(new Set(movingClocks).size).toBeGreaterThan(5);
    expect(Number(await surface.getAttribute('data-water-time'))).toBeGreaterThan(clock+0.3);
    await page.getByRole('button',{ name: 'Pause water',exact: true }).click();
    const stopped = await surface.getAttribute('data-water-time');
    await page.getByRole('button',{ name: 'Rotate island left',exact: true }).click();
    await expect(surface).toHaveAttribute('data-turning','false');
    expect(await surface.getAttribute('data-water-time')).toBe(stopped);
    expect((await page.evaluate(() => window.islandWork)).raster).toBe(0);
    expect((await page.evaluate(() => window.islandWork)).uploads).toBe(initial.uploads);
    await page.getByRole('button',{ name: 'Animate water',exact: true }).click();
    await page.evaluate(() => {
      Object.defineProperty(document,'hidden',{ configurable: true,value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const hiddenDraws = await page.evaluate(() => window.islandWork.draws);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.islandWork.draws)).toBe(hiddenDraws);
    await page.evaluate(() => {
      delete (document as unknown as { hidden?: boolean }).hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => page.evaluate(() => window.islandWork.draws)).toBeGreaterThan(hiddenDraws);
  });
}

test('normal surface motion is active, pauses without GPU work, and can be disabled through inspection', async ({ page }) => {
  await page.addInitScript(() => {
    window.islandWork = { raster: 0, uploads: 0, uploadBytes: 0, draws: 0 };
    const original = WebGLRenderingContext.prototype.drawArrays;
    WebGLRenderingContext.prototype.drawArrays = function (...args) {
      window.islandWork.draws++;
      return Reflect.apply(original, this, args);
    };
  });
  await page.goto('/#/island?seed=77&water=animated&shadowQuality=512');
  const surface = page.locator('[data-island-surface]');
  await expect(surface).toHaveAttribute('data-water-profile', 'terrain-depth');
  await expect(surface).toHaveAttribute('data-water-surface', 'normal-sky');
  await expect.poll(async () => Number(await surface.getAttribute('data-water-time'))).toBeGreaterThan(0.1);
  await page.getByRole('button', { name: 'Pause water', exact: true }).click();
  const clock = await surface.getAttribute('data-water-time');
  const before = await page.evaluate(() => window.islandWork.draws);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.islandWork.draws)).toBe(before);
  await expect(surface).toHaveAttribute('data-water-time', clock!);
  await page.getByRole('button', { name: 'Rotate island right', exact: true }).click();
  await expect(surface).toHaveAttribute('data-turning', 'false');
  await expect(surface).toHaveAttribute('data-water-time', clock!);
  await page.goto('/#/island?seed=77&water=animated&shadowQuality=512&layers=water:surfaceResponse=0,shoreFoam=0,colorPatches=0');
  await expect(surface).toHaveAttribute('data-water-surface', 'flat');
  await expect(page.getByRole('button', { name: 'Water motion off', exact: true })).toBeDisabled();
  const disabledDraws = await page.evaluate(() => window.islandWork.draws);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.islandWork.draws)).toBe(disabledDraws);
  await expect(surface).toHaveAttribute('data-water-time', '0.000');
});
