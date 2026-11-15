import { describe, expect, it } from 'vitest';
import { generateIslandLandform } from './core/island-landform';
import { generateIslandWorld } from './core/world';
import type { LandTriangle } from './core/landform-study';
import { createIslandSurface } from './render/island-surface';
import { createIslandEnvironment } from './render/island-environment';
import { MATERIAL_COLORS } from './render/island-textures';
import { projectionWeights, sampleProjectedTexture, surfaceNormal } from './render/surface-projection';

const top: LandTriangle = {
  vertices: [{ x: 0, y: 0, z: 0 }, { x: 16, y: 0, z: 0 }, { x: 16, y: 16, z: 0 }],
  plane: 'top', level: 0,
};

describe('projected terrain materials and categorical masks', () => {
  it.each([12, 41, 71, 902479])('restores categorical ground regions and preserves sand for seed %i', seed => {
    const world = generateIslandWorld(seed), surface = createIslandSurface(world);
    const counts = new Map<string, number>();
    let pairs = 0, changes = 0;
    for (let y = 0; y < world.height * 4; y++) {
      for (let x = 0; x < world.width * 4; x++) {
        const index = Math.floor(y / 4) * world.width + Math.floor(x / 4);
        if (!world.cells[index]) continue;
        const kind = surface.material(x + 0.5, y + 0.5);
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
        const color = surface.regions(top, { x: x + 0.5, y: y + 0.5, z: 0 });
        expect(color).toEqual(MATERIAL_COLORS[kind]);
        const nextX = x + 1;
        if (nextX >= world.width * 4 || !world.cells[Math.floor(y / 4) * world.width + Math.floor(nextX / 4)]) continue;
        pairs++;
        if (surface.material(nextX + 0.5, y + 0.5) !== kind) changes++;
      }
    }
    for (const kind of ['turf', 'dry-sand', 'wet-sand']) expect(counts.get(kind)).toBeGreaterThan(100);
    expect((counts.get('meadow') ?? 0) + (counts.get('moss') ?? 0)).toBeGreaterThan(100);
    expect(counts.has('earth')).toBe(false);
    expect(changes / pairs).toBeGreaterThan(0);
    expect(changes / pairs).toBeLessThan(0.08);
    expect(() => surface.material(NaN, 0)).toThrow('finite');
  });

  it('uses the same unlit material color regardless of triangle winding, height or lighting', () => {
    const surface = createIslandSurface(generateIslandWorld(71));
    const opposite: LandTriangle = { ...top, vertices: [top.vertices[0], top.vertices[2], top.vertices[1]] };
    const point = { x: 256.5, y: 192.5, z: 0 };
    expect(surface.regions(top, point)).toEqual(surface.regions(opposite, { ...point, z: 48 }));
  });

  it('samples top, side and sloped textures with the same normal-driven projections as the checker', () => {
    const point = { x: 3, y: 7, z: 11 };
    const sample = (u: number, v: number) => [u, v, 0];
    expect(sampleProjectedTexture(point, [0, 0, 1], sample)).toEqual([3, 7, 0]);
    expect(sampleProjectedTexture(point, [1, 0, 0], sample)).toEqual([7, 11, 0]);
    expect(sampleProjectedTexture(point, [0, 1, 0], sample)).toEqual([3, 11, 0]);
    const slope: LandTriangle = {
      ...top, vertices: [{ x: 0, y: 0, z: 0 }, { x: 16, y: 0, z: 0 }, { x: 0, y: 16, z: 16 }],
    };
    expect(projectionWeights(surfaceNormal(slope))).toEqual([0, 0.5, 0.5]);
    expect(sampleProjectedTexture(point, projectionWeights(surfaceNormal(slope)), sample)).toEqual([3, 9, 0]);
  });

  it('shows only discrete material colors in both the elevation plan and 3D mask view', () => {
    const island = generateIslandLandform(71), environment = createIslandEnvironment(island);
    const colors = new Set(Object.values(MATERIAL_COLORS).map(color => color.join(',')));
    const viewport = { width: 640, height: 520, origin: { x: 280, y: 80 } };
    for (const projection of ['oblique', 'plan'] as const) {
      const frame = environment.render(projection, viewport, undefined, { regions: true });
      expect(frame.grassCount).toBe(0);
      let land = 0;
      for (let i = 0; i < frame.raster.levels.length; i++) {
        if (frame.raster.levels[i] < 0) continue;
        const color = Array.from(frame.raster.pixels.slice(i * 4, i * 4 + 3)).join(',');
        expect(colors.has(color)).toBe(true);
        land++;
      }
      expect(land).toBeGreaterThan(1000);
    }
  });

  it('keeps animated water, mesh depth and ordinary texturing independent of material-mask inspection', () => {
    const island = generateIslandLandform(71), before = structuredClone(island);
    const environment = createIslandEnvironment(island);
    const viewport = { width: 640, height: 520, origin: { x: 280, y: 80 } };
    const textured = environment.render('oblique', viewport);
    const masks = environment.render('oblique', viewport, undefined, { regions: true });
    expect(masks.raster.levels).toEqual(textured.raster.levels);
    const pixels = masks.raster.pixels.slice();
    masks.animate(2);
    expect(masks.raster.pixels.some((value, i) => value !== pixels[i])).toBe(true);
    for (let i = 0; i < masks.raster.levels.length; i++) {
      if (masks.raster.levels[i] < 0) continue;
      expect(masks.raster.pixels.slice(i * 4, i * 4 + 4)).toEqual(pixels.slice(i * 4, i * 4 + 4));
    }
    const restored = environment.render('oblique', viewport);
    expect(restored.raster.pixels.every((value, i) => value === textured.raster.pixels[i])).toBe(true);
    expect(island).toEqual(before);
  });
});
