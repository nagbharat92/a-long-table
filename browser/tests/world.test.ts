import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import FastNoiseLite from 'fastnoise-lite';
import {
  cellAt, cellCenter, generateWorld, getWorldBounds, isCoastalCliff,
  makeNavigationFixture, terrainAt,
} from '../src/core/world';
import type { World } from '../src/core/contracts';
import reference42 from '../src/fixtures/reference-42.json';
import reference43 from '../src/fixtures/reference-43.json';
import reference12345 from '../src/fixtures/reference-12345.json';
import relief42 from '../src/fixtures/reference-42-relief.json';
import relief12345 from '../src/fixtures/reference-12345-relief.json';

function connectedCount(world: World, land: boolean, diagonal: boolean): number {
  const start = world.cells.findIndex(value => Boolean(value) === land);
  const visited = new Set([start]), queue = [start];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const i = queue[cursor], x = i % world.width, y = Math.floor(i / world.width);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || (!diagonal && dx && dy)) continue;
        if (x + dx < 0 || x + dx >= world.width || y + dy < 0 || y + dy >= world.height) continue;
        const next = (y + dy) * world.width + x + dx;
        if (!visited.has(next) && Boolean(world.cells[next]) === land) {
          visited.add(next); queue.push(next);
        }
      }
    }
  }
  return visited.size;
}

describe('exact captured terrain references', () => {
  it.each([
    [42, reference42, 2337, '486c36c1cfb7316465c4841c88001334dc85791e672b599381c7c9c9ec299fe4'],
    [43, reference43, 3559, 'fa65b9b77c5477543b970a5a838daee912b34171119674cffef1fe2b8b8f7e29'],
    [12345, reference12345, 4649, '0c611604152e1c8895f66ebfcea6ea167bdaa0ee7bde4f5075fc490cd0bf4d3e'],
  ] as const)('preserves every float32 height and binary land cell for seed %i', (seed, fixture, land, hash) => {
    const world = generateWorld(seed);
    expect(world.provenance).toBe('captured-reference');
    expect(world.generatorVersion).toBe('reference-coast-v1');
    expect([world.width, world.height, world.tileSize]).toEqual([128, 96, 4]);
    expect(Array.from(world.heights)).toEqual(fixture.heights);
    expect(Array.from(world.cells)).toEqual(fixture.cells);
    expect(world.cells.reduce((sum, value) => sum + value, 0)).toBe(land);
    expect(createHash('sha256').update(new Uint8Array(world.heights.buffer)).digest('hex')).toBe(hash);
    expect(fixture.reference.snapshot).toBe('main');
    expect(fixture.reference.generatorSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fixture.reference.exporterVersion).toBe(1);
    expect(world.elevations).toBeUndefined();
  });

  it.each([[42, relief42], [12345, relief12345]] as const)('keeps seed %i relief separate and exact', (seed, fixture) => {
    const world = generateWorld(seed, { relief: true });
    expect(world.generatorVersion).toBe('reference-relief-v1');
    expect(world.provenance).toBe('captured-reference');
    expect(Array.from(world.heights)).toEqual(fixture.heights);
    expect(Array.from(world.elevations!)).toEqual(fixture.elevations);
    expect(Array.from(world.cliffCells!)).toEqual(fixture.cliffCells);
    expect(Array.from(world.rampIds!)).toEqual(fixture.rampIds);
    expect(world.ramps).toEqual(fixture.ramps);
    expect(fixture.reference.snapshot).toBe('island');
    expect(fixture.reference.reliefSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(generateWorld(seed).elevations).toBeUndefined();
  });

  it('returns independently mutable arrays and ramp geometry', () => {
    const first = generateWorld(42, { relief: true });
    first.heights[0] = 99;
    first.cells[0] = 1;
    first.elevations![0] = 9;
    first.ramps![0].rect.x = -99;
    const second = generateWorld(42, { relief: true });
    expect(second.heights[0]).toBe(relief42.heights[0]);
    expect(second.cells[0]).toBe(relief42.cells[0]);
    expect(second.elevations![0]).toBe(relief42.elevations[0]);
    expect(second.ramps![0].rect.x).toBe(relief42.ramps[0].rect.x);
  });
});

describe('browser-generated terrain', () => {
  it.each([0, 1, 44, 999999])('is deterministic, connected, lake-free and explicitly non-identical for seed %i', seed => {
    const world = generateWorld(seed);
    const repeat = generateWorld(seed);
    expect(world.provenance).toBe('browser-generated');
    expect(world.generatorVersion).toBe('browser-opensimplex2s-mulberry32-coast-v1');
    expect(world.heights).toEqual(repeat.heights);
    expect(world.cells).toEqual(repeat.cells);
    expect(world.heights.every(Number.isFinite)).toBe(true);
    const land = world.cells.reduce((sum, value) => sum + value, 0);
    expect(land).toBeGreaterThanOrEqual(1800);
    expect(land).toBeLessThanOrEqual(7600);
    expect(connectedCount(world, true, false)).toBe(land);
    expect(connectedCount(world, false, true)).toBe(world.cells.length - land);
    for (let i = 0; i < world.cells.length; i++) {
      const x = i % world.width, y = Math.floor(i / world.width);
      expect(world.cells[i]).toBe(Number(world.heights[i] > world.seaLevel));
      if (x < 6 || x >= 122 || y < 6 || y >= 90) expect(world.heights[i]).toBeLessThanOrEqual(-0.20);
      if (terrainAt(world, { x, y }) !== 'shallow') continue;
      let coast = false;
      for (let dy = -6; dy <= 6 && !coast; dy++) {
        for (let dx = -6; dx <= 6; dx++) {
          if (x + dx >= 0 && x + dx < 128 && y + dy >= 0 && y + dy < 96
            && world.cells[(y + dy) * 128 + x + dx]) { coast = true; break; }
        }
      }
      expect(coast).toBe(true);
    }
  });

  it.each([-1, 1000000, 1.5, NaN, Infinity])('rejects invalid seed %s explicitly', seed => {
    expect(() => generateWorld(seed)).toThrow('integer from 0 through 999999');
  });

  it('generates optional browser relief without changing default gameplay', () => {
    const world = generateWorld(44, { relief: true });
    expect(world.provenance).toBe('browser-generated');
    expect(world.generatorVersion).toBe('browser-opensimplex2s-mulberry32-coast-v1-relief-v1');
    expect(world.elevations).toBeInstanceOf(Uint8Array);
    expect(world.elevations!.includes(1)).toBe(true);
    expect(world.elevations!.includes(2)).toBe(true);
    expect(world.ramps!.length).toBeGreaterThan(0);
    expect(world.heights).toEqual(generateWorld(44).heights);
    expect(generateWorld(44).elevations).toBeUndefined();
  });

  it('throws explicitly when experimental relief cannot be generated, never returning flat terrain', () => {
    const noise = vi.spyOn(FastNoiseLite.prototype, 'GetNoise').mockReturnValue(NaN);
    try {
      expect(() => generateWorld(43, { relief: true })).toThrow('Relief generation could not connect island elevations');
    } finally {
      noise.mockRestore();
    }
    expect(generateWorld(43).provenance).toBe('captured-reference');
  });
});

describe('shared world utilities', () => {
  it('derives terrain from fractional heights and uses floor without clamping coordinates', () => {
    const world = makeNavigationFixture();
    expect(world.provenance).toBe('test-fixture');
    expect([world.width, world.height]).toEqual([32, 24]);
    expect(world.heights).toBeInstanceOf(Float32Array);
    expect(new Set(Array.from(world.heights, (_, i) => terrainAt(world,
      { x: i % world.width, y: Math.floor(i / world.width) })))).toEqual(new Set(['grass', 'sand', 'shallow', 'deep']));
    expect(cellAt(world, { x: -0.01, y: 4 })).toEqual({ x: -1, y: 1 });
    expect(cellAt(world, { x: 15.9, y: 8.1 })).toEqual({ x: 3, y: 2 });
    expect(cellCenter(world, { x: 3, y: 2 })).toEqual({ x: 14, y: 10 });
    expect(getWorldBounds(world)).toEqual({ x: 0, y: 0, width: 128, height: 96 });
    expect(terrainAt(world, { x: -1, y: 0 })).toBe('deep');
  });

  it('identifies only south-facing grass-to-water coastal cliffs', () => {
    const world = makeNavigationFixture();
    world.heights[5 * 32 + 5] = 0.4;
    world.heights[6 * 32 + 5] = -0.1;
    expect(isCoastalCliff(world, { x: 5, y: 5 })).toBe(true);
    world.heights[5 * 32 + 5] = 0.05;
    expect(isCoastalCliff(world, { x: 5, y: 5 })).toBe(false);
  });
});
