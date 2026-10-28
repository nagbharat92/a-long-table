import { expect, test } from '@playwright/test';

test('favicon uses only the rabbit head without distorting its pixels', async ({ page }) => {
  await page.goto('./');
  const icon = page.locator('link[rel="icon"]');
  await expect(icon).toHaveAttribute('sizes', '64x64');
  const result = await icon.evaluate(async element => {
    if (!(element instanceof HTMLLinkElement)) throw new Error('Favicon link is missing');
    const head = new Image();
    head.src = element.href;
    const rabbit = new Image();
    rabbit.src = new URL('rabbit.png', element.href).href;
    await Promise.all([head.decode(), rabbit.decode()]);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas context is unavailable');
    context.imageSmoothingEnabled = false;
    context.drawImage(rabbit, 0, 0, 18, 19, 5, 3, 54, 57);
    const expected = context.getImageData(0, 0, 64, 64).data;
    context.clearRect(0, 0, 64, 64);
    context.drawImage(head, 0, 0);
    const actual = context.getImageData(0, 0, 64, 64).data;
    return {
      size: [head.naturalWidth, head.naturalHeight],
      matchesCrop: actual.every((value, index) => value === expected[index]),
    };
  });
  expect(result).toEqual({ size: [64, 64], matchesCrop: true });
});

test('production Home and every explorer family run from a project subpath', async ({ page }) => {
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
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.p-stage canvas')).toBeVisible();
  await expect(page.locator('aside[data-parallel-preview]')).toHaveCount(0);
  expect(await page.evaluate(() => Object.hasOwn(window, '__longTable'))).toBe(false);
  for (const mode of ['play', 'island', 'character', 'foliage', 'navigation', 'ui']) {
    await page.goto(`./#/${mode}?paused=1`);
    await expect(page.locator('.pilot')).toHaveAttribute('data-route', mode);
    await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('.p-stage canvas:visible').first()).toBeVisible();
    await expect(page.getByRole('alert')).toBeHidden();
    await page.getByRole('navigation', { name: 'Project', exact: true })
      .getByRole('link', { name: 'Home', exact: true }).click();
    await expect(page.locator('.pilot')).toHaveAttribute('data-route', 'home');
    await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  }
  await page.goto('./#/foraging');
  await expect(page.locator('.pilot')).toHaveAttribute('data-route', 'foliage');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  expect(await page.evaluate(() => Object.hasOwn(window, '__longTable'))).toBe(false);
  const resources = requests.filter(url => /\.(?:js|css|png)(?:\?|$)/.test(url));
  expect(resources.every(url => new URL(url).pathname.startsWith('/a-long-table/'))).toBe(true);
  expect(failures).toEqual([]);
  expect(errors).toEqual([]);
});
