import { expect, test } from '@playwright/test';
import { presentationPixels } from './island-presentation';

declare global {
  interface Window {
    coastalFieldUploads: number;
  }
}

test('coastal data survives pan, zoom, resize and projection changes without refitting or uploading',async ({ page }) => {
  await page.addInitScript(() => {
    window.coastalFieldUploads = 0;
    const upload = WebGLRenderingContext.prototype.texImage2D;
    Object.defineProperty(WebGLRenderingContext.prototype,'texImage2D',{ value: function (this: WebGLRenderingContext,...args: unknown[]) {
      if (args[3] === 1024 && args[4] === 1024 && ArrayBuffer.isView(args[8])) window.coastalFieldUploads++;
      return Reflect.apply(upload,this,args);
    } });
  });
  await page.goto('/#/island?version=v2&source=island&seed=153025&water=still');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready','true');
  const surface = page.locator('[data-island-surface]');
  const original = await surface.evaluate(node => ({
    seed: node.dataset.seed,triangles: node.dataset.triangles,grass: node.dataset.grassCount,
  }));
  expect(await page.evaluate(() => window.coastalFieldUploads)).toBe(3);
  for (let i = 0; i < 2; i++) await page.getByRole('button',{ name: 'Zoom in',exact: true }).click();
  await page.locator('.landform-canvas-frame').evaluate(node => {
    node.scrollLeft += 80;
    node.scrollTop += 60;
    node.dispatchEvent(new Event('scroll'));
  });
  await page.setViewportSize({ width: 1200,height: 800 });
  await page.getByRole('button',{ name: 'Fit',exact: true }).click();
  for (const name of ['Current axes','Elevation plan','Elevated oblique']) {
    await page.getByRole('button',{ name,exact: true }).click();
  }
  await expect(surface).toHaveAttribute('data-presentation','webgl');
  expect(await page.evaluate(() => window.coastalFieldUploads)).toBe(3);
  expect(await surface.evaluate(node => ({
    seed: node.dataset.seed,triangles: node.dataset.triangles,grass: node.dataset.grassCount,
  }))).toEqual(original);
  await page.getByRole('slider',{ name: 'Sun elevation',exact: true }).focus();
  await page.keyboard.press('Home');
  await expect.poll(() => page.evaluate(() => window.coastalFieldUploads)).toBe(6);
  await page.getByRole('button',{ name: 'Rotate island right',exact: true }).click();
  await expect(surface).toHaveAttribute('data-turning','false');
  expect(await page.evaluate(() => window.coastalFieldUploads)).toBe(6);
});

test('the GPU never classifies a submerged shelf as exposed inside the waterline tolerance',async ({ page }) => {
  await page.addInitScript(() => {
    const source = WebGLRenderingContext.prototype.shaderSource;
    WebGLRenderingContext.prototype.shaderSource = function (shader,text) {
      if (text.includes('uniform sampler2D u_scene;')) {
        // Exercise the real composite branch with a shelf just below the water plane.
        // Tiny nonzero dependencies keep the production uniform bindings active.
        text = text.replace('vec4 land = texture2D(u_scene,v_uv);',
          'vec4 land = texture2D(u_scene,v_uv); land.a = 128.0/255.0+land.a*0.000001;');
        text = text.replace(/float z = [^\n]+;/,
          '$& z = u_waterHeight-0.005+z*0.00000001;');
        text = text.replace('gl_FragColor = vec4(land.rgb,1.0);',
          'gl_FragColor = vec4(vec3(1.0,0.0,1.0)+land.rgb*0.000001,1.0);');
      }
      return source.call(this,shader,text);
    };
  });
  await page.goto('/#/island?version=v2&source=island&seed=153025&water=still');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready','true');
  const surface = page.locator('[data-island-surface]');
  await expect(surface).toHaveAttribute('data-presentation','webgl');
  const pixels = await presentationPixels(surface);
  let exposed = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] === 255 && pixels[i+1] === 0 && pixels[i+2] === 255) exposed++;
  }
  expect(pixels.length).toBeGreaterThan(10000);
  expect(exposed).toBe(0);
});
