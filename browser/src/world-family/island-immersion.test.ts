import { describe, expect, it } from 'vitest';
import { generateIslandLandform } from './core/island-landform';
import { projectLandVertex } from './core/landform-study';
import { createIslandEnvironment, waterWorldPoint, worldHeightFromDepth, ISLAND_WATER_HEIGHT } from './render/island-environment';
import { createIslandSurface } from './render/island-surface';
import { rasterLandform, type LandPalette } from './render/landform-study';
import { WATER_MAX_DEPTH } from './render/island-water-color';
import { projectedWaterColor } from './render/island-water-projection';
import { createWaterSurfaceResponse } from './render/island-water-surface';

describe('full ocean and depth-aware immersion', () => {
  it('keeps shelf markers in the water composite even exactly at the water plane', () => {
    const island = generateIslandLandform(77);
    island.triangles = [];
    island.beach.underwaterTriangles = [{
      vertices: [{ x: -16,y: -16,z: ISLAND_WATER_HEIGHT },{ x: 32,y: -16,z: ISLAND_WATER_HEIGHT },
        { x: -16,y: 32,z: ISLAND_WATER_HEIGHT }],
      plane: 'top',level: 0,submerged: true,
    }];
    const environment = createIslandEnvironment(island);
    const viewport = { width: 8,height: 8,origin: { x: 0,y: 0 } };
    const frame = environment.render('current',viewport);
    expect(frame.raster.submerged?.every(value => value === 1)).toBe(true);
    expect(frame.submergedPixels).toBe(64);
    expect(frame.waterMask.every(value => value === 1)).toBe(true);
    const inspection = environment.render('current',viewport,undefined,{ regions: true });
    expect(inspection.waterPixels).toBe(0);
  });

  it.each(['oblique', 'current', 'plan'] as const)('reconstructs actual terrain height from %s depth', projection => {
    for (const z of [-14, -4, -2.5, 0, 8, 24, 48]) {
      const point = projectLandVertex({ x: 137.25, y: 82.75, z }, projection);
      expect(worldHeightFromDepth(point.y, point.z, projection)).toBeCloseTo(z, 9);
    }
    expect(() => worldHeightFromDepth(0, Infinity, projection)).toThrow('finite');
  });

  it.each(['oblique', 'current'] as const)('renders coherent ocean throughout the %s raster, not just its shore band', projection => {
    const environment = createIslandEnvironment(generateIslandLandform(77));
    const viewport = { width: 1100, height: 800, origin: { x: 450, y: 200 } };
    const frame = environment.render(projection, viewport);
    const response = createWaterSurfaceResponse(environment.sun, projection);
    const indices = [0, viewport.width - 1, (viewport.height - 1) * viewport.width, viewport.width * viewport.height - 1];
    for (const seconds of [0, 2.5]) {
      frame.animate(seconds);
      for (const index of indices) {
        expect(frame.waterMask[index]).toBe(1);
        expect(frame.oceanOnlyMask[index]).toBe(1);
        const point = waterWorldPoint(index % viewport.width + 0.5 - viewport.origin.x,
          Math.floor(index / viewport.width) + 0.5 - viewport.origin.y, projection);
        const ocean = environment.ocean.prepare(new Float64Array([point.x, point.y]));
        const body = projectedWaterColor(WATER_MAX_DEPTH, environment.oceanBake.patches,
          point.x, point.y, seconds, environment.waterSettings, true);
        expect(Array.from(frame.raster.pixels.slice(index * 4, index * 4 + 3)))
          .toEqual(response(ocean.shade(0, body), point.x, point.y, seconds, 0, ocean.visibility[0] / 255));
      }
    }
    expect(frame.waterPixels).toBeGreaterThan(viewport.width * viewport.height / 2);
  });

  it('tints genuinely submerged sand and rock while protecting every exposed surface', () => {
    const island = generateIslandLandform(77), before = structuredClone(island);
    const environment = createIslandEnvironment(island);
    const viewport = { width: 820, height: 600, origin: { x: 350, y: 120 } };
    const frame = environment.render('oblique', viewport);
    const surface = createIslandSurface(island.world, undefined, island.ascents, island.edges, island.beach);
    const palette: LandPalette = {
      water: [0, 0, 0], top: [0, 0, 0], light: [0, 0, 0], middle: [0, 0, 0], dark: [0, 0, 0], levels: [],
    };
    const raw = rasterLandform('oblique', palette, [], {
      triangles: [...island.triangles, ...island.beach.underwaterTriangles], viewport, shade: surface.shade,
    });
    expect(frame.submergedPixels).toBeGreaterThan(100);
    let tintedSand = 0;
    for (let i = 0; i < frame.submergedMask.length; i++) {
      if (!frame.submergedMask[i]) continue;
      expect(frame.waterMask[i]).toBe(1);
      const z = worldHeightFromDepth(Math.floor(i / viewport.width) + 0.5 - viewport.origin.y, frame.raster.depth[i], 'oblique');
      if (raw.submerged?.[i]) expect(z).toBeLessThan(ISLAND_WATER_HEIGHT+1e-7);
      else expect(z).toBeLessThan(ISLAND_WATER_HEIGHT);
      if (raw.submerged?.[i] && frame.raster.pixels[i * 4 + 2] > raw.pixels[i * 4 + 2] + 10
        && frame.raster.pixels[i * 4] < raw.pixels[i * 4] - 5) tintedSand++;
    }
    expect(tintedSand).toBeGreaterThan(10);
    const pixels = frame.raster.pixels.slice();
    frame.animate(2.5);
    let changedWater = 0, changedExposed = 0;
    for (let i = 0; i < frame.waterMask.length; i++) {
      const changed = [0, 1, 2].some(channel => frame.raster.pixels[i * 4 + channel] !== pixels[i * 4 + channel]);
      if (changed && frame.waterMask[i]) changedWater++;
      if (changed && !frame.waterMask[i] && !frame.beachWashMask[i]) changedExposed++;
    }
    expect(changedWater).toBeGreaterThan(1000);
    expect(changedExposed).toBe(0);
    frame.animate(0);
    expect(frame.raster.pixels.every((value, i) => value === pixels[i])).toBe(true);
    expect(island).toEqual(before);
  });
});
