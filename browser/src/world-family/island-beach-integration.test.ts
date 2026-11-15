import { describe, expect, it } from 'vitest';
import type { World } from './core/contracts';
import { createIslandBeachShelf, islandBeachHeightAt } from './core/island-beach-shelf';
import { generateIslandLandform, islandSurfaceHeight } from './core/island-landform';
import { activeIslandLandTriangles, annotateLayerMesh, islandMeshLayers } from './core/island-layers';
import type { LandPoint, LandTriangle, LandVertex } from './core/landform-study';
import { optimizeLandformMesh } from './core/landform-mesh';
import { terrainAt } from './core/world';
import { ISLAND_WATER_HEIGHT } from './core/island-water-level';
import { applyGeometryOverlayColor, createDefaultLayersInspection } from './render/landform-diagnostics';
import { rasterLandform } from './render/landform-study';

const seeds = [12, 71, 77, 91, 153025, 902479];
const area = (vertices: readonly LandPoint[]) => vertices.reduce((sum, a, i) => {
  const b = vertices[(i + 1) % vertices.length];
  return sum + a.x * b.y - a.y * b.x;
}, 0) / 2;
const topArea = (triangles: readonly LandTriangle[]) => triangles.reduce((sum, triangle) =>
  sum + (triangle.plane === 'top' ? area(triangle.vertices) : 0), 0);

function rectangle(x: number, y: number, width: number, height: number, z = 0): LandTriangle[] {
  const a = { x, y, z }, b = { x: x + width, y, z };
  const c = { x: x + width, y: y + height, z }, d = { x, y: y + height, z };
  return [
    { vertices: [a, b, c], plane: 'top', level: 0 },
    { vertices: [a, c, d], plane: 'top', level: 0 },
  ];
}

function contains(points: readonly LandPoint[], point: LandPoint): boolean {
  const [a, b, c] = points;
  const d = 2 * area(points);
  if (Math.abs(d) < 1e-8) return false;
  const u = ((point.x - a.x) * (c.y - a.y) - (point.y - a.y) * (c.x - a.x)) / d;
  const v = ((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)) / d;
  return u >= -1e-7 && v >= -1e-7 && u + v <= 1 + 1e-7;
}

function wallContains(triangle: LandTriangle, point: LandVertex): boolean {
  const alongY = triangle.vertices.every(p => Math.abs(p.x - point.x) < 1e-7);
  const alongX = triangle.vertices.every(p => Math.abs(p.y - point.y) < 1e-7);
  if (!alongX && !alongY) return false;
  return contains(triangle.vertices.map(p => ({ x: alongY ? p.y : p.x, y: p.z })), {
    x: alongY ? point.y : point.x, y: point.z,
  });
}

function sandySquare(): World {
  const width = 16, height = 16, cells = new Uint8Array(width * height);
  const heights = new Float32Array(cells.length).fill(-0.7);
  for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) {
    cells[y * width + x] = 1;
    heights[y * width + x] = x === 13 ? 0.35 : 0.06;
  }
  return {
    seed: 77, generatorVersion: 'beach-join-fixture', provenance: 'test-fixture',
    width, height, tileSize: 4, seaLevel: 0, cells, heights,
    elevations: new Uint8Array(cells.length), rampIds: new Int32Array(cells.length).fill(-1), ramps: [],
  };
}

describe('complete beach construction', () => {
  it.each(seeds)('owns the full coastal footprint and restores Base reversibly for seed %i', seed => {
    const island = generateIslandLandform(seed), before = structuredClone(island);
    const layers = islandMeshLayers(island);
    const footprint = [...island.beach.landSurfaces.values()].flat();
    const footprintArea = footprint.reduce((sum, surface) => sum + area(surface.vertices), 0);
    expect(footprint.every(surface => surface.layer === 'beaches')).toBe(true);
    expect(topArea(layers.beaches.triangles)).toBeCloseTo(footprintArea, 6);
    expect(topArea(layers.beaches.standaloneTriangles)).toBeCloseTo(footprintArea, 6);
    expect(footprint.some(surface => surface.vertices.every(p => p.z === 0))).toBe(true);
    let dryBackCells = 0;
    island.coast!.beachCells!.forEach((owned, index) => {
      if (!owned) return;
      const surfaces = island.beach.landSurfaces.get(index);
      expect(surfaces).toBeDefined();
      if (surfaces!.every(surface => surface.vertices.every(p => p.z === 0))) dryBackCells++;
    });
    expect(dryBackCells).toBeGreaterThan(0);
    const landArea = island.world.cells.reduce((sum, cell) => sum + cell * island.world.tileSize ** 2, 0);
    for (const uplands of [false, true]) for (const beaches of [false, true]) {
      const active = activeIslandLandTriangles(island, { base: true, uplands, beaches });
      expect(topArea(active)).toBeCloseTo(landArea, 5);
      expect(topArea(active.filter(t => t.layer === 'beaches'))).toBeCloseTo(beaches ? footprintArea : 0, 6);
    }
    expect(island).toEqual(before);
  });

  it('preserves beach ownership through coplanar optimization', () => {
    const source = [
      ...rectangle(0, 0, 4, 4).map(t => ({ ...t, layer: 'base' as const })),
      ...rectangle(4, 0, 4, 4).map(t => ({ ...t, layer: 'beaches' as const })),
    ];
    const optimized = optimizeLandformMesh(source);
    expect(topArea(optimized.filter(t => t.layer === 'base'))).toBe(16);
    expect(topArea(optimized.filter(t => t.layer === 'beaches'))).toBe(16);
  });

  it('keeps protected ground dry and joins stepped sand to the unchanged waterline shelf', () => {
    const world = sandySquare(), before = structuredClone(world);
    const shelf = createIslandBeachShelf(world, [], {
      center: { x: 30, y: 30 }, radius: { x: 200, y: 200 }, rotation: 0,
      gradeWidth: 3, shelfWidth: 16, shelfDepth: 12, focus: { x: 30, y: 30 },
    });
    const at = (x: number) => islandBeachHeightAt(world, shelf, { x: Math.min(12, Math.floor(x / 4)), y: 2 }, { x, y: 8 })!;
    expect(at(52)).toBe(0);
    expect(at(50)).toBeGreaterThan(-0.5);
    expect(Math.abs(at(50) - at(52)) / 2).toBeLessThan(0.25);
    expect(at(36)).toBe(ISLAND_WATER_HEIGHT);
    expect(at(44)).toBeGreaterThanOrEqual(ISLAND_WATER_HEIGHT);
    const join = shelf.underwaterTriangles.filter(t => t.plane === 'top').flatMap(t => t.vertices)
      .filter(p => p.y === 8 && p.x >= 44 && p.x <= 52);
    expect(join.length).toBeGreaterThan(0);
    expect(join.every(p => Math.abs(p.z - ISLAND_WATER_HEIGHT) < 1e-7)).toBe(true);
    expect(shelf.underwaterTriangles.every(t => t.vertices.every(p => p.z <= ISLAND_WATER_HEIGHT))).toBe(true);
    expect(world).toEqual(before);
  });

  it('removes the measured endpoint pinch without moving its protected ground vertex', () => {
    const island = generateIslandLandform(153025);
    const at = (x: number, y: number) => islandSurfaceHeight(island.world,
      { x: Math.floor(x / 4), y: Math.floor(y / 4) }, { x, y }, island.ascents, island.edges, island.beach, island.shoulders);
    expect(at(288, 56)).toBe(0);
    expect(at(288, 54)).toBeGreaterThan(-0.7);
    expect(Math.abs(at(288, 54) - at(288, 56)) / 2).toBeLessThan(0.35);
  });

  it.each(seeds)('connects each emitted shoreline shelf to beach tops or the coastal face for seed %i', seed => {
    const island = generateIslandLandform(seed), { world } = island, size = world.tileSize;
    const bedTops = island.beach.underwaterTriangles.filter(triangle => triangle.plane === 'top');
    const walls = island.triangles.filter(t => t.plane !== 'top');
    const land = (x: number, y: number) => x >= 0 && y >= 0 && x < world.width && y < world.height && !!world.cells[y * world.width + x];
    let joined = 0;
    for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
      const index = y * world.width + x, cell = { x, y };
      if (!land(x, y) || terrainAt(world, cell) !== 'sand' || world.elevations![index] || world.rampIds![index] >= 0) continue;
      const l = x * size, r = l + size, t = y * size, b = t + size;
      for (const [nx, ny, ax, ay, bx, by] of [
        [x - 1, y, l, t, l, b], [x + 1, y, r, t, r, b],
        [x, y - 1, l, t, r, t], [x, y + 1, l, b, r, b],
      ]) {
        if (land(nx, ny)) continue;
        for (let f = 0; f < 1; f += 2 / size) {
          const point = (fraction: number) => ({ x: ax + (bx - ax) * fraction, y: ay + (by - ay) * fraction });
          const p = { ...point(f + 1 / size), z: ISLAND_WATER_HEIGHT };
          const bed = bedTops.find(triangle => contains(triangle.vertices, p));
          if (!bed) continue;
          expect(bed.vertices.every(vertex => vertex.z === ISLAND_WATER_HEIGHT)).toBe(true);
          const top = islandSurfaceHeight(world, cell, p, island.ascents, island.edges, island.beach, island.shoulders);
          expect(Math.abs(top - p.z) < 1e-7 || walls.some(wall => wallContains(wall, p))).toBe(true);
          joined++;
        }
      }
    }
    expect(joined).toBeGreaterThan(100);
  });
});

describe('exposed mesh boundary segments', () => {
  it('cancels a long edge against two shorter joined edges', () => {
    const source = [...rectangle(0, 0, 2, 4), ...rectangle(2, 0, 2, 2), ...rectangle(2, 2, 2, 2)];
    const before = structuredClone(source), result = annotateLayerMesh(source, 'beaches');
    expect(result.boundaries.reduce((sum, e) => sum + Math.hypot(e.to.x - e.from.x, e.to.y - e.from.y), 0)).toBe(16);
    expect(result.boundaries.some(e => e.from.x === 2 && e.to.x === 2)).toBe(false);
    expect(source).toEqual(before);
  });

  it('draws only the exposed portion of a partially shared edge in both renderers', () => {
    const { triangles, boundaries } = annotateLayerMesh([...rectangle(0, 0, 20, 40), ...rectangle(20, 0, 20, 20)], 'beaches');
    const exposed = boundaries.filter(e => e.from.x === 20 && e.to.x === 20);
    expect(exposed).toEqual([{ from: { x: 20, y: 20, z: 0 }, to: { x: 20, y: 40, z: 0 } }]);
    const owner = triangles.find(t => t.boundarySegments?.some(e => e.from.x === 20 && e.to.x === 20))!;
    const layers = createDefaultLayersInspection();
    layers.beaches.boundaries = true;
    const clay = [184, 190, 194];
    expect(applyGeometryOverlayColor(owner, { x: 20, y: 10, z: 0 }, clay, layers.beaches)).toEqual(clay);
    expect(applyGeometryOverlayColor(owner, { x: 20, y: 30, z: 0 }, clay, layers.beaches)).toEqual([238, 108, 77]);
    const raster = rasterLandform('plan', {
      water: [0, 0, 0], top: clay, light: clay, middle: clay, dark: clay, levels: [clay],
    }, [], { triangles, viewport: { width: 44, height: 44, origin: { x: 0, y: 0 } }, diagnostics: { layers } });
    const pixel = (x: number, y: number) => [...raster.pixels.slice((y * 44 + x) * 4, (y * 44 + x) * 4 + 3)];
    expect(pixel(19, 10)).toEqual(clay);
    expect(pixel(19, 30)).toEqual([238, 108, 77]);
  });

  it('does not cancel edges at different heights or misidentify sloped and rotated joins', () => {
    const stacked = annotateLayerMesh([...rectangle(0, 0, 4, 4), ...rectangle(0, 0, 4, 4, 8)], 'uplands');
    expect(stacked.boundaries.reduce((sum, e) => sum + Math.hypot(e.to.x - e.from.x, e.to.y - e.from.y), 0)).toBe(32);
    const source = [...rectangle(0, 0, 2, 4), ...rectangle(2, 0, 2, 2), ...rectangle(2, 2, 2, 2)].map(t => ({
      ...t, vertices: t.vertices.map(p => ({
        x: p.x * Math.cos(0.37) - p.y * Math.sin(0.37),
        y: p.x * Math.sin(0.37) + p.y * Math.cos(0.37), z: p.x * 0.25,
      })) as [LandVertex, LandVertex, LandVertex],
    }));
    const result = annotateLayerMesh(source, 'beaches');
    expect(result.boundaries.reduce((sum, e) => sum + Math.hypot(e.to.x - e.from.x, e.to.y - e.from.y), 0)).toBeCloseTo(16, 7);
  });

  it('cancels restored slope edges even when equivalent z-intercepts round differently', () => {
    const source: LandTriangle[] = [
      { plane: 'top', level: 0, vertices: [
        { x: 230, y: 44, z: -2.3632812499999973 }, { x: 228, y: 44, z: -2.499999999999999 },
        { x: 228, y: 42, z: -2.7 },
      ] },
      { plane: 'top', level: 0, vertices: [
        { x: 228, y: 44, z: -2.5 }, { x: 230, y: 44, z: -2.36328125 },
        { x: 230, y: 46, z: -2.1 },
      ] },
    ];
    const { boundaries } = annotateLayerMesh(source, 'beaches');
    expect(boundaries.some(e => e.from.y === 44 && e.to.y === 44)).toBe(false);
  });
});
