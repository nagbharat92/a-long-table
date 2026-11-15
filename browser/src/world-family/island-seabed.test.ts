import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateIslandLandform } from './core/island-landform';
import { islandMeshLayers } from './core/island-layers';
import { createIslandSeabed, ISLAND_SEABED_HEIGHTS } from './core/island-seabed';
import { ISLAND_WATER_HEIGHT } from './core/island-water-level';
import { openMeshEdges } from './core/mesh-boundaries';
import { createIslandShoreField } from './render/island-shore-field';

const preserved = [
  [12, '88f66d1b87387631eaea98d83bb09cd36aaf253e3ac24a346084b44c026461d1'],
  [71, 'a7bd982dd0d6320d7fb8903031cd3c92ea3add51c9fa715d9bae7a93584bf9ce'],
  [77, '9d258c95fd7fed2733e5c581e5ab093b4a5cdf9b71eecdcb4b0636944489f1d4'],
  [91, '13b032e471412f89987878f72ed9131d40abf2044406af449b8e6c2abedff88c'],
  [153025, '3726ac05135a9017f99acb260bdab0f79700855c6ec6d14980cf836f62a02c1e'],
  [902479, 'e72a2ab22f1ba7ebd8ea590b0652eb5ac3d5fad569f0ac8a1d2f48868d8d329d'],
] as const;

describe('first-pass stepped island seabeds', () => {
  it.each(preserved)('preserves the approved lower-upland seabed geometry for seed %i', (seed, hash) => {
    const island = generateIslandLandform(seed);
    const data = JSON.stringify(island.beach.seabed);
    expect(createHash('sha256').update(data).digest('hex')).toBe(hash);
  });

  it.each([12, 71, 77, 91, 153025, 902479])('builds attached solids and sparse lower fragments for seed %i', seed => {
    const island = generateIslandLandform(seed), { world } = island, bed = island.beach.seabed;
    expect(bed.cellSize).toBe(2);
    expect(bed.components.some(component => component.anchored)).toBe(true);
    const detached = bed.cells.filter(cell => !bed.components[cell.component].anchored);
    expect(detached.length).toBeGreaterThan(0);
    expect(detached.length).toBeLessThan(bed.cells.length * 0.1);
    for (const component of bed.components.filter(component => !component.anchored)) {
      expect(component.cellCount).toBeGreaterThanOrEqual(4);
      expect(component.cellCount).toBeLessThanOrEqual(48);
    }
    expect(detached.every(cell => cell.level >= 3)).toBe(true);
    for (const cell of bed.cells) {
      const x = (cell.x + 0.5) * bed.cellSize, y = (cell.y + 0.5) * bed.cellSize;
      const cx = Math.floor(x / world.tileSize), cy = Math.floor(y / world.tileSize);
      if (cx >= 0 && cy >= 0 && cx < world.width && cy < world.height) expect(world.cells[cy * world.width + cx]).toBe(0);
      if (cell.anchored) expect(cell.level).toBe(0);
    }
    expect(bed.triangles.length).toBeLessThan(bed.sourceTriangleCount * 0.5);
    expect(bed.triangles.length).toBeLessThan(12000);
    let upward = 0, downward = 0, walls = 0;
    for (const triangle of bed.triangles) {
      const [a, b, c] = triangle.vertices;
      const normal = [
        (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y),
        (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z),
        (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
      ];
      expect(normal.filter(value => Math.abs(value) > 1e-7)).toHaveLength(1);
      expect(triangle.submerged).toBe(true);
      for (const p of triangle.vertices) {
        expect(Object.values(p).every(Number.isFinite)).toBe(true);
        expect(p.x / 2).toBeCloseTo(Math.round(p.x / 2), 7);
        expect(p.y / 2).toBeCloseTo(Math.round(p.y / 2), 7);
        expect(p.z).toBeLessThanOrEqual(ISLAND_WATER_HEIGHT);
      }
      if (triangle.plane === 'top') {
        upward++;
        expect(normal[2]).toBeGreaterThan(0);
        expect(ISLAND_SEABED_HEIGHTS).toContain(a.z);
      } else if (normal[2] < 0) downward++;
      else walls++;
    }
    expect(Math.min(upward, downward, walls)).toBeGreaterThan(0);
    const edges = bed.triangles.flatMap(triangle => {
      const points = triangle.vertices.map(p => ({ x: p.x + p.z * 0.173, y: p.y + p.z * 0.317, z: p.z }));
      return points.map((from, i) => ({ from, to: points[(i + 1) % 3] }));
    });
    expect(openMeshEdges(edges)).toEqual([]);
    const layers = islandMeshLayers(island);
    expect(layers.seabed.triangles).toHaveLength(bed.triangles.length);
    expect(layers.seabed.boundaries.length).toBeGreaterThan(0);
  });

  it('varies the actual formation footprint with the seed while remaining repeatable', () => {
    const world = generateIslandLandform(153025).world, before = structuredClone(world);
    const shore = createIslandShoreField(world), a = createIslandSeabed(world, shore);
    expect(createIslandSeabed(world, shore)).toEqual(a);
    const changedSeed = { ...world, seed: 77 };
    expect(createIslandSeabed(changedSeed, createIslandShoreField(changedSeed)).cells).not.toEqual(a.cells);
    expect(world).toEqual(before);
  });
});
