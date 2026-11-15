import { describe, expect, it } from 'vitest';
import { generateIslandWorld, generateWorld } from './core/world';
import { generateIslandWorld as generateOriginalIslandWorld } from '../core/world';

describe('island generation connectivity regressions', () => {
  it.each([12, 41, 42, 70])('preserves the existing working layout for seed %i', seed => {
    const world = generateIslandWorld(seed), original = generateOriginalIslandWorld(seed);
    expect(world.elevations).toEqual(original.elevations);
    expect(world.ramps).toEqual(original.ramps);
    expect(world.cliffCells).toEqual(original.cliffCells);
  });

  it('generates seed 71 without exhausting connectivity variations', () => {
    const world = generateIslandWorld(71);
    expect(world.elevations).toContain(1);
    expect(world.elevations).toContain(2);
    expect(world.ramps!.some(ramp => ramp.upperLevel === 2)).toBe(true);
    expect(world).toEqual(generateIslandWorld(71));
    const coast = generateWorld(71);
    expect(world.cells).toEqual(coast.cells);
    expect(world.heights).toEqual(coast.heights);
  });

  it.each(Array.from({ length: 128 }, (_, seed) => seed))('connects every walkable cell for seed %i', seed => {
    const world = generateIslandWorld(seed);
    const { width, height, elevations, cliffCells, rampIds } = world;
    const walkable = (index: number) => Boolean(world.cells[index]) && !cliffCells![index];
    const start = world.cells.findIndex((_, index) => walkable(index));
    const visited = new Set([start]), queue = [start];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor], x = index % width, y = Math.floor(index / width);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || visited.has(next) || !walkable(next)) continue;
        if (elevations![index] !== elevations![next] && (rampIds![index] < 0 || rampIds![index] !== rampIds![next])) continue;
        visited.add(next);
        queue.push(next);
      }
    }
    expect(visited.size).toBe(world.cells.reduce((count, _, index) => count + Number(Boolean(walkable(index))), 0));
  });
});
