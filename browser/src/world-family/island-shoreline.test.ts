import { describe, expect, it } from 'vitest';
import type { World } from './core/contracts';
import { generateIslandLandform } from './core/island-landform';
import { createIslandShoreField, type IslandShoreSample } from './render/island-shore-field';
import { ISLAND_SEA, rockContactFoam, shadeShoreWater } from './render/island-shore-water';
import { createIslandEnvironment, waterWorldPoint, worldHeightFromDepth } from './render/island-environment';
import { BEACH_WASH_MAX_HEIGHT, BEACH_WASH_PERIOD, BEACH_WASH_REACH } from './render/island-beach-wash';
import { ISLAND_WATER_HEIGHT } from './core/island-water-level';
import { createIslandSurface } from './render/island-surface';
import { waterBodyColor, WATER_MAX_DEPTH } from './render/island-water-color';
import { createDefaultLayersInspection } from './render/landform-diagnostics';

const sample = (distance: number, beach = true): IslandShoreSample => ({
  distance, beachDistance: beach ? distance : 40, cliffDistance: beach ? 40 : distance,
  beachWeight: Number(beach), kind: beach ? 'beach' : 'cliff',
  variation: 0, breakup: 0.5, phase: 0.25, wetWidth: 2.2, shallowWidth: beach ? 12 : 4,
});
const brightness = (color: readonly number[]) => color.reduce((sum, value) => sum + value, 0);

function sandWorld(): World {
  const width = 24, height = 16, cells = new Uint8Array(width * height), heights = new Float32Array(width * height).fill(-0.2);
  for (let y = 3; y < 13; y++) for (let x = 4; x < 20; x++) {
    const index = y * width + x;
    cells[index] = 1;
    heights[index] = 0.012;
  }
  return {
    width, height, cells, heights, tileSize: 4, seaLevel: 0, seed: 71,
    generatorVersion: 'shore-fixture', provenance: 'test-fixture',
    elevations: new Uint8Array(cells.length), rampIds: new Int32Array(cells.length).fill(-1), ramps: [],
  };
}

describe('beach-aware shoreline presentation', () => {
  it('uses lighter shallow water at beaches and restrained darker contact at cliffs', () => {
    const beach = shadeShoreWater(sample(0.6), 0, 0, ISLAND_SEA, [0, 0, 0], { depth: 0.75 }).color;
    const cliff = shadeShoreWater(sample(0.6, false), 0).color;
    expect(brightness(beach)).toBeGreaterThan(brightness(cliff) + 60);
    expect(brightness(cliff)).toBeLessThan(brightness(waterBodyColor(ISLAND_SEA, WATER_MAX_DEPTH)));
    expect(shadeShoreWater(sample(20), 0).color).toEqual(ISLAND_SEA);
    expect(shadeShoreWater(sample(128), 0).color).toEqual(ISLAND_SEA);
    expect(shadeShoreWater(sample(128, false), 2).color).toEqual(ISLAND_SEA);
    expect(shadeShoreWater(sample(-1), 2).foam).toBe(0);
    expect(() => shadeShoreWater(sample(2), NaN)).toThrow('finite');
  });

  it('leaves persistent broken beach foam but never gives cliffs a beach-style crest', () => {
    const beach = sample(2.5), cliff = sample(2.5, false);
    let active = 0;
    for (let i = 0; i < 103; i++) {
      const seconds = i / 102 * BEACH_WASH_PERIOD * 2;
      if (shadeShoreWater(beach, seconds, 0, ISLAND_SEA, [0, 0, 0], { shoreFoam: true }).foam > 0) active++;
      expect(shadeShoreWater(cliff, seconds).foam).toBe(0);
      expect(shadeShoreWater({ ...beach, beachWeight: 0.5 }, seconds).foam).toBe(0);
    }
    expect(active).toBeGreaterThan(50);
    expect(active).toBeLessThan(80);
    expect(shadeShoreWater(beach, 1.5, 0, ISLAND_SEA, [0, 0, 0], { shoreFoam: true }).foam)
      .toBeCloseTo(shadeShoreWater(beach, 1.5 + BEACH_WASH_PERIOD, 0, ISLAND_SEA, [0, 0, 0], { shoreFoam: true }).foam, 12);
  });

  it('adds only a narrow, weak, broken water-side rock contact, with no cliff run-up', () => {
    let active = 0, quiet = 0;
    for (let seconds = 0; seconds < 8; seconds += 0.05) {
      for (const distance of [-1, 0, 0.1, 0.4, 1, 1.79, 1.8, 3, 30]) {
        const foam = rockContactFoam(distance, 0, 0.3, seconds);
        expect(foam).toBeGreaterThanOrEqual(0);
        expect(foam).toBeLessThanOrEqual(0.14);
        if (distance <= 0 || distance >= 1.8) expect(foam).toBe(0);
        expect(rockContactFoam(distance, 0.6, 0.3, seconds)).toBe(0);
        expect(rockContactFoam(distance, 0, -0.3, seconds)).toBe(0);
      }
      const result = shadeShoreWater({ ...sample(0.4, false), breakup: 0.3 }, seconds,
        0, ISLAND_SEA, [0, 0, 0], { rockContact: true, shoreFoam: true });
      expect(result).toMatchObject({ height: ISLAND_WATER_HEIGHT, wash: 0, wetness: 0 });
      if (result.foam > 0.01) active++;
      else quiet++;
    }
    expect(active).toBeGreaterThan(20);
    expect(quiet).toBeGreaterThan(20);
    expect(rockContactFoam(0.4, 0, 0.3, 1.25 + 2560)).toBeCloseTo(rockContactFoam(0.4, 0, 0.3, 1.25), 10);
    expect(rockContactFoam(0.4, 0.59999, 0.3, 1.25)).toBeLessThan(1e-8);
    expect(() => rockContactFoam(NaN, 0, 0, 0)).toThrow('finite');
    expect(() => rockContactFoam(0.4, 0, 0, Infinity)).toThrow('finite');
  });

  it('wets only the narrow coastal sand strip and leaves low inland sand and ramp surfaces dry', () => {
    const world = sandWorld(), before = structuredClone(world);
    const field = createIslandShoreField(world), surface = createIslandSurface(world, field);
    expect(surface.material(16.5, 32.5)).toBe('wet-sand');
    expect(surface.material(31.5, 32.5)).toBe('dry-sand');
    for (let x = 16; x < 40; x++) {
      const coast = field.sample(x + 0.5, 32.5);
      if (surface.material(x + 0.5, 32.5) === 'wet-sand') {
        expect(-coast.distance).toBeLessThanOrEqual(coast.wetWidth);
        expect(coast.kind).toBe('beach');
      }
    }
    expect(world).toEqual(before);
    const raised = structuredClone(world);
    raised.elevations![8 * world.width + 4] = 1;
    expect(createIslandSurface(raised).material(16.5, 32.5)).toBe('dry-sand');
    const island = generateIslandLandform(91), ascent = island.ascents.find(ascent => ascent.kind !== 'gully')!;
    const center = {
      x: ascent.origin.x + ascent.direction.x * ascent.length / 2,
      y: ascent.origin.y + ascent.direction.y * ascent.length / 2,
    };
    expect(createIslandSurface(island.world, undefined, island.ascents).material(center.x, center.y)).toBe('dry-sand');
  });

  it.each([12, 41, 71, 902479])('keeps foam on eligible coastal water and preserves the complete island for seed %i', seed => {
    const island = generateIslandLandform(seed), before = structuredClone(island);
    const shore = createIslandShoreField(island.world), environment = createIslandEnvironment(island);
    const viewport = { width: 820, height: 600, origin: { x: 350, y: 120 } };
    for (const projection of ['oblique', 'current'] as const) {
      const layers = createDefaultLayersInspection();
      layers.water.shoreFoam = true;
      const frame = environment.render(projection, viewport, undefined, { layers });
      const original = frame.raster.pixels.slice();
      expect(frame.beachWaterPixels).toBeGreaterThan(0);
      expect(frame.cliffWaterPixels).toBeGreaterThan(0);
      let totalFoam = 0;
      for (const seconds of [0, 1.6, 3.2, 4.8]) {
        frame.animate(seconds);
        let foam = 0, changedSolid = 0;
        for (let i = 0; i < frame.foamMask.length; i++) {
          if (!frame.waterMask[i] && !frame.beachWashMask[i]) {
            if ([0, 1, 2, 3].some(channel => frame.raster.pixels[i * 4 + channel] !== original[i * 4 + channel])) changedSolid++;
          }
          if (!frame.foamMask[i]) continue;
          foam++;
          expect(frame.waterMask[i] || frame.beachWashMask[i]).toBe(1);
          const sy = Math.floor(i / viewport.width) + 0.5 - viewport.origin.y;
          const ground = frame.beachWashMask[i]
            ? worldHeightFromDepth(sy, frame.raster.depth[i], projection) : ISLAND_WATER_HEIGHT;
          const z = frame.shoreWaveMask[i] ? frame.shoreWaveHeights[i] : ground;
          const point = waterWorldPoint(i % viewport.width + 0.5 - viewport.origin.x,
            sy + z - ISLAND_WATER_HEIGHT, projection);
          const coast = shore.sample(point.x, point.y);
          expect(coast.distance).toBeGreaterThan(-BEACH_WASH_REACH);
          if (frame.beachWashMask[i]) expect(ground).toBeLessThanOrEqual(BEACH_WASH_MAX_HEIGHT + 1e-6);
          if (coast.beachWeight <= 0.6) {
            expect(frame.waterMask[i]).toBe(1);
            expect(frame.beachWashMask[i]).toBe(0);
            expect(coast.distance).toBeGreaterThan(0);
            expect(coast.distance).toBeLessThan(1.8);
          } else {
            expect(coast.kind).toBe('beach');
          }
        }
        expect(frame.foamPixels).toBe(foam);
        expect(changedSolid).toBe(0);
        totalFoam += foam;
      }
      expect(totalFoam).toBeGreaterThan(0);
      frame.animate(0);
      expect(frame.raster.pixels.every((value, i) => value === original[i])).toBe(true);
    }
    expect(island).toEqual(before);
  });

  it('washes low sand and restores it on retreat without altering offshore water or higher terrain', () => {
    const island = generateIslandLandform(153025), before = structuredClone(island);
    const environment = createIslandEnvironment(island);
    const layers = createDefaultLayersInspection();
    layers.water.shoreFoam = false;
    const viewport = { width: 820, height: 600, origin: { x: 350, y: 120 } };
    const dry = environment.render('oblique', viewport, undefined, { layers });
    const wash = environment.render('oblique', viewport);
    const depths = wash.raster.depth.slice();
    let changedSand = 0, restoredSand = 0, offshore = 0, strongSand = 0, higherSand = 0, runupReach = 0;
    for (const cycle of [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75]) {
      const seconds = cycle * BEACH_WASH_PERIOD;
      dry.animate(seconds);
      wash.animate(seconds);
      for (let i = 0; i < wash.waterMask.length; i++) {
        const same = [0, 1, 2].every(c => dry.raster.pixels[i * 4 + c] === wash.raster.pixels[i * 4 + c]);
        if (wash.beachWashMask[i]) {
          if (same) restoredSand++;
          else {
            changedSand++;
            const contrast = Math.max(...[0, 1, 2].map(c => Math.abs(dry.raster.pixels[i * 4 + c] - wash.raster.pixels[i * 4 + c])));
            if (contrast >= 20) {
              strongSand++;
              const sy = Math.floor(i / viewport.width) + 0.5 - viewport.origin.y;
              const z = worldHeightFromDepth(sy, wash.raster.depth[i], 'oblique');
              if (z > -2 + 1e-6) higherSand++;
              const point = waterWorldPoint(i % viewport.width + 0.5 - viewport.origin.x,
                sy + z - ISLAND_WATER_HEIGHT, 'oblique');
              runupReach = Math.max(runupReach, -environment.shore.distance(point.x, point.y));
            }
          }
        } else if (!wash.waterMask[i] || wash.oceanOnlyMask[i]) {
          expect(same).toBe(true);
          if (wash.oceanOnlyMask[i]) offshore++;
        }
      }
    }
    expect(changedSand).toBeGreaterThan(20);
    expect(strongSand).toBeGreaterThan(300);
    expect(higherSand).toBeGreaterThan(100);
    expect(runupReach).toBeGreaterThan(5);
    expect(restoredSand).toBeGreaterThan(20);
    expect(offshore).toBeGreaterThan(1000);
    expect(wash.raster.depth).toEqual(depths);
    expect(island).toEqual(before);
  });
});
