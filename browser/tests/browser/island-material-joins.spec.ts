import { expect, test } from '@playwright/test';
import type Phaser from 'phaser';
import { ISLAND_STEP_PALETTES } from '../../src/render/island-step-palette';
import '../../src/debug';

for (const seed of [0, 43, 902479]) {
  test(`seed ${seed}: sandy crossings stay connected to both landings after terrain compositing`, async ({ page }) => {
    await page.goto(`/?islandEmbed=v2#/island?seed=${seed}&paused=1`);
    await page.waitForFunction(() => window.__longTable?.ready === true);
    const crossings = await page.evaluate(() => {
      const { world, view } = window.__longTable!;
      const terrain = (view as unknown as {
        terrain: { texture: Phaser.Textures.CanvasTexture };
      }).terrain;
      const image = terrain.texture.context.getImageData(0, 0,
        terrain.texture.canvas.width, terrain.texture.canvas.height);
      return world.ramps!.map(ramp => {
        const samples: string[] = [];
        const length = (Math.abs(ramp.lowCell.x - ramp.highCell.x)
          + Math.abs(ramp.lowCell.y - ramp.highCell.y)) * world.tileSize;
        for (let distance = 0; distance <= length; distance++) {
          const x = (ramp.highCell.x + 0.5) * world.tileSize + ramp.direction.x * distance;
          const y = (ramp.highCell.y + 0.5) * world.tileSize + ramp.direction.y * distance;
          const i = ((y + 1) * image.width + x + 1) * 4;
          samples.push(`#${Array.from(image.data.subarray(i, i + 3))
            .map(channel => channel.toString(16).padStart(2, '0')).join('')}`);
        }
        return samples;
      });
    });
    expect(crossings.length).toBeGreaterThan(0);
    const sand = new Set<string>(['#c4b878', ...ISLAND_STEP_PALETTES.flatMap(palette => Object.values(palette))]);
    for (const crossing of crossings) {
      expect(crossing.length).toBeGreaterThan(8);
      for (const color of crossing) expect(sand.has(color), `Broken stair center: ${color}`).toBe(true);
    }
    await expect(page.getByRole('alert')).toBeHidden();
  });
}
