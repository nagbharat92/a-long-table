import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { affectedRoutes, startParallelPreview } from '../dev/parallel-preview/server.mjs';
import { scopes } from '../dev/parallel-preview/scopes.mjs';

let fixture;
let preview;
const updates = page => page.getByRole('complementary', { name: 'Development updates' });
test.beforeEach(async () => {
  fixture = fileURLToPath(new URL(`../.cache/preview-fixture-${randomUUID()}/`, import.meta.url));
  await mkdir(`${fixture}/src/pilot`, { recursive: true });
  await mkdir(`${fixture}/public`);
  await writeFile(`${fixture}/index.html`, '<html><body><h1></h1><input aria-label="Note"><script type="module" src="/main.js"></script></body></html>');
  await writeFile(`${fixture}/main.js`, `import './shared.css';
const route = location.hash.slice(2).split('?')[0];
const routes = { character: () => import('./src/pilot/character.ts'), foliage: () => import('./src/pilot/trees.ts') };
const feature = await routes[route]();
document.querySelector('h1').textContent = feature.label;
window.token = crypto.randomUUID();`);
  await writeFile(`${fixture}/shared.css`, 'body { color: black; }');
  await writeFile(`${fixture}/src/pilot/character.ts`, "export const label = 'Character one';");
  await writeFile(`${fixture}/src/pilot/trees.ts`, "export const label = 'Trees one';");
  preview = await startParallelPreview({ root: fixture, port: 0, scopes, configFile: false });
});
test.afterEach(async () => {
  if (preview) await preview.close();
  if (fixture) await rm(fixture, { recursive: true });
  preview = undefined;
  fixture = undefined;
});

test('pilot scopes classify private and shared source correctly', () => {
  expect(affectedRoutes(['src/pilot/character.ts'], scopes)).toEqual(['/character']);
  expect(affectedRoutes(['src/pilot/trees.css'], scopes)).toEqual(['/foliage', '/trees', '/foraging']);
  expect(affectedRoutes(['src/tree-source/core/tree-motion.ts'], scopes)).toEqual(['/foliage', '/trees', '/foraging']);
  expect(affectedRoutes(['src/character-family/core/character-species.ts'], scopes)).toEqual(['/character']);
  expect(affectedRoutes(['src/foliage-family/core/tree-motion.ts'], scopes)).toEqual(['/foliage', '/trees', '/foraging']);
  expect(affectedRoutes(['src/world-family/core/navigation.ts'], scopes)).toEqual(['/island', '/navigation']);
  expect(affectedRoutes(['src/pilot/home.ts'], scopes)).toEqual(['/', '/ui']);
  expect(affectedRoutes(['src/pilot/play.ts'], scopes)).toEqual(['/play']);
  expect(affectedRoutes(['src/pilot/pilot.css'], scopes)).toBeNull();
  expect(affectedRoutes(['src/pilot/ui.ts'], scopes)).toBeNull();
});

test('private edits hold both sessions and apply only to the chosen tab; shared CSS notifies both', async ({ page, context }) => {
  const trees = await context.newPage();
  await page.goto(`${preview.url}/#/character`);
  await trees.goto(`${preview.url}/#/foliage`);
  await expect(page.getByRole('heading')).toHaveText('Character one');
  await expect(trees.getByRole('heading')).toHaveText('Trees one');
  await expect(updates(page).locator('summary')).toHaveText('Updates held');
  await expect(updates(trees).locator('summary')).toHaveText('Updates held');
  await trees.getByLabel('Note').fill('Keep this tree session');
  const token = await trees.evaluate(() => window.token);
  await writeFile(`${fixture}/src/pilot/character.ts`, "export const label = 'Character two';");
  await expect(updates(page).locator('summary')).toHaveText('Update available');
  await expect(updates(trees).locator('summary')).toHaveText('Updates held');
  await expect(page.getByRole('heading')).toHaveText('Character one');
  await updates(page).getByRole('button', { name: 'Apply update' }).click();
  await expect(page.getByRole('heading')).toHaveText('Character two');
  expect(await trees.evaluate(() => window.token)).toBe(token);
  await expect(trees.getByLabel('Note')).toHaveValue('Keep this tree session');
  const characterToken = await page.evaluate(() => window.token);
  await page.getByLabel('Note').fill('Keep this character session');
  await writeFile(`${fixture}/src/pilot/trees.ts`, "export const label = 'Trees two';");
  await expect(updates(trees).locator('summary')).toHaveText('Update available');
  await expect(updates(page).locator('summary')).toHaveText('Updates held');
  await expect(trees.getByRole('heading')).toHaveText('Trees one');
  await updates(trees).getByRole('button', { name: 'Apply update' }).click();
  await expect(trees.getByRole('heading')).toHaveText('Trees two');
  expect(await page.evaluate(() => window.token)).toBe(characterToken);
  await expect(page.getByLabel('Note')).toHaveValue('Keep this character session');
  const nextTreeToken = await trees.evaluate(() => window.token);
  await writeFile(`${fixture}/shared.css`, 'body { color: navy; }');
  await expect(updates(page).locator('summary')).toHaveText('Update available');
  await expect(updates(trees).locator('summary')).toHaveText('Update available');
  expect(await trees.evaluate(() => window.token)).toBe(nextTreeToken);
});

test('a failed build leaves the last working preview and recovers after a correction', async ({ page }) => {
  await page.goto(`${preview.url}/#/character`);
  await expect(page.getByRole('heading')).toHaveText('Character one');
  await expect(updates(page).locator('summary')).toHaveText('Updates held');
  await writeFile(`${fixture}/src/pilot/character.ts`, 'export const label = ;');
  await expect(updates(page).locator('summary')).toHaveText('Preview build failed');
  await expect(page.getByRole('heading')).toHaveText('Character one');
  await expect(updates(page).getByRole('button', { name: 'Apply update' })).toBeDisabled();
  await writeFile(`${fixture}/src/pilot/character.ts`, "export const label = 'Recovered character';");
  await expect(updates(page).locator('summary')).toHaveText('Update available');
  await updates(page).getByRole('button', { name: 'Apply update' }).click();
  await expect(page.getByRole('heading')).toHaveText('Recovered character');
});
