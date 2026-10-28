import { expect, test } from '@playwright/test';

for (const [id, title] of [
  ['character', 'Character Explorer'],
  ['foliage', 'Foliage Explorer'],
  ['island', 'Island Explorer'],
  ['navigation', 'Navigation Explorer'],
] as const) {
  test(`${title} opens as one complete family and returns Home`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/#/');
    await page.getByRole('navigation', { name: 'Explorers', exact: true })
      .getByRole('link', { name: new RegExp(title) }).click();
    await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('.pilot')).toHaveAttribute('data-route', id);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(page.locator('.p-stage canvas:visible').first()).toBeVisible();
    await expect(page.locator('.p-panel')).toHaveCount(1);
    await expect(page.locator('dialog')).toHaveCount(0);
    const project = page.getByRole('navigation', { name: 'Project', exact: true });
    await expect(project.getByRole('link')).toHaveCount(1);
    await project.getByRole('link', { name: 'Home', exact: true }).click();
    await expect(page.locator('.pilot')).toHaveAttribute('data-route', 'home');
    await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('main.pilot')).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}

for (const viewport of [{ width: 1440, height: 960 }, { width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  for (const route of ['character', 'foliage', 'navigation', 'island?version=v2']) {
    test(`${route} keeps its primary action and scroll area separate at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(`/#/${route}`);
      await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
      const primary = page.locator('.p-primary-controls').getByRole('button').first();
      await expect(primary).toBeVisible();
      const before = await primary.boundingBox();
      const stage = await page.locator('.p-stage').boundingBox();
      const panel = await page.locator('.p-panel').boundingBox();
      if (viewport.width > 700) expect(stage!.x + stage!.width).toBeLessThanOrEqual(panel!.x);
      else expect(stage!.y + stage!.height).toBeLessThanOrEqual(panel!.y);
      await page.locator('.p-panel-scroll').evaluate(node => { node.scrollTop = node.scrollHeight; });
      expect(await primary.boundingBox()).toEqual(before);
      await expect(primary).toBeInViewport();
      expect(await page.evaluate(() => ({
        horizontal: document.documentElement.scrollWidth > innerWidth,
        vertical: document.documentElement.scrollHeight > innerHeight,
        controls: [...document.querySelectorAll('.p-panel-scroll')].some(node => node.scrollWidth > node.clientWidth),
      }))).toEqual({ horizontal: false, vertical: false, controls: false });
    });
  }
}
