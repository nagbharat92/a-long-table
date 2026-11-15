import { describe, expect, it } from 'vitest';
import { buildIslandLandform, islandSurfaceHeight } from './core/island-landform';
import { generateTerracedIslandWorld } from './core/island-terraces';
import { islandHeightAtLevel } from './core/island-heights';
import type { World } from './core/contracts';
import type { LandTriangle } from './core/landform-study';
import { surfaceNormal } from './render/surface-projection';
import { createIslandSurface } from './render/island-surface';
import { MATERIAL_COLORS } from './render/island-textures';

const projectedArea = (triangles: readonly LandTriangle[]) => triangles
  .filter(triangle => triangle.plane === 'top')
  .reduce((sum, { vertices: [a, b, c] }) => sum + Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2, 0);
const signature = (triangles: readonly LandTriangle[]) => triangles.map(triangle => JSON.stringify({
  plane: triangle.plane, level: triangle.level, ascentId: triangle.ascentId,
  vertices: triangle.vertices.map(point => [point.x, point.y, point.z].map(value => Math.round(value * 1e7))).sort(),
})).sort();

describe('conditioned terrace-edge integration', () => {
  it('defaults to square terrace corners while retaining explicit conditioned comparisons', () => {
    const world = generateTerracedIslandWorld(77), before = structuredClone(world);
    const implicit = buildIslandLandform(world);
    const grid = buildIslandLandform(world, { conditionEdges: false });
    const conditioned = buildIslandLandform(world, { conditionEdges: true });
    expect(implicit.edges.enabled).toBe(false);
    expect(implicit.edges.patches).toEqual([]);
    expect(implicit.triangles).toEqual(grid.triangles);
    expect(conditioned.edges.patches.length).toBeGreaterThan(30);
    expect(implicit.ascents).toEqual(conditioned.ascents);
    expect(implicit.beach).toEqual(conditioned.beach);
    for (const triangle of implicit.triangles.filter(t => t.level > 0 && t.plane !== 'top' && t.ascentId === undefined)) {
      const normal = surfaceNormal(triangle);
      expect(Math.abs(normal.x) < 1e-6 || Math.abs(normal.y) < 1e-6).toBe(true);
    }
    expect(world).toEqual(before);
  });

  it.each([77, 91, 152941])('changes real inland geometry and height queries while protecting stairs and coast for seed %i', seed => {
    const world = generateTerracedIslandWorld(seed), before = structuredClone(world);
    const grid = buildIslandLandform(world, { conditionEdges: false, uplandShoulders: false });
    const island = buildIslandLandform(world, { conditionEdges: true });
    expect(island.edges.patches.length).toBeGreaterThan(30);
    expect(grid.edges.patches).toHaveLength(0);
    expect(island.ascents).toEqual(grid.ascents);
    expect(island.placements).toEqual(grid.placements);
    expect(signature(island.triangles.filter(triangle => triangle.ascentId !== undefined)))
      .toEqual(signature(grid.triangles.filter(triangle => triangle.ascentId !== undefined)));
    const landArea = world.cells.reduce((sum, cell) => sum + cell * world.tileSize ** 2, 0);
    expect(projectedArea(island.triangles)).toBeCloseTo(landArea, 5);
    expect(projectedArea(grid.triangles)).toBeCloseTo(landArea, 5);
    for (const patch of island.edges.patches) {
      const point = {
        x: patch.polygon.reduce((sum, p) => sum + p.x, 0) / patch.polygon.length,
        y: patch.polygon.reduce((sum, p) => sum + p.y, 0) / patch.polygon.length,
      };
      expect(islandSurfaceHeight(world, patch.cell, point, island.ascents, island.edges, island.beach, island.shoulders)).toBe(islandHeightAtLevel(world, patch.toLevel));
      expect(islandSurfaceHeight(world, patch.cell, point, grid.ascents, grid.edges, grid.beach, grid.shoulders)).toBe(islandHeightAtLevel(world, patch.fromLevel));
    }
    const diagonalFaces = island.triangles.filter(triangle => triangle.plane !== 'top' && triangle.ascentId === undefined)
      .filter(triangle => {
        const normal = surfaceNormal(triangle);
        return Math.abs(normal.x) > 0.1 && Math.abs(normal.y) > 0.1;
      });
    expect(diagonalFaces.length).toBeGreaterThan(0);
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        const index = y * world.width + x;
        if (!world.cells[index]) continue;
        const coastal = [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) =>
          x + dx < 0 || y + dy < 0 || x + dx >= world.width || y + dy >= world.height
          || !world.cells[(y + dy) * world.width + x + dx]);
        if (!coastal) continue;
        for (const fraction of [0.1, 0.5, 0.9]) {
          const point = { x: (x + fraction) * world.tileSize, y: (y + fraction) * world.tileSize };
          expect(islandSurfaceHeight(world, { x, y }, point, island.ascents, island.edges, island.beach, island.shoulders))
            .toBe(islandSurfaceHeight(world, { x, y }, point, grid.ascents, grid.edges, grid.beach, grid.shoulders));
        }
      }
    }
    expect(world).toEqual(before);
  });

  it('restores grassy lips, soil bands and rock below, retaining stair risers', () => {
    const world: World = {
      seed: 12, width: 16, height: 16, tileSize: 4, seaLevel: 0,
      generatorVersion: 'rim-fixture', provenance: 'test-fixture',
      heights: new Float32Array(256).fill(0.5), cells: new Uint8Array(256).fill(1),
      elevations: new Uint8Array(256), elevationHeights: [0, 8],
      rampIds: new Int32Array(256).fill(-1), ramps: [],
    };
    const surface = createIslandSurface(world);
    const wall: LandTriangle = {
      vertices: [{ x: 16, y: 16, z: 8 }, { x: 16, y: 16, z: 0 }, { x: 32, y: 16, z: 0 }],
      plane: 'light', level: 1, wallTop: 8, wallBottom: 0,
    };
    const lip = surface.regions(wall, { x: 24, y: 16, z: 7.8 });
    expect(lip).toEqual(MATERIAL_COLORS[surface.material(24, 16.25)]);
    expect(surface.regions(wall, { x: 24, y: 16, z: 6.8 })).toEqual(MATERIAL_COLORS.soil);
    expect(surface.regions(wall, { x: 24, y: 16, z: 6 })).toEqual(MATERIAL_COLORS.rock);
    const coastal: LandTriangle = { ...wall, level: 0, wallTop: 0, wallBottom: -4 };
    expect(surface.regions(coastal, { x: 24, y: 16, z: -1.5 })).toEqual(MATERIAL_COLORS.soil);
    expect(surface.regions({ ...wall, ascentId: 0 }, { x: 24, y: 16, z: 7.8 })).toEqual(MATERIAL_COLORS.soil);
    const other: LandTriangle = { ...wall, vertices: [wall.vertices[0], wall.vertices[2], { x: 32, y: 16, z: 8 }] };
    expect(surface.regions(wall, { x: 24, y: 16, z: 6 })).toEqual(surface.regions(other, { x: 24, y: 16, z: 6 }));
    for (const depth of [0.74, 1.78]) {
      const before = { x: 24, y: 16, z: 8 - depth - 1e-12 };
      const after = { ...before, z: 8 - depth + 1e-12 };
      expect(surface.regions(wall, before)).toEqual(surface.regions(wall, after));
      expect(surface.shade(wall, before)).toEqual(surface.shade(wall, after));
    }
  });
});
