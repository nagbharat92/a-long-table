import { expect, test, type Page } from '@playwright/test';
import type Phaser from 'phaser';
import '../../src/debug';

async function state(page: Page) {
  return page.evaluate(() => {
    const runtime = window.__longTable!;
    const view = runtime.view as unknown as {
      terrain: { texture: Phaser.Textures.CanvasTexture; shorelineTexture?: Phaser.Textures.CanvasTexture };
    };
    return {
      water: view.terrain.shorelineTexture?.canvas.toDataURL(),
      land: view.terrain.texture.canvas.toDataURL(),
      elapsed: runtime.simulation.elapsed,
      world: JSON.stringify(runtime.world),
    };
  });
}

for (const seed of [0, 902479]) {
  test(`seed ${seed}: shoreline moves only water, freezes on Pause, restores Levels phase and resets without leaking textures`, async ({ page }) => {
    await page.goto(`/?islandEmbed=v2#/island?seed=${seed}&paused=1`);
    await page.waitForFunction(() => window.__longTable?.ready === true);
    const initial = await state(page);
    expect(initial.water).toBeTruthy();
    await page.waitForTimeout(300);
    expect(await state(page)).toEqual(initial);
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await page.waitForFunction(() => window.__longTable!.simulation.elapsed >= 2);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const moving = await state(page);
    expect(moving.water).not.toBe(initial.water);
    expect(moving.land).toBe(initial.land);
    expect(moving.world).toBe(initial.world);
    await page.waitForTimeout(300);
    expect(await state(page)).toEqual(moving);
    await page.getByRole('button', { name: 'Levels', exact: true }).click();
    expect((await state(page)).water).toBeUndefined();
    await page.getByRole('button', { name: 'Levels', exact: true }).click();
    expect(await state(page)).toEqual(moving);
    await page.getByRole('button', { name: 'Reset this explorer', exact: true }).click();
    expect(await state(page)).toEqual(initial);
    await page.getByRole('spinbutton', { name: 'Seed', exact: true }).fill('43');
    await page.getByRole('button', { name: 'Go', exact: true }).click();
    expect((await state(page)).water).not.toBe(initial.water);
    const textureCount = await page.evaluate(() => {
      const view = window.__longTable!.view as unknown as { scene: Phaser.Scene };
      return view.scene.textures.getTextureKeys().filter(key => key === 'shoreline').length;
    });
    expect(textureCount).toBe(1);
    await page.goto('/#/play?paused=1');
    await page.waitForFunction(() => window.__longTable?.ready === true && window.__longTable.mode === 'play');
    expect((await state(page)).water).toBeUndefined();
    await expect(page.getByRole('alert')).toBeHidden();
  });
}
