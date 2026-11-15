import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { build } from 'vite';
import type {} from './fixtures/island-detail';

let fixtureCode: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false,publicDir: false,logLevel: 'error',
    build: { write: false,minify: false,lib: { entry: resolve('tests/pilot/fixtures/island-detail.ts'),formats: ['es'] } },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const chunk = outputs.flatMap(output => 'output' in output ? output.output : []).find(item => item.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Could not bundle the production renderer detail fixture.');
  fixtureCode = chunk.code;
});

async function load(page: Page) {
  await page.route('**/__island-detail-fixture.js',route => route.fulfill({ contentType: 'text/javascript',body: fixtureCode }));
  await page.goto('/#/');
  await page.addScriptTag({ type: 'module',url: '/__island-detail-fixture.js' });
}

for (const projection of ['oblique','current'] as const) {
  test(`grass is absent throughout ${projection} rotation, including behind occluders`,async ({ page }) => {
    await load(page);
    const visible = await page.evaluate(projection => window.islandDetailFixture.grass(projection),projection);
    expect(visible.tufts).toBe(0);
    expect(visible.counts.every(count => count === 0)).toBe(true);
    const hidden = await page.evaluate(projection => window.islandDetailFixture.grass(projection,true),projection);
    expect(hidden.tufts).toBe(visible.tufts);
    expect(hidden.counts.every(count => count === 0)).toBe(true);
  });
}

test('bounded minification reduces coverage error without changing unminified texture pixels',async ({ browser }) => {
  const context = await browser.newContext(), filtered = await context.newPage(), nearest = await context.newPage();
  await nearest.addInitScript(() => {
    const extension = WebGLRenderingContext.prototype.getExtension;
    Object.defineProperty(WebGLRenderingContext.prototype,'getExtension',{ value: function (this: WebGLRenderingContext,name: string) {
      return name === 'OES_standard_derivatives' ? null : Reflect.apply(extension,this,[name]);
    } });
  });
  try {
    await load(filtered);
    await load(nearest);
    const reference = await nearest.evaluate(() => window.islandDetailFixture.texture('oblique'));
    const actual = await filtered.evaluate(() => window.islandDetailFixture.texture('oblique'));
    for (let i = 0; i < actual.length; i++) {
      expect(actual[i].filter).toBe('bounded-minification');
      expect(reference[i].filter).toBe('nearest');
      expect(actual[i].samples).toBeGreaterThan(1000);
      expect(actual[i].error).toBeLessThan(reference[i].error*0.5);
    }
    for (const page of [filtered,nearest]) {
      const unminified = await page.evaluate(() => window.islandDetailFixture.texture('current'));
      expect(unminified[0].samples).toBeGreaterThan(1000);
      expect(unminified[0].error).toBe(0);
    }
  } finally { await context.close(); }
});

test('minification cannot mix contrasting atlas faces',async ({ page }) => {
  await load(page);
  const result = await page.evaluate(() => window.islandDetailFixture.bounds());
  expect(result.red).toBeGreaterThan(1000);
  expect(result.blue).toBeGreaterThan(1000);
  expect(result.mixed).toBe(0);
});
