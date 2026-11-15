import { describe, expect, it } from 'vitest';
import type { World } from './core/contracts';
import type { LandTriangle } from './core/landform-study';
import { ISLAND_WATER_HEIGHT } from './core/island-water-level';
import { generateIslandLandform } from './core/island-landform';
import { createIslandCoastalSlope } from './render/island-coastal-slope';
import { createIslandShoreField } from './render/island-shore-field';
import { createIslandWaterDepth } from './render/island-water-depth';
import { createIslandEnvironment } from './render/island-environment';
import { waterPaletteColor, WATER_MAX_DEPTH } from './render/island-water-color';
import { DEFAULT_WATER_SETTINGS } from './render/island-water-settings';

function square(seed: number): World {
  return {
    seed, generatorVersion: 'coastal-slope-fixture', provenance: 'test-fixture',
    width: 16, height: 16, tileSize: 8, seaLevel: 0,
    cells: new Uint8Array(256).fill(1), heights: new Float32Array(256).fill(1),
    elevations: new Uint8Array(256), rampIds: new Int32Array(256).fill(-1), ramps: [],
  };
}

function sheet(depth: number): LandTriangle[] {
  const z = ISLAND_WATER_HEIGHT - depth;
  const vertices = [{ x: 0, y: 0, z }, { x: 128, y: 0, z },
    { x: 128, y: 128, z }, { x: 0, y: 128, z }];
  return [[0, 1, 2], [0, 2, 3]].map(([a, b, c]) => ({
    vertices: [vertices[a], vertices[b], vertices[c]], plane: 'top', level: 0, submerged: depth >= 0,
  }));
}

describe('continuous whole-island submerged foundation', () => {
  it.each([77, 153025, 153028, 902479])('surrounds every rocky side with broad shallows and a gradual offshore slope for seed %i', seed => {
    const world = square(seed), shore = createIslandShoreField(world);
    const slope = createIslandCoastalSlope(world, shore);
    for (const ray of [
      (d: number) => ({ x: -d, y: 64 }), (d: number) => ({ x: 128 + d, y: 64 }),
      (d: number) => ({ x: 64, y: -d }), (d: number) => ({ x: 64, y: 128 + d }),
    ]) {
      let previous = 0, color = waterPaletteColor(0, 0);
      for (let d = 0; d <= 128; d += 0.25) {
        const point = ray(d), depth = slope.sample(point.x, point.y);
        const next = waterPaletteColor(depth, 0);
        expect(shore.sample(point.x, point.y).beachWeight).toBe(0);
        expect(depth).toBeGreaterThanOrEqual(previous - 1e-8);
        expect(depth - previous).toBeLessThan(0.12);
        expect(Math.max(...next.map((value, channel) => Math.abs(value - color[channel])))).toBeLessThan(1);
        if (d === 12) expect(depth).toBeLessThan(2);
        if (d === 24) expect(depth).toBeLessThan(6);
        if (d === 40) expect(depth).toBeLessThan(DEFAULT_WATER_SETTINGS.transitionDepth);
        if (d >= 120) expect(next).toEqual(DEFAULT_WATER_SETTINGS.deep);
        previous = depth; color = next;
      }
      expect(previous).toBe(WATER_MAX_DEPTH);
    }
  });

  it('has no body-colour silhouette at a finite seabed or the bounded optical raster edge', () => {
    const world = square(153028), shore = createIslandShoreField(world);
    const slope = createIslandCoastalSlope(world, shore);
    const dry = createIslandWaterDepth(sheet(-10), slope);
    const bed = createIslandWaterDepth(sheet(2), slope);
    const legacy = createIslandWaterDepth(sheet(2));
    expect(bed.sample(64, 64)).toBe(2);
    expect(bed.bedVisibility(64, 64)).toBe(legacy.bedVisibility(64, 64));
    expect(dry.sample(136, 64)).toBe(WATER_MAX_DEPTH);
    for (let x = 120; x <= 256; x += 0.125) {
      expect(dry.bodyDepth(x, 64)).toBe(bed.bodyDepth(x, 64));
      expect(bed.bodyDepth(x, 64)).toBe(slope.sample(x, 64));
    }
    const near = dry.bodyDepth(159.9, 64), far = dry.bodyDepth(160.1, 64);
    expect(near).toBeGreaterThan(dry.bodyDepth(140, 64));
    expect(near).toBeLessThan(DEFAULT_WATER_SETTINGS.transitionDepth);
    expect(far).toBeLessThan(WATER_MAX_DEPTH);
    expect(Math.abs(far - near)).toBeLessThan(0.1);
  });

  it('keeps empty worlds deep and is deterministic with broad seed-dependent slope shapes', () => {
    const world = square(77), shore = createIslandShoreField(world);
    const first = createIslandCoastalSlope(world, shore), second = createIslandCoastalSlope(world, shore);
    const other = square(78), changed = createIslandCoastalSlope(other, createIslandShoreField(other));
    let differences = 0;
    for (let y = -64; y <= 192; y += 8) for (let x = -64; x <= 192; x += 8) {
      expect(first.sample(x, y)).toBe(second.sample(x, y));
      if (first.sample(x, y) !== changed.sample(x, y)) differences++;
    }
    expect(differences).toBeGreaterThan(100);
    world.cells.fill(0);
    const empty = createIslandCoastalSlope(world, createIslandShoreField(world));
    for (const point of [[0, 0], [64, 64], [-1000, 1000]]) expect(empty.sample(point[0], point[1])).toBe(WATER_MAX_DEPTH);
  });

  it.each([77, 153028])('integrates the foundation without editing seed %i terrain, seabeds, or water overrides', seed => {
    const island = generateIslandLandform(seed), before = structuredClone(island);
    const environment = createIslandEnvironment(island);
    const optical = createIslandWaterDepth([...island.triangles, ...island.beach.underwaterTriangles]);
    let rocky = 0, sandy = 0;
    for (let y = -8; y <= island.world.height * island.world.tileSize + 8; y += 2)
      for (let x = -8; x <= island.world.width * island.world.tileSize + 8; x += 2) {
        const shore = environment.shore.sample(x, y);
        if (shore.distance > 2 && shore.distance < 8) {
          expect(environment.waterDepth.bodyDepth(x, y)).toBeLessThan(1);
          if (shore.beachWeight < 0.1) rocky++;
          if (shore.beachWeight > 0.9) sandy++;
        }
        expect(environment.waterDepth.sample(x, y)).toBe(optical.sample(x, y));
      }
    expect(rocky).toBeGreaterThan(10);
    expect(sandy).toBeGreaterThan(10);
    const depth = environment.waterDepth;
    environment.setWaterSettings({ ...environment.waterSettings, shallow: [80, 190, 200] });
    expect(environment.waterSettings.shallow).toEqual([80, 190, 200]);
    expect(environment.waterDepth).toBe(depth);
    expect(island).toEqual(before);
  });

  it('rejects nonfinite inputs and invalid shore distances', () => {
    const world = square(77), shore = createIslandShoreField(world);
    const slope = createIslandCoastalSlope(world, shore);
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(() => slope.sample(value, 0)).toThrow('finite');
      expect(() => slope.sample(0, value)).toThrow('finite');
      expect(() => createIslandCoastalSlope({ ...world, seed: value }, shore)).toThrow('finite seed');
      if (value !== Infinity) {
        const invalid = createIslandCoastalSlope(world, { ...shore, distance: () => value });
        expect(() => invalid.sample(0, 0)).toThrow('coast distance');
      }
    }
    expect(() => createIslandCoastalSlope({ ...world, width: 0 }, shore)).toThrow('world dimensions');
    expect(() => createIslandCoastalSlope({ ...world, width: 100000, height: 100000 }, shore)).toThrow('budget');
  });
});
