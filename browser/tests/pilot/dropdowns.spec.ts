import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
  for (const route of ['character?tab=motion', 'island?version=v1', 'island?version=v2', 'navigation']) {
    test(`${route} dropdowns reserve room for inset chevrons at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(`/#/${route}`);
      await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
      const dropdowns = page.locator('select:not([multiple]):not([size]), select[size="1"]:not([multiple])');
      expect(await dropdowns.count()).toBeGreaterThan(0);
      for (const dropdown of await dropdowns.all()) {
        await expect(dropdown).toHaveCSS('appearance', 'none');
        await expect(dropdown).toHaveCSS('padding-right', '40px');
        await expect(dropdown).toHaveCSS('background-position', 'calc(100% - 12px) 50%');
        await expect(dropdown).toHaveCSS('background-size', '16px 16px');
        await expect(dropdown).toHaveCSS('background-repeat', 'no-repeat');
        expect(await dropdown.evaluate(node => getComputedStyle(node).backgroundImage)).toContain('data:image/svg+xml');
      }
      expect(await page.locator('.p-panel-scroll').evaluate(node => node.scrollWidth > node.clientWidth)).toBe(false);
    });
  }
}

test('Island version keeps native selection and keyboard focus', async ({ page }) => {
  await page.goto('/#/island?version=v1');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  const version = page.getByRole('combobox', { name: 'Island version', exact: true });
  await version.focus();
  await expect(version).toBeFocused();
  await expect(version).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Levels', exact: true })).toBeFocused();
  await version.selectOption('v2');
  await expect(page).toHaveURL(/version=v2/);
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
});

test('forced colors restores the system dropdown arrow', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/#/island?version=v1');
  await expect(page.locator('.pilot')).toHaveAttribute('data-ready', 'true');
  const version = page.getByRole('combobox', { name: 'Island version', exact: true });
  await expect(version).toHaveCSS('appearance', 'auto');
  await expect(version).toHaveCSS('background-image', 'none');
});
