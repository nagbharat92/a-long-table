import { beforeAll, describe, expect, it } from 'vitest';
import type { World } from './core/contracts';
import { createIslandBeachShelf } from './core/island-beach-shelf';
import { createIslandTerraceEdges } from './core/island-terrace-edges';
import { generateIslandLandform, islandSurfaceHeight, type IslandLandform } from './core/island-landform';
import { activeIslandLandTriangles, classifyTriangleLayer, islandMeshLayers } from './core/island-layers';
import { createIslandUplandShoulders, islandShoulderHeightAt } from './core/island-upland-shoulders';
import { openMeshEdges } from './core/mesh-boundaries';

const preserved = [12, 71, 77, 91, 153025, 902479] as const;
const islands = new Map<number, IslandLandform>();
beforeAll(() => { for (const seed of preserved) islands.set(seed, generateIslandLandform(seed, { naturalAscent: false })); });
const area = (triangles: readonly { plane: string; vertices: readonly { x: number; y: number }[] }[]) =>
  triangles.reduce((sum, triangle) => {
    const [a, b, c] = triangle.vertices;
    return sum + (triangle.plane === 'top' ? ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2 : 0);
  }, 0);

function fixture(): World {
  const width = 64, height = 64;
  return {
    width, height, seed: 77, tileSize: 4, seaLevel: 0, generatorVersion: 'shoulder-fixture', provenance: 'test-fixture',
    cells: new Uint8Array(width * height).fill(1), heights: new Float32Array(width * height).fill(0.5),
    elevations: Uint8Array.from({ length: width * height }, (_, i) =>
      Number(i % width >= 24 && i % width < 40 && Math.floor(i / width) >= 24 && Math.floor(i / width) < 40)),
    elevationHeights: [0, 16], rampIds: new Int32Array(width * height).fill(-1), ramps: [],
  };
}

describe('restrained attached Upland shoulders', () => {
  it.each(preserved)('preserves the exact source world, beach/seabed and constrained stair geometry on seed %i', seed => {
    const island = islands.get(seed)!;
    const baseline = generateIslandLandform(seed, { uplandShoulders: false, naturalAscent: false });
    expect(island.world).toEqual(baseline.world);
    expect(island.ascents).toEqual(baseline.ascents);
    expect(island.edges).toEqual(baseline.edges);
    expect(island.beach).toEqual(baseline.beach);
    const preservedTriangles = (value: IslandLandform) => value.triangles.filter(triangle =>
      classifyTriangleLayer(triangle) === 'beaches' || triangle.ascentId !== undefined)
      .map(triangle => JSON.stringify(triangle)).sort();
    expect(preservedTriangles(island)).toEqual(preservedTriangles(baseline));
  });

  it.each(preserved)('adds at most one low, connected partial shoulder per mass on seed %i', seed => {
    const island = islands.get(seed)!, { world, shoulders } = island, size = world.tileSize;
    expect(shoulders.patches.length).toBeGreaterThan(0);
    expect(new Set(shoulders.patches.map(patch => patch.mass)).size).toBe(shoulders.patches.length);
    let count = 0;
    for (const patch of shoulders.patches) {
      expect(patch.cells.length).toBeGreaterThanOrEqual(16);
      expect(patch.cells.length).toBeLessThanOrEqual(patch.parentCells.length * 0.4);
      expect(patch.height).toBeGreaterThan(0);
      expect(patch.height).toBeLessThan(world.elevationHeights![patch.parentLevel]);
      const cells = new Set(patch.cells), parent = new Set(patch.parentCells), reached = new Set([patch.cells[0]]), queue = [...reached];
      let contact = 0, perimeter = 0;
      const neighbors = (index: number) => [index - 1, index + 1, index - world.width, index + world.width];
      for (let cursor = 0; cursor < queue.length; cursor++) for (const next of neighbors(queue[cursor])) {
        if (cells.has(next) && !reached.has(next)) { reached.add(next); queue.push(next); }
      }
      expect(reached.size).toBe(cells.size);
      for (const index of patch.parentCells) for (const next of neighbors(index)) {
        if (!parent.has(next)) perimeter++;
        if (cells.has(next)) contact++;
      }
      expect(contact).toBeGreaterThanOrEqual(4);
      expect(contact).toBeLessThanOrEqual(perimeter * 0.35);
      for (const index of patch.cells) {
        count++;
        expect(world.elevations![index]).toBe(0);
        expect(island.beach.landSurfaces.has(index)).toBe(false);
        const x = index % world.width, y = Math.floor(index / world.width);
        for (const { bounds } of island.ascents) {
          expect((x + 1) * size > bounds.x - size * 2 && x * size < bounds.x + bounds.width + size * 2
            && (y + 1) * size > bounds.y - size * 2 && y * size < bounds.y + bounds.height + size * 2).toBe(false);
        }
        for (const [dx, dy] of [[0.1, 0.3], [0.5, 0.5], [0.9, 0.7]]) {
          const point = { x: (x + dx) * size, y: (y + dy) * size };
          expect(islandSurfaceHeight(world, { x, y }, point, island.ascents, island.edges, island.beach, shoulders)).toBe(patch.height);
          expect(islandShoulderHeightAt(world, structuredClone(shoulders), { x, y }, point)).toBe(patch.height);
        }
        expect(shoulders.byCell.get(index)!.vertices.every(p => p.z === patch.height)).toBe(true);
      }
    }
    expect(shoulders.byCell.size).toBe(count);
  });

  it.each(preserved)('joins shoulder tops/walls and includes the whole footprint in Solo Uplands on seed %i', seed => {
    const island = islands.get(seed)!, layers = islandMeshLayers(island), landArea = island.world.cells.reduce((sum, cell) => sum + cell * 16, 0);
    expect(area(layers.uplands.standaloneTriangles)).toBeCloseTo(area(layers.uplands.triangles), 6);
    for (const uplands of [false, true]) for (const beaches of [false, true]) {
      expect(area(activeIslandLandTriangles(island, { base: true, uplands, beaches }))).toBeCloseTo(landArea, 6);
    }
    const edges = island.triangles.flatMap(triangle => {
      const points = triangle.vertices.map(p => ({ x: p.x + p.z * 0.173, y: p.y + p.z * 0.317, z: p.z }));
      return points.map((from, i) => ({ from, to: points[(i + 1) % 3] }));
    });
    expect(openMeshEdges(edges).every(edge => Math.abs(edge.from.z + 4) < 1e-7 && Math.abs(edge.to.z + 4) < 1e-7)).toBe(true);
  });

  it('preserves every existing summit surface and remains reproducible', () => {
    const island = islands.get(153025)!, reference = generateIslandLandform(153025, { uplandShoulders: false, naturalAscent: false });
    const summitTops = (value: IslandLandform) => value.triangles.filter(t => t.plane === 'top' && t.level > 0
      && t.ascentId === undefined && t.vertices.every(p => value.world.elevationHeights!.includes(p.z)));
    expect(summitTops(island)).toEqual(summitTops(reference));
    expect(generateIslandLandform(153025).shoulders).toEqual(island.shoulders);
    expect(reference.shoulders.patches).toEqual([]);
    expect(generateIslandLandform(41).shoulders.byCell.size).toBe(0);
  });

  it('skips constrained sites rather than making small fragments or stacking new tiers', () => {
    const world = fixture(), beach = createIslandBeachShelf(world, []), edges = createIslandTerraceEdges(world, [], false);
    const before = structuredClone(world);
    expect(createIslandUplandShoulders(world, [], beach, edges).patches).toHaveLength(1);
    expect(world).toEqual(before);
    const constrained = structuredClone(world);
    for (let i = 0; i < constrained.cells.length; i++) {
      const x = i % world.width, y = Math.floor(i / world.width);
      if (x < 22 || x > 41 || y < 22 || y > 41) constrained.cells[i] = 0;
    }
    expect(createIslandUplandShoulders(constrained, [], createIslandBeachShelf(constrained, []), edges).patches).toEqual([]);
    expect(() => islandShoulderHeightAt(world, { patches: [], byCell: new Map() }, { x: -1, y: 0 }, { x: 0, y: 0 })).toThrow(RangeError);
    expect(() => islandShoulderHeightAt(world, { patches: [], byCell: new Map() }, { x: 0, y: 0 }, { x: 5, y: 0 })).toThrow(RangeError);
  });
});
