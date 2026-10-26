import { expect, test } from '@playwright/test';

test('production home stays lightweight and every destination runs from a project subpath', async ({ page }) => {
  const errors: string[] = [];
  const failures: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => failures.push(request.url()));
  page.on('response', response => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  page.on('request', request => requests.push(request.url()));
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'a long table', exact: true })).toBeVisible();
  await page.evaluate(() => {
    for (const image of document.images) image.loading = 'eager';
  });
  await expect.poll(() => page.evaluate(
    () => [...document.images].every(image => image.complete && image.naturalWidth > 0),
  )).toBe(true);
  await expect(page.locator('canvas')).toHaveCount(0);
  expect(requests.some(url => /\/(phaser|world|reference-data|game-view)-[^/]+\.js/.test(url))).toBe(false);
  expect(await page.evaluate(() => Object.hasOwn(window, '__longTable'))).toBe(false);
  for (const mode of ['play', 'island', 'character', 'foraging', 'navigation']) {
    await page.goto(`./#/${mode}?paused=1`);
    await expect(page.locator('canvas')).toHaveCount(1);
    await expect(page.locator('.stage-loading')).toHaveCount(0);
    await expect(page.getByRole('alert')).toBeHidden();
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await page.getByRole('button', { name: 'Fit view', exact: true }).click();
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    await expect(page.locator('canvas')).toHaveCount(0);
  }
  const resources = requests.filter(url => /\.(?:js|css|png)(?:\?|$)/.test(url));
  expect(resources.every(url => new URL(url).pathname.startsWith('/a-long-table/'))).toBe(true);
  expect(failures).toEqual([]);
  expect(errors).toEqual([]);
});
