import { describe, expect, it, vi } from 'vitest';
import FastNoiseLite from 'fastnoise-lite';
import { Navigation } from '../src/core/navigation';
import { BEACH_LEVEL, cellCenter, generateIslandWorld, generateWorld, ISLAND_GENERATOR_VERSION, terrainAt } from '../src/core/world';
import type { World } from '../src/core/contracts';

const seeds = [
  ...Array.from({ length: 64 }, (_, seed) => seed),
  ...Array.from({ length: 64 }, (_, index) => (104729 + index * 7919) % 1000000),
  12345, 271828, 999999,
];
const worlds = new Map<number, World>();
function sample(seed: number): World {
  let world = worlds.get(seed);
  if (!world) { world = generateIslandWorld(seed); worlds.set(seed, world); }
  return world;
}

function structure(world: World): { coverage: number; masses: number; highest: number; offsetX: number } {
  const levels = world.elevations!;
  let land = 0, raised = 0, landX = 0, raisedX = 0, highest = 0;
  let left = world.width, right = 0;
  const visited = new Set<number>();
  let masses = 0;
  for (let i = 0; i < levels.length; i++) {
    if (!world.cells[i]) continue;
    const x = i % world.width;
    land++; landX += x;
    left = Math.min(left, x); right = Math.max(right, x);
    highest = Math.max(highest, levels[i]);
    if (!levels[i]) continue;
    raised++; raisedX += x;
    if (visited.has(i)) continue;
    masses++;
    const queue = [i];
    visited.add(i);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const from = queue[cursor], x = from % world.width, y = Math.floor(from / world.width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, next = ny * world.width + nx;
        if (nx < 0 || nx >= world.width || ny < 0 || ny >= world.height || !levels[next] || visited.has(next)) continue;
        visited.add(next); queue.push(next);
      }
    }
  }
  return { coverage: raised / land, masses, highest, offsetX: raised ? (raisedX / raised - landX / land) / (right - left) : 0 };
}

describe('seed-driven Island Explorer highlands', () => {
  it.each(seeds)('seed %i is repeatable, preserves coastline and connects every walkable land cell', seed => {
    const world = sample(seed), baseline = generateWorld(seed), repeat = generateIslandWorld(seed);
    expect(world.generatorVersion).toContain(ISLAND_GENERATOR_VERSION);
    expect(world.provenance).toBe('browser-generated');
    expect(world.heights).toEqual(baseline.heights);
    expect(world.cells).toEqual(baseline.cells);
    for (const key of ['elevations', 'cliffCells', 'rampIds', 'ramps'] as const) expect(world[key]).toEqual(repeat[key]);
    expect(baseline.elevations).toBeUndefined();
    expect(world.elevations!.every(level => level <= 2)).toBe(true);
    const nav = new Navigation(world), spawn = nav.spawnPosition();
    for (let i = 0; i < world.cells.length; i++) {
      if (!world.cells[i]) { expect(world.elevations![i]).toBe(0); continue; }
      if (nav.speeds[i]) expect(nav.canReach(spawn, cellCenter(world, { x: i % world.width, y: Math.floor(i / world.width) }))).toBe(true);
    }
    for (const ramp of world.ramps!) {
      const high = cellCenter(world, ramp.highCell), low = cellCenter(world, ramp.lowCell);
      const route = nav.route(low, high);
      expect(route.at(-1)).toEqual(high);
      for (let index = 1; index < route.length; index++) expect(nav.segmentClear(route[index - 1], route[index])).toBe(true);
      expect(ramp.upperLevel - ramp.lowerLevel).toBe(1);
      expect(ramp.surface).toBe('sand');
      const length = Math.abs(ramp.lowCell.x - ramp.highCell.x) + Math.abs(ramp.lowCell.y - ramp.highCell.y) + 1;
      expect(length).toBe(ramp.direction.y === 1 ? 5 : 4);
      expect(ramp.direction.x === 0 ? ramp.rect.width : ramp.rect.height).toBe(3);
      for (const other of world.ramps!) {
        if (other === ramp) continue;
        const a = ramp.rect, b = other.rect;
        expect(a.x + a.width + 3 <= b.x || b.x + b.width + 3 <= a.x
          || a.y + a.height + 3 <= b.y || b.y + b.height + 3 <= a.y).toBe(true);
      }
      for (let y = ramp.rect.y; y < ramp.rect.y + ramp.rect.height; y++) {
        for (let x = ramp.rect.x; x < ramp.rect.x + ramp.rect.width; x++) {
          expect(terrainAt(world, { x, y })).toBe('sand');
          expect(nav.speeds[y * world.width + x]).toBe(1);
        }
      }
      for (const [landing, outward, level] of [
        [ramp.highCell, -1, ramp.upperLevel], [ramp.lowCell, 1, ramp.lowerLevel],
      ] as const) {
        for (let step = 0; step <= 2; step++) {
          for (let across = -2; across <= 2; across++) {
            const x = landing.x + ramp.direction.x * step * outward - ramp.direction.y * across;
            const y = landing.y + ramp.direction.y * step * outward + ramp.direction.x * across;
            const i = y * world.width + x;
            expect(world.heights[i]).toBeGreaterThan(BEACH_LEVEL);
            expect(world.elevations![i]).toBe(level);
            expect(nav.speeds[i]).toBe(1);
          }
        }
      }
    }
  });

  it('varies actual coverage, massing, position and presence of summits across the fixed seed sample', () => {
    const shapes = seeds.map(seed => structure(sample(seed)));
    const coverage = shapes.map(shape => shape.coverage);
    const offsets = shapes.filter(shape => shape.masses > 0).map(shape => shape.offsetX);
    expect(Math.max(...coverage) - Math.min(...coverage)).toBeGreaterThan(0.35);
    expect(Math.max(...coverage)).toBeLessThan(0.65);
    expect(new Set(shapes.map(shape => shape.highest))).toEqual(new Set([0, 1, 2]));
    expect(shapes.some(shape => shape.masses === 1)).toBe(true);
    expect(shapes.some(shape => shape.masses >= 2)).toBe(true);
    expect(Math.max(...offsets) - Math.min(...offsets)).toBeGreaterThan(0.25);
  });

  it('returns independent arrays without modifying historical relief references', () => {
    const legacy = generateWorld(42, { relief: true });
    const world = generateIslandWorld(42);
    world.elevations!.fill(9);
    world.rampIds!.fill(999);
    world.heights.fill(99);
    const fresh = generateIslandWorld(42);
    expect(fresh.elevations!.every(level => level <= 2)).toBe(true);
    expect(fresh.heights).toEqual(generateWorld(42).heights);
    expect(generateWorld(42, { relief: true })).toEqual(legacy);
  });

  it.each([-1, 1000000, 1.5, NaN, Infinity])('rejects invalid seed %s', seed => {
    expect(() => generateIslandWorld(seed)).toThrow('integer from 0 through 999999');
  });

  it('does not turn invalid procedural heights into a successful flat island', () => {
    const noise = vi.spyOn(FastNoiseLite.prototype, 'GetNoise').mockReturnValue(NaN);
    try {
      expect(() => generateIslandWorld(43)).toThrow('invalid highland heights');
    } finally {
      noise.mockRestore();
    }
  });
});
