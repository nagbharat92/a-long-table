import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 390, height: 844 }, { width: 780, height: 720 }, { width: 720, height: 480 }]) {
  for (const route of [
    'play?seed=42&paused=1',
    'character?colorSeed=42',
    'foliage?foliage=trees&treeSeed=9',
  ]) {
    test(`${route} keeps generation usable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(`/#/${route}`);
      await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
      const button = page.locator('.p-primary-controls').getByRole('button').first();
      const before = await button.boundingBox();
      const scene = await page.locator('.p-stage').boundingBox();
      const panel = await page.getByRole('complementary', { name: 'Study controls' }).boundingBox();
      expect(scene).not.toBeNull();
      if (viewport.width <= 700) expect(scene!.y + scene!.height).toBeLessThanOrEqual(panel!.y);
      else expect(scene!.x + scene!.width).toBeLessThanOrEqual(panel!.x);
      await expect.poll(() => page.locator('.p-stage canvas').evaluateAll(canvases => canvases.every(canvas => {
        const scene = canvas.closest('.p-stage')!.getBoundingClientRect();
        const rect = canvas.getBoundingClientRect();
        return rect.left >= scene.left && rect.right <= scene.right && rect.top >= scene.top && rect.bottom <= scene.bottom;
      }))).toBe(true);
      const scroll = page.getByRole('region', { name: 'Editing and tools' });
      await page.getByText('Preview settings', { exact: true }).click();
      await page.getByRole('button', { name: 'Line / outlined' }).click();
      await scroll.evaluate(node => { node.scrollTop = node.scrollHeight; });
      expect(await button.boundingBox()).toEqual(before);
      expect(before!.y + before!.height).toBeLessThanOrEqual(viewport.height);
      const layout = await page.evaluate(() => ({
        pageOverflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
        panelOverflow: [...document.querySelectorAll('.p-panel-scroll')].some(node => node.scrollWidth > node.clientWidth),
      }));
      expect(layout).toEqual({ pageOverflow: false, panelOverflow: false });
      await expect(page.locator('dialog')).toHaveCount(0);
    });
  }
}

test('panel keyboard navigation enters controls without hiding generation', async ({ page }) => {
  await page.goto('/#/character?colorSeed=42&tab=customization');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  const generate = page.getByRole('button', { name: 'Generate character', exact: true });
  await generate.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('region', { name: 'Editing and tools' })).toBeFocused();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.closest('.p-panel-scroll') !== null)).toBe(true);
  await page.getByText('Preview settings', { exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Ink / solid', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Line / outlined', exact: true })).toBeFocused();
  await expect(generate).toBeInViewport();
});
