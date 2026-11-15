import { describe, expect, it } from 'vitest';
import { buildIslandLandform, islandSurfaceHeight } from './core/island-landform';
import { generateTerracedIslandWorld } from './core/island-terraces';
import { generateWorld } from './core/world';
import { islandLevelHeights } from './core/island-heights';
import { rasterLandform, type LandPalette } from './render/landform-study';
import { islandLevelPalette } from './render/island-level-palette';
import type { LandTriangle } from './core/landform-study';

const palette: LandPalette = {
  water: [0, 0, 0], top: [120, 160, 80], light: [180, 170, 140],
  middle: [140, 130, 100], dark: [90, 100, 80], levels: [],
};
const area = (triangles: readonly LandTriangle[]) => triangles.reduce((sum, { vertices: [a, b, c] }) => {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
  return sum + Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
}, 0);

describe('quantized V2 terrace mesh integration', () => {
  it.each([...new Set([
    ...Array.from({ length: 32 }, (_, seed) => seed), 41, 71, 902479, 999999,
  ])])('builds supported low-poly geometry and matching height queries for seed %i', seed => {
    const world = generateTerracedIslandWorld(seed), before = structuredClone(world);
    const raw = buildIslandLandform(world, { optimize: false }), island = buildIslandLandform(world);
    const coast = generateWorld(seed);
    expect(world.cells.every((value, i) => value === coast.cells[i])).toBe(true);
    expect(world.heights.every((value, i) => value === coast.heights[i])).toBe(true);
    expect(island.triangles.length).toBeLessThan(raw.triangles.length * 0.3);
    expect(area(island.triangles)).toBeCloseTo(area(raw.triangles), 5);
    for (const triangle of island.triangles.filter(triangle => triangle.plane === 'top')) {
      const point = {
        x: triangle.vertices.reduce((sum, vertex) => sum + vertex.x, 0) / 3,
        y: triangle.vertices.reduce((sum, vertex) => sum + vertex.y, 0) / 3,
      };
      const cell = { x: Math.floor(point.x / world.tileSize), y: Math.floor(point.y / world.tileSize) };
      const height = triangle.vertices.reduce((sum, vertex) => sum + vertex.z, 0) / 3;
      expect(islandSurfaceHeight(world, cell, point, island.ascents, island.edges, island.beach, island.shoulders)).toBeCloseTo(height, 6);
    }
    for (const ascent of island.ascents) {
      expect(ascent.upperHeight).toBe(islandLevelHeights(world)[ascent.upperLevel]);
      expect(ascent.lowerHeight).toBe(islandLevelHeights(world)[ascent.lowerLevel]);
      expect(ascent.stepCount).toBeGreaterThan(0);
      expect(ascent.sections.every(section => section.fromHeight === section.toHeight)).toBe(true);
    }
    expect(world).toEqual(before);
  });

  it.each([12, 41, 71, 902479])('retains exact visible coverage and plan colors after merging for seed %i', seed => {
    const world = generateTerracedIslandWorld(seed), island = buildIslandLandform(world);
    const raw = buildIslandLandform(world, { optimize: false });
    const colors = { ...palette, levels: islandLevelPalette(world, [211, 217, 184], [112, 142, 120]) };
    for (const projection of ['oblique', 'current', 'plan'] as const) {
      const viewport = { width: 640, height: 520, origin: projection === 'oblique' ? { x: 280, y: 80 } : { x: 24, y: 80 } };
      const render = (triangles: LandTriangle[]) => rasterLandform(projection, colors, [], { triangles, viewport });
      const before = render(raw.triangles), after = render(island.triangles);
      expect(after.levels.every((value, i) => value === before.levels[i])).toBe(true);
      expect(after.pixels.every((value, i) => value === before.pixels[i])).toBe(true);
    }
  });
});
