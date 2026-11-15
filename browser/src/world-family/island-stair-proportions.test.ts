import { describe, expect, it } from 'vitest';
import {
  createIslandAscents, ISLAND_STAIR_MAX_RISER, ISLAND_STAIR_MIN_TREAD,
} from './core/island-ascents';
import { generateTerracedIslandWorld } from './core/island-terraces';
import { generateIslandWorld } from './core/world';
import type { World } from './core/contracts';

const seeds = [...new Set([...Array.from({ length: 128 }, (_, seed) => seed),
  153025, 12, 77, 91, 902479, 71])];

function plateauFrom(world: World, start: number): Set<number> {
  const level = world.elevations![start], visited = new Set([start]), queue = [start];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const index = queue[cursor], x = index % world.width, y = Math.floor(index / world.width);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx, ny = y + dy, next = ny * world.width + nx;
      if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height || visited.has(next)
        || !world.cells[next] || world.cliffCells?.[next] || world.elevations![next] !== level) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  return visited;
}

function checkProportions(world: World): void {
  const ascents = createIslandAscents(world);
  expect(ascents).toHaveLength(world.ramps!.length);
  for (const ascent of ascents) {
    const source = world.ramps![ascent.id];
    expect(ascent.upperLevel).toBe(source.upperLevel);
    expect(ascent.lowerLevel).toBe(source.lowerLevel);
    const indexAt = (x: number, y: number) => Math.floor(y / world.tileSize) * world.width + Math.floor(x / world.tileSize);
    const upper = plateauFrom(world, source.highCell.y * world.width + source.highCell.x);
    const lower = plateauFrom(world, source.lowCell.y * world.width + source.lowCell.x);
    expect(upper.has(indexAt(ascent.origin.x, ascent.origin.y))).toBe(true);
    expect(lower.has(indexAt(ascent.origin.x + ascent.direction.x * ascent.length,
      ascent.origin.y + ascent.direction.y * ascent.length))).toBe(true);
    expect(ascent.sections.every(section => section.axis === undefined)).toBe(true);
    expect(ascent.stepCount).toBeGreaterThanOrEqual(
      Math.ceil((ascent.upperHeight - ascent.lowerHeight) / ISLAND_STAIR_MAX_RISER));
    for (const [index, section] of ascent.sections.entries()) {
      expect(section.toHeight).toBe(section.fromHeight);
      expect(section.to - section.from).toBeGreaterThanOrEqual(ISLAND_STAIR_MIN_TREAD - 1e-8);
      if (index > 0) {
        const riser = ascent.sections[index - 1].toHeight - section.fromHeight;
        expect(riser).toBeGreaterThanOrEqual(-1e-8);
        expect(riser).toBeLessThanOrEqual(ISLAND_STAIR_MAX_RISER + 1e-8);
      }
    }
  }
}

describe('character-scale island stairs', () => {
  it.each([
    ['source', generateIslandWorld],
    ['terraces', generateTerracedIslandWorld],
  ] as const)('preserves connections with bounded risers and treads across %s seeds', (_, generate) => {
    const failures: string[] = [];
    for (const seed of seeds) {
      try {
        checkProportions(generate(seed));
      } catch (error) {
        failures.push(`${seed}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    expect(failures).toEqual([]);
  }, 120000);
});
