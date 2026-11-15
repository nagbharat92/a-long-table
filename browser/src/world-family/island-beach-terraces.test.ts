import { beforeAll, describe, expect, it } from 'vitest';
import { createIslandBeachShelf, ISLAND_BEACH_HEIGHTS, islandBeachHeightAt } from './core/island-beach-shelf';
import { generateIslandLandform, type IslandLandform } from './core/island-landform';
import { islandMeshLayers } from './core/island-layers';
import { openMeshEdges } from './core/mesh-boundaries';

const seeds = [12, 71, 77, 91, 153025, 902479];
const islands = new Map<number, IslandLandform>();
beforeAll(() => { for (const seed of seeds) islands.set(seed, generateIslandLandform(seed)); });

describe('shallow, continuous beach terraces', () => {
  it.each(seeds)('uses only flat, shallow treads with complete land-cell coverage on seed %i', seed => {
    const island = islands.get(seed)!, { world, beach } = island;
    const levels = new Set<number>();
    for (const [index, surfaces] of beach.landSurfaces) {
      expect(surfaces).toHaveLength(world.tileSize ** 2 / 4);
      expect(world.cells[index]).toBe(1);
      const cell = { x: index % world.width, y: Math.floor(index / world.width) };
      const corners = new Set<string>();
      for (const { vertices } of surfaces) {
        const [a, b, c, d] = vertices;
        expect(vertices).toHaveLength(4);
        expect(vertices.every(p => p.z === a.z)).toBe(true);
        expect(ISLAND_BEACH_HEIGHTS).toContain(a.z);
        expect(b.x - a.x).toBe(2);
        expect(d.y - a.y).toBe(2);
        expect(c).toEqual({ x: b.x, y: d.y, z: a.z });
        levels.add(a.z);
        corners.add(`${a.x},${a.y}`);
        const center = { x: a.x + 1, y: a.y + 1 };
        expect(islandBeachHeightAt(world, beach, cell, center)).toBe(a.z);
      }
      expect(corners.size).toBe(surfaces.length);
    }
    expect([...levels].sort((a, b) => b - a)).toEqual(ISLAND_BEACH_HEIGHTS);
    const layers = islandMeshLayers(island);
    for (const triangle of layers.beaches.triangles.filter(t => t.plane === 'top')) {
      expect(triangle.vertices.every(p => p.z === triangle.vertices[0].z)).toBe(true);
    }
    expect(layers.beaches.triangles.length).toBeLessThan(beach.landSurfaces.size * 8);
  });

  it.each(seeds)('closes every internal tread and coastal join without overlapping walls on seed %i', seed => {
    const island = islands.get(seed)!;
    const edges = island.triangles.flatMap(triangle => {
      const points = triangle.vertices.map(p => ({ x: p.x + p.z * 0.173, y: p.y + p.z * 0.317, z: p.z }));
      return points.map((from, i) => ({ from, to: points[(i + 1) % 3] }));
    });
    const open = openMeshEdges(edges);
    expect(open.length).toBeGreaterThan(0);
    expect(open.every(edge => Math.abs(edge.from.z + 4) < 1e-7 && Math.abs(edge.to.z + 4) < 1e-7)).toBe(true);
  });

  it('keeps the same coastline while varying the actual terrace pattern with the seed', () => {
    const island = islands.get(153025)!, { world, ascents, coast } = island;
    const before = structuredClone(world);
    const first = createIslandBeachShelf(world, ascents, coast);
    expect(createIslandBeachShelf(world, ascents, coast).landSurfaces).toEqual(first.landSurfaces);
    const changed = createIslandBeachShelf({ ...world, seed: 77 }, ascents, coast);
    expect(changed.landSurfaces).not.toEqual(first.landSurfaces);
    expect(world).toEqual(before);
  });
});
