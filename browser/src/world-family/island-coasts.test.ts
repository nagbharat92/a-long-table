import { describe, expect, it } from 'vitest';
import { generateTerracedIslandWorld } from './core/island-terraces';
import { createIslandAscents } from './core/island-ascents';
import { generateIslandCoasts } from './core/island-coasts';
import { buildIslandLandform, generateIslandLandform, islandSurfaceHeight } from './core/island-landform';
import { islandCoastInfluence } from './core/island-coast-profile';
import type { World } from './core/contracts';

const seeds = [
  12, 71, 77, 91, 153025, 902479, 1, 42, 123, 12345, 2026, 987654,
  152941, 2, 3, 7, 13, 39, 100, 777, 65535, 999999, 153024, 902478,
];

describe('default procedural island coasts', () => {
  it('excavates real bays and wide lowland beaches across varied seeds without touching highlands', () => {
    let coveSeeds = 0, beachSeeds = 0, excavated = 0;
    for (const seed of seeds) {
      const original = generateTerracedIslandWorld(seed);
      const before = structuredClone(original);
      const ascents = createIslandAscents(original);
      const { world, coast, stats } = generateIslandCoasts(original, ascents);
      expect(original).toEqual(before);
      expect(world.elevations).toEqual(original.elevations);
      expect(world.elevationHeights).toEqual(original.elevationHeights);
      expect(world.rampIds).toEqual(original.rampIds);
      expect(createIslandAscents(world)).toEqual(ascents);
      let removed = 0, sand = 0;
      for (let i = 0; i < world.cells.length; i++) {
        if (original.cells[i] && !world.cells[i]) removed++;
        if (world.cells[i] && world.heights[i] !== original.heights[i]) sand++;
        if (original.elevations![i] || original.rampIds![i] >= 0 || original.cliffCells![i]) {
          expect(world.cells[i]).toBe(original.cells[i]);
          expect(world.heights[i]).toBe(original.heights[i]);
          expect(world.cliffCells![i]).toBe(original.cliffCells![i]);
        }
      }
      expect(removed).toBe(stats.carvedCells);
      expect(sand).toBe(stats.sandyCells);
      expect(stats.candidates).toBe(stats.coves + stats.beaches + stats.rejectedProtected
        + stats.rejectedWidth + stats.rejectedConnectivity + stats.rejectedOverlap);
      expect(sand).toBeGreaterThanOrEqual(stats.coves * 100);
      const island = buildIslandLandform(world, { coast, optimize: false });
      expect(island.triangles.length).toBeGreaterThan(0);
      const first = world.cells.findIndex(Boolean), seen = new Set([first]), queue = [first];
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const i = queue[cursor], x = i % world.width, y = Math.floor(i / world.width);
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = x + dx, ny = y + dy, next = ny * world.width + nx;
          if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height || !world.cells[next] || seen.has(next)) continue;
          seen.add(next); queue.push(next);
        }
      }
      expect(seen.size).toBe(world.cells.reduce((sum, cell) => sum + cell, 0));
      for (const region of coast.regions) {
        // The middle remains owned all the way from sea level to dry ground,
        // irrespective of which opposing coast is closer.
        for (let d = 0; d <= 24; d += 2) {
          expect(islandCoastInfluence(coast, region.center.x - region.normal.x * d,
            region.center.y - region.normal.y * d)).toBeCloseTo(1);
        }
        const surface = (distance: number) => {
          const point = { x: region.center.x - region.normal.x * distance, y: region.center.y - region.normal.y * distance };
          const cell = { x: Math.floor(point.x / world.tileSize), y: Math.floor(point.y / world.tileSize) };
          expect(world.cells[cell.y * world.width + cell.x]).toBe(1);
          return islandSurfaceHeight(world, cell, point, island.ascents, island.edges, island.beach, island.shoulders);
        };
        expect(surface(12)).toBeLessThanOrEqual(-0.5);
        expect(surface(32)).toBe(0);
        expect(surface(40)).toBe(0);
      }
      if (stats.coves) { coveSeeds++; expect(removed).toBeGreaterThanOrEqual(24); }
      if (coast.regions.length) beachSeeds++;
      excavated += removed;
    }
    expect(coveSeeds).toBeGreaterThanOrEqual(6);
    expect(beachSeeds).toBeGreaterThanOrEqual(10);
    expect(excavated).toBeGreaterThan(400);
  }, 120000);

  it('rounds the offshore footprint and smoothly loses shallow influence before its outer edge', () => {
    const original = generateTerracedIslandWorld(77);
    const { coast } = generateIslandCoasts(original, createIslandAscents(original));
    expect(coast.regions.length).toBeGreaterThan(0);
    for (const region of coast.regions) {
      const sample = (offshore: number, along = 0) => islandCoastInfluence(coast,
        region.center.x + region.normal.x * offshore - region.normal.y * along,
        region.center.y + region.normal.y * offshore + region.normal.x * along);
      expect(sample(16)).toBeCloseTo(1);
      expect(sample(32)).toBeGreaterThan(0);
      expect(sample(32)).toBeLessThan(0.8);
      expect(sample(52)).toBe(0);
      expect(sample(40, region.length * 0.4)).toBeLessThan(sample(40));
    }
  });

  it('rejects both sides of a narrow dry connector rather than lowering or severing it', () => {
    const width = 64, height = 48;
    const original: World = {
      seed: 77, generatorVersion: 'neck-fixture', provenance: 'test-fixture',
      width, height, tileSize: 4, seaLevel: 0,
      cells: new Uint8Array(width * height), heights: new Float32Array(width * height).fill(-0.1),
      elevations: new Uint8Array(width * height), rampIds: new Int32Array(width * height).fill(-1),
      cliffCells: new Uint8Array(width * height), ramps: [],
    };
    for (let y = 4; y < 44; y++) for (let x = 4; x < 60; x++) {
      // Wide lobes joined by an eight-tile strip, too narrow for even one
      // six-tile grade plus four-tile dry connection.
      if (x >= 24 && x < 40 && (y < 20 || y >= 28)) continue;
      const i = y * width + x;
      original.cells[i] = 1; original.heights[i] = 0.3;
    }
    const { world, coast, stats } = generateIslandCoasts(original, []);
    expect(stats.rejectedWidth).toBeGreaterThan(0);
    for (let y = 20; y < 28; y++) for (let x = 24; x < 40; x++) {
      const i = y * width + x;
      expect(world.cells[i]).toBe(1);
      expect(world.heights[i]).toBe(original.heights[i]);
      expect(islandCoastInfluence(coast, (x + 0.5) * 4, (y + 0.5) * 4)).toBe(0);
    }
    const rocky = structuredClone(original);
    rocky.cliffCells!.fill(1);
    const rejected = generateIslandCoasts(rocky, []);
    expect(rejected.stats.rejectedProtected).toBeGreaterThan(0);
    expect(rejected.stats.coves).toBe(0);
    expect(rejected.stats.beaches).toBe(0);
    expect(rejected.coast.regions).toHaveLength(0);
    expect(rejected.world.cells).toEqual(rocky.cells);
    expect(rejected.world.heights).toEqual(rocky.heights);
  });

  it('is deterministic, cloneable and the normal generation path, with an explicit regression baseline', () => {
    const original = generateTerracedIslandWorld(153025), ascents = createIslandAscents(original);
    const first = generateIslandCoasts(original, ascents);
    expect(generateIslandCoasts(original, ascents)).toEqual(first);
    expect(structuredClone(first)).toEqual(first);
    const generated = generateIslandLandform(153025, { optimize: false });
    expect(generated.coast).toEqual(first.coast);
    expect(generated.world).toEqual(first.world);
    expect(generated.cove).toBeUndefined();
    expect(generated.beach.landSurfaces.size).toBeGreaterThan(100);
    const baseline = generateIslandLandform(153025, { optimize: false, coastalGeneration: false });
    expect(baseline.world).toEqual(original);
    expect(baseline.coast).toBeUndefined();
  }, 120000);
});
