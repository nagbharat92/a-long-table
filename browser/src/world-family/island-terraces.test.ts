import { describe, expect, it } from 'vitest';
import { generateTerracedIslandWorld, V2_TERRACE_GENERATOR } from './core/island-terraces';
import { generateWorld } from './core/world';
import { ISLAND_HEIGHT_PALETTE, ISLAND_MAX_CLIFF_RISE, validateIslandHeights } from './core/island-heights';
import { createIslandAscents } from './core/island-ascents';
import type { World } from './core/contracts';

function reachableLand(world: World): number {
  const { cells, elevations, cliffCells, rampIds, width, height } = world;
  const visited = new Uint8Array(cells.length);
  const start = cells.findIndex((land, i) => land > 0 && !cliffCells![i]);
  const queue = [start];
  visited[start] = 1;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const from = queue[cursor], x = from % width, y = Math.floor(from / width);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
      const to = from + dx + dy * width;
      if (visited[to] || !cells[to] || cliffCells![to]) continue;
      const change = Math.abs(elevations![from] - elevations![to]);
      if (change && (change !== 1 || rampIds![from] < 0 || rampIds![from] !== rampIds![to])) continue;
      visited[to] = 1;
      queue.push(to);
    }
  }
  return queue.length;
}

function massShape(world: World): { regions: number; offset: number; elongation: number } {
  const raised: number[] = [], land: number[] = [];
  world.cells.forEach((value, i) => {
    if (value) land.push(i);
    if (world.elevations![i]) raised.push(i);
  });
  if (!raised.length) return { regions: 0, offset: 0, elongation: 1 };
  const center = (indices: number[]) => ({
    x: indices.reduce((sum, i) => sum + i % world.width, 0) / indices.length,
    y: indices.reduce((sum, i) => sum + Math.floor(i / world.width), 0) / indices.length,
  });
  const hill = center(raised), island = center(land);
  let xx = 0, xy = 0, yy = 0;
  for (const i of raised) {
    const dx = i % world.width - hill.x, dy = Math.floor(i / world.width) - hill.y;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }
  const difference = Math.hypot(xx - yy, 2 * xy);
  const pending = new Set(raised);
  let regions = 0;
  while (pending.size) {
    const first = pending.values().next().value!;
    const queue = [first];
    pending.delete(first);
    regions++;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const i = queue[cursor];
      for (const next of [i - 1, i + 1, i - world.width, i + world.width]) {
        if (pending.delete(next)) queue.push(next);
      }
    }
  }
  return {
    regions,
    offset: Math.hypot(hill.x - island.x, hill.y - island.y) / Math.sqrt(land.length / Math.PI),
    elongation: Math.sqrt((xx + yy + difference) / (xx + yy - difference)),
  };
}

const representative = [0, 1, 12, 26, 41, 71, 902479, 999999];
const sweep = [...new Set([...Array.from({ length: 128 }, (_, i) => i),
  ...Array.from({ length: 32 }, (_, i) => Math.round(i * 999999 / 31)), ...representative])];

describe('V2 seeded terrace composition', () => {
  it('preserves terrain, represents every selected tier and varies the physical composition', () => {
    const compositions = new Set<string>(), heights = new Set<number>(), counts = new Set<number>();
    const coverage = new Set<number>(), maxima = new Set<number>();
    let separated = 0, elongated = 0, offset = 0, lowIslands = 0;
    for (const seed of sweep) {
      const source = generateWorld(seed);
      const world = generateTerracedIslandWorld(seed);
      expect(world.cells, `coast ${seed}`).toEqual(source.cells);
      expect(world.heights, `terrain ${seed}`).toEqual(source.heights);
      expect(world.generatorVersion).toBe(V2_TERRACE_GENERATOR);
      expect(world.provenance).toBe('browser-generated');
      validateIslandHeights(world);
      const composition = world.elevationHeights!;
      expect(Object.isFrozen(composition)).toBe(true);
      expect(composition.at(-1)).toBeLessThanOrEqual(32);
      if (composition.length === 2) {
        const shape = massShape(world);
        lowIslands++;
        if (shape.regions > 1) separated++;
        if (shape.elongation > 2) elongated++;
        if (shape.offset > 0.35) offset++;
      }
      compositions.add(composition.join('/'));
      counts.add(composition.length);
      maxima.add(composition[composition.length - 1]);
      composition.forEach(height => heights.add(height));
      const actual = new Set<number>();
      let waterElevations = 0, exposedLand = 0, raised = 0, raisedCoast = 0;
      let maximumCliff = 0;
      world.elevations!.forEach((level, i) => {
        if (world.cells[i]) actual.add(level);
        else if (level) waterElevations++;
        if (world.cells[i] && !world.cliffCells![i]) exposedLand++;
        const x = i % world.width, y = Math.floor(i / world.width);
        for (const next of [x + 1 < world.width ? i + 1 : -1,
          y + 1 < world.height ? i + world.width : -1]) {
          if (next < 0 || !world.cells[i] || !world.cells[next]) continue;
          maximumCliff = Math.max(maximumCliff, Math.abs(composition[level] - composition[world.elevations![next]]));
        }
        if (level) {
          raised++;
          const x = i % world.width, y = Math.floor(i / world.width);
          if (x === 0 || y === 0 || x === world.width - 1 || y === world.height - 1
            || !world.cells[i - 1] || !world.cells[i + 1]
            || !world.cells[i - world.width] || !world.cells[i + world.width]) raisedCoast++;
        }
      });
      coverage.add(Math.round(100 * raised / world.cells.reduce((sum, land) => sum + land, 0)));
      expect(waterElevations + raisedCoast, `coastal lowlands ${seed}`).toBe(0);
      expect(reachableLand(world), `connected land ${seed}`).toBe(exposedLand);
      expect([...actual].sort((a, b) => a - b)).toEqual(composition.map((_, i) => i));
      for (let i = 1; i < composition.length; i++) {
        expect(composition[i] - composition[i - 1]).toBeLessThanOrEqual(ISLAND_MAX_CLIFF_RISE);
      }
      expect(maximumCliff, `individual cliff rise for ${seed}`).toBeLessThanOrEqual(ISLAND_MAX_CLIFF_RISE);
      expect(world.rampIds).toHaveLength(world.cells.length);
      expect(world.cliffCells).toHaveLength(world.cells.length);
      expect(world.ramps!.length).toBeGreaterThanOrEqual(composition.length - 1);
      world.ramps!.forEach((ramp, id) => {
        expect(ramp.upperLevel - ramp.lowerLevel).toBe(1);
        expect(world.rampIds![ramp.highCell.y * world.width + ramp.highCell.x]).toBe(id);
        expect(world.rampIds![ramp.lowCell.y * world.width + ramp.lowCell.x]).toBe(id);
      });
    }
    expect([...heights].sort((a, b) => a - b)).toEqual(ISLAND_HEIGHT_PALETTE);
    expect(counts.has(2) && counts.has(3) && counts.has(4)).toBe(true);
    expect(compositions.size).toBeGreaterThan(8);
    expect(maxima.size).toBeGreaterThanOrEqual(5);
    expect(coverage.size).toBeGreaterThan(12);
    expect(separated).toBeGreaterThan(lowIslands * 0.05);
    expect(elongated).toBeGreaterThan(lowIslands * 0.1);
    expect(offset).toBeGreaterThan(lowIslands * 0.1);
  }, 120000);

  it.each(representative)('replays seed %i without sharing mutable world state', seed => {
    const first = generateTerracedIslandWorld(seed);
    const before = structuredClone(first);
    const second = generateTerracedIslandWorld(seed);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second.cells).not.toBe(first.cells);
    expect(first).toEqual(before);
  });

  it.each([
    [77, [0, 16, 24, 32]], [91, [0, 8, 16]], [152941, [0, 16, 24]], [902479, [0, 8]],
  ] as const)('retains the selected physical composition for seed %i', (seed, heights) => {
    expect(generateTerracedIslandWorld(seed).elevationHeights).toEqual(heights);
  });

  it('can realize every generated connection as stairs', () => {
    for (const seed of sweep) {
      const world = generateTerracedIslandWorld(seed);
      const ascents = createIslandAscents(world);
      expect(ascents, `stairs for ${seed}`).toHaveLength(world.ramps!.length);
      for (const ascent of ascents) {
        expect(ascent.upperHeight).toBe(world.elevationHeights![ascent.upperLevel]);
        expect(ascent.lowerHeight).toBe(world.elevationHeights![ascent.lowerLevel]);
        expect(ascent.sections.every(section => section.fromHeight === section.toHeight)).toBe(true);
      }
    }
  }, 120000);

  it.each([-1, 1000000, 0.5, NaN, Infinity])('rejects invalid seed %s', seed => {
    expect(() => generateTerracedIslandWorld(seed)).toThrow(RangeError);
  });
});
