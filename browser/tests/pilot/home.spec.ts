import { expect, test } from '@playwright/test';

test('Home is the entry point, with gameplay separate from complete explorer families', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.pilot')).toHaveAttribute('data-route', 'home');
  await expect(page.getByRole('heading', { name: 'a long table', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Play', exact: true })).toHaveAttribute('href', '#/play?seed=42');
  const directory = page.getByRole('navigation', { name: 'Explorers', exact: true });
  await expect(directory.getByRole('link')).toHaveCount(4);
  for (const [title, route] of [
    ['Character Explorer', 'character'], ['Foliage Explorer', 'foliage'],
    ['Island Explorer', 'island'], ['Navigation Explorer', 'navigation'],
  ]) {
    await expect(directory.getByRole('link', { name: new RegExp(title) })).toHaveAttribute('href', `#/${route}`);
  }
  await expect(directory.getByRole('link', { name: 'Trees', exact: true })).toHaveCount(0);
  await expect(directory.getByRole('link', { name: 'Play', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Development', exact: true })).toBeVisible();
  await expect(page.locator('.p-stage canvas')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Home keeps Play pinned while its directory scrolls, at desktop and narrow widths', async ({ page }) => {
  for (const viewport of [{ width: 1440, height: 960 }, { width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/#/');
    await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
    const play = page.getByRole('link', { name: 'Play', exact: true });
    const before = await play.boundingBox();
    const stage = await page.locator('.p-stage').boundingBox();
    const panel = await page.locator('.p-panel').boundingBox();
    if (viewport.width > 700) expect(stage!.x + stage!.width).toBeLessThanOrEqual(panel!.x);
    else expect(stage!.y + stage!.height).toBeLessThanOrEqual(panel!.y);
    await page.locator('.p-panel-scroll').evaluate(node => { node.scrollTop = node.scrollHeight; });
    expect(await play.boundingBox()).toEqual(before);
    await expect(play).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('the explorer entry path returns Home without global experience tabs', async ({ page }) => {
  await page.goto('/#/');
  await page.getByRole('navigation', { name: 'Explorers', exact: true }).getByRole('link', { name: /Character Explorer/ }).click();
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.pilot')).toHaveAttribute('data-route', 'character');
  const project = page.getByRole('navigation', { name: 'Project', exact: true });
  await expect(project.getByRole('link')).toHaveCount(1);
  await project.getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page.locator('.pilot')).toHaveAttribute('data-route', 'home');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
});

test('unknown explorers show a recoverable error rather than silently opening Play', async ({ page }) => {
  await page.goto('/#/missing');
  await expect(page.getByRole('alert')).toContainText('That explorer does not exist');
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page.locator('.pilot')).toHaveAttribute('data-route', 'home');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
});

test('UI Explorer uses the real shared controls, with functional scene toggles and sample data', async ({ page }) => {
  await page.goto('/#/ui');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: 'Levels', exact: true }).click();
  await page.getByRole('button', { name: 'Paused', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Levels', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const count = page.getByRole('slider', { name: 'Sample count', exact: true });
  await count.fill('12');
  await expect(page.getByText('Sample berries 12', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Foundations', exact: true }).click();
  await expect(page.getByText('--game-active', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Layout', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Composition', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Controls', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Paused', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const before = await page.evaluate(() => window.__pilot!.snapshot() as { seed: number });
  await page.getByRole('button', { name: 'Generate island', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__pilot!.snapshot() as { seed: number })).not.toEqual(before);
});
