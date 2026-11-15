import { describe, expect, it } from 'vitest';
import type { Point, Rectangle, World } from './core/contracts';
import { createIslandAscents, type IslandAscent } from './core/island-ascents';
import { islandHeightAtLevel } from './core/island-heights';
import {
  createIslandTerraceEdges, islandEdgeLevelAt,
  type IslandTerraceEdges,
} from './core/island-terrace-edges';
import { generateTerracedIslandWorld } from './core/island-terraces';

const area = (polygon: readonly Point[]) => polygon.reduce((sum, p, i) => {
  const q = polygon[(i + 1) % polygon.length];
  return sum + p.x * q.y - q.x * p.y;
}, 0) / 2;
const cross = (a: Point, b: Point, p: Point) =>
  (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
const centroid = (polygon: Point[]): Point => ({
  x: polygon.reduce((sum, p) => sum + p.x, 0) / polygon.length,
  y: polygon.reduce((sum, p) => sum + p.y, 0) / polygon.length,
});
const rectangle = (rect: Rectangle): Point[] => [
  { x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y },
  { x: rect.x + rect.width, y: rect.y + rect.height },
  { x: rect.x, y: rect.y + rect.height },
];

function intersectionArea(subject: Point[], clip: Point[]): number {
  let polygon = subject;
  for (let edge = 0; edge < clip.length; edge++) {
    const a = clip[edge], b = clip[(edge + 1) % clip.length];
    const output: Point[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i], q = polygon[(i + 1) % polygon.length];
      const cp = cross(a, b, p), cq = cross(a, b, q);
      if (cp >= 0) output.push(p);
      if ((cp >= 0) !== (cq >= 0)) {
        const t = cp / (cp - cq);
        output.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      }
    }
    polygon = output;
  }
  return Math.abs(area(polygon));
}

function fixture(fill = false, low = 0, high = 1): World {
  const width = 12, height = 12;
  return {
    seed: 0, width, height, tileSize: 4, seaLevel: 0,
    heights: new Float32Array(width * height).fill(0.7),
    cells: new Uint8Array(width * height).fill(1),
    elevations: Uint8Array.from({ length: width * height }, (_, i) =>
      ((i % width >= 5 && Math.floor(i / width) >= 5) !== fill) ? high : low),
    elevationHeights: [0, 8, 24, 32], ramps: [],
    provenance: 'test-fixture', generatorVersion: 'terrace-edge-test',
  };
}

function reservation(bounds: Rectangle): IslandAscent {
  return {
    id: 0, kind: 'stairs', origin: { x: bounds.x, y: bounds.y },
    direction: { x: 1, y: 0 }, upperLevel: 1, lowerLevel: 0,
    upperHeight: 8, lowerHeight: 0, length: bounds.width,
    topWidth: bounds.height, bottomWidth: bounds.height, stepCount: 4,
    sections: [], bounds,
  };
}

function verifyGeometry(world: World, edges: IslandTerraceEdges): void {
  const size = world.tileSize;
  expect(edges.patches.length).toBe(edges.cutCorners + edges.fillCorners);
  expect([...edges.byCell.values()].flat()).toHaveLength(edges.patches.length);
  for (const patch of edges.patches) {
    const { cell, polygon, fromLevel, toLevel } = patch;
    expect(area(polygon)).toBeCloseTo(size * size / 8);
    expect(polygon).toHaveLength(3);
    expect(fromLevel).toBe(world.elevations![cell.y * world.width + cell.x]);
    expect(toLevel - fromLevel).toBe(patch.kind === 'cut' ? -1 : 1);
    for (const p of polygon) {
      expect(p.x).toBeGreaterThanOrEqual(cell.x * size);
      expect(p.x).toBeLessThanOrEqual((cell.x + 1) * size);
      expect(p.y).toBeGreaterThanOrEqual(cell.y * size);
      expect(p.y).toBeLessThanOrEqual((cell.y + 1) * size);
    }
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        expect(cell.x + dx >= 0 && cell.x + dx < world.width
          && cell.y + dy >= 0 && cell.y + dy < world.height).toBe(true);
        expect(world.cells[(cell.y + dy) * world.width + cell.x + dx]).toBe(1);
      }
    }
    expect(islandEdgeLevelAt(world, edges, cell, centroid(polygon))).toBe(toLevel);
    expect(islandEdgeLevelAt(world, edges, cell, {
      x: (cell.x + 0.5) * size, y: (cell.y + 0.5) * size,
    })).toBe(fromLevel);
  }
  // Distinct cells have disjoint interiors by containment; check every same-cell pair.
  for (const [index, patches] of edges.byCell) {
    expect(patches.length).toBeLessThanOrEqual(4);
    for (const [i, patch] of patches.entries()) {
      expect(index).toBe(patch.cell.y * world.width + patch.cell.x);
      for (const other of patches.slice(i + 1)) {
        expect(intersectionArea(patch.polygon, other.polygon)).toBeLessThan(1e-8);
      }
    }
  }
}

function verifyReservations(world: World, edges: IslandTerraceEdges, ascents: IslandAscent[]): void {
  const size = world.tileSize;
  const bounds = [
    ...ascents.map(ascent => ascent.bounds),
    ...world.ramps!.map(ramp => ({
      x: ramp.rect.x * size, y: ramp.rect.y * size,
      width: ramp.rect.width * size, height: ramp.rect.height * size,
    })),
  ];
  for (const bound of bounds) {
    const expanded = {
      x: bound.x - size, y: bound.y - size,
      width: bound.width + 2 * size, height: bound.height + 2 * size,
    };
    for (const patch of edges.patches) {
      expect(intersectionArea(patch.polygon, rectangle(expanded))).toBeLessThan(1e-8);
    }
    // Sample complete reservations, including their buffered approaches/landings.
    for (let y = expanded.y; y <= expanded.y + expanded.height; y += size / 2) {
      for (let x = expanded.x; x <= expanded.x + expanded.width; x += size / 2) {
        const cell = { x: Math.floor(x / size), y: Math.floor(y / size) };
        if (cell.x < 0 || cell.y < 0 || cell.x >= world.width || cell.y >= world.height) continue;
        expect(islandEdgeLevelAt(world, edges, cell, { x, y }))
          .toBe(world.elevations![cell.y * world.width + cell.x]);
      }
    }
  }
}

describe('pure V2 inland terrace-edge field', () => {
  it.each([false, true])('exchanges real plan area with a CCW half-cell chamfer (fill=%s)', fill => {
    const world = fixture(fill), edges = createIslandTerraceEdges(world, []);
    expect(edges.patches).toHaveLength(1);
    const patch = edges.patches[0];
    expect(patch.cell).toEqual({ x: 5, y: 5 });
    expect(patch.kind).toBe(fill ? 'fill' : 'cut');
    expect(patch.fromLevel).toBe(fill ? 0 : 1);
    expect(patch.toLevel).toBe(fill ? 1 : 0);
    expect(patch.polygon).toEqual([{ x: 20, y: 20 }, { x: 22, y: 20 }, { x: 20, y: 22 }]);
    verifyGeometry(world, edges);
    // An actual diagonal replaces two orthogonal legs, not just material shading.
    expect(Math.hypot(patch.polygon[1].x - patch.polygon[2].x,
      patch.polygon[1].y - patch.polygon[2].y)).toBeCloseTo(Math.sqrt(8));
    expect(area(patch.polygon)).toBe(2);
    expect(islandEdgeLevelAt(world, edges, patch.cell, { x: 20.25, y: 20.25 })).toBe(patch.toLevel);
    expect(islandEdgeLevelAt(world, edges, patch.cell, { x: 21.25, y: 21.25 })).toBe(patch.fromLevel);
  });

  it('joins successive diagonal staircase chamfers at edge midpoints without overlaps', () => {
    const world = fixture();
    world.elevations = Uint8Array.from(world.elevations!, (_, i) =>
      Number(i % world.width >= Math.floor(i / world.width)));
    const edges = createIslandTerraceEdges(world, []);
    expect(edges.cutCorners).toBeGreaterThan(5);
    expect(edges.fillCorners).toBeGreaterThan(5);
    verifyGeometry(world, edges);
    const vertexCounts = new Map<string, number>();
    for (const patch of edges.patches) {
      for (const p of patch.polygon.slice(1)) {
        const key = `${p.x},${p.y}`;
        vertexCounts.set(key, (vertexCounts.get(key) ?? 0) + 1);
      }
    }
    expect([...vertexCounts.values()].filter(count => count === 2).length).toBeGreaterThan(8);
    for (const [i, patch] of edges.patches.entries()) {
      for (const other of edges.patches.slice(i + 1)) {
        expect(intersectionArea(patch.polygon, other.polygon)).toBeLessThan(1e-8);
      }
    }
  });

  it('leaves straight boundaries, saddles, multilevel corners and non-adjacent ranks alone', () => {
    const world = fixture();
    world.elevations = Uint8Array.from(world.elevations!, (_, i) => Number(i % world.width >= 5));
    expect(createIslandTerraceEdges(world, []).patches).toEqual([]);
    for (const levels of [[0, 1, 0, 1], [0, 1, 2, 1]]) {
      const local = fixture();
      for (const [i, cell] of [{ x: 4, y: 4 }, { x: 5, y: 4 }, { x: 5, y: 5 }, { x: 4, y: 5 }].entries()) {
        local.elevations![cell.y * local.width + cell.x] = levels[i];
      }
      expect(createIslandTerraceEdges(local, []).patches.some(p =>
        p.polygon[0].x === 20 && p.polygon[0].y === 20)).toBe(false);
    }
    expect(createIslandTerraceEdges(fixture(false, 0, 2), []).patches).toEqual([]);
  });

  it('rejects coastal cells and their entire eight-neighbor land buffer', () => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const world = fixture();
        world.cells[(5 + dy) * world.width + 5 + dx] = 0;
        const edges = createIslandTerraceEdges(world, []);
        expect(edges.patches).toEqual([]);
        expect(edges.protectedCorners).toBe(1);
      }
    }
    const world = fixture();
    world.elevations = Uint8Array.from(world.elevations!, (_, i) => Number(i % world.width < 1
      && Math.floor(i / world.width) < 1));
    expect(createIslandTerraceEdges(world, []).patches).toEqual([]);
  });

  it('rejects whole-patch overlap with expanded ascent bounds, not only the corner tip', () => {
    const world = fixture();
    const ascents = [reservation({ x: 25, y: 20, width: 1, height: 1 })];
    const edges = createIslandTerraceEdges(world, ascents);
    expect(edges.patches).toEqual([]);
    expect(edges.protectedCorners).toBe(1);
    const clear = createIslandTerraceEdges(world, [reservation({ x: 26, y: 26, width: 1, height: 1 })]);
    expect(clear.patches).toHaveLength(1);
    world.ramps!.push({
      rect: { x: 6.25, y: 5, width: 0.25, height: 0.25 },
      highCell: { x: 5, y: 5 }, lowCell: { x: 4, y: 5 },
      direction: { x: -1, y: 0 }, upperLevel: 1, lowerLevel: 0,
    });
    expect(createIslandTerraceEdges(world, []).patches).toEqual([]);
  });

  it.each([[0, 1], [1, 2], [2, 3]])('preserves arbitrary rank labels %i/%i and eight-unit metadata', (low, high) => {
    const world = fixture(false, low, high);
    world.elevationHeights = [0, 8, 16, 24];
    const edges = createIslandTerraceEdges(world, []);
    expect(edges.patches[0].fromLevel).toBe(high);
    expect(edges.patches[0].toLevel).toBe(low);
    expect(islandHeightAtLevel(world, high) - islandHeightAtLevel(world, low)).toBe(8);
    expect(islandEdgeLevelAt(world, edges, { x: 5, y: 5 }, { x: 20.5, y: 20.5 })).toBe(low);
    verifyGeometry(world, edges);
  });

  it('supports legacy height metadata without interpreting physical heights as ranks', () => {
    const world = fixture(false, 1, 2);
    delete world.elevationHeights;
    const edges = createIslandTerraceEdges(world, []);
    expect(edges.patches[0].fromLevel).toBe(2);
    expect(edges.patches[0].toLevel).toBe(1);
    expect(islandHeightAtLevel(world, edges.patches[0].toLevel)).toBe(20);
  });

  it('uses the bounded cell map for inclusive patch boundaries and original rank elsewhere', () => {
    const world = fixture(), edges = createIslandTerraceEdges(world, []);
    const patch = edges.patches[0];
    // A renderer/query can discard the global list and retain only the cell index.
    const lookup = { ...edges, patches: [] };
    for (const [i, a] of patch.polygon.entries()) {
      const b = patch.polygon[(i + 1) % patch.polygon.length];
      expect(islandEdgeLevelAt(world, lookup, patch.cell, a)).toBe(0);
      expect(islandEdgeLevelAt(world, lookup, patch.cell, {
        x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
      })).toBe(0);
    }
    expect(islandEdgeLevelAt(world, lookup, patch.cell, { x: 21.001, y: 21.001 })).toBe(1);
    expect(islandEdgeLevelAt(world, lookup, patch.cell, { x: 19, y: 20 })).toBe(1);
    expect(islandEdgeLevelAt(world, lookup, { x: 6, y: 6 }, { x: 24.5, y: 24.5 })).toBe(1);
  });

  it('disables to the untouched original rank grid', () => {
    const world = fixture(), edges = createIslandTerraceEdges(world, [], false);
    expect(edges).toEqual({
      enabled: false, patches: [], byCell: new Map(), cutCorners: 0, fillCorners: 0, protectedCorners: 0,
    });
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        expect(islandEdgeLevelAt(world, edges, { x, y }, { x: x * 4, y: y * 4 }))
          .toBe(world.elevations![y * world.width + x]);
      }
    }
  });

  it('rejects nonfinite points and invalid cells, even when disabled', () => {
    const world = fixture(), edges = createIslandTerraceEdges(world, [], false);
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(() => islandEdgeLevelAt(world, edges, { x: 5, y: 5 }, { x: value, y: 20 })).toThrow();
      expect(() => islandEdgeLevelAt(world, edges, { x: 5, y: 5 }, { x: 20, y: value })).toThrow();
    }
    for (const cell of [{ x: -1, y: 0 }, { x: 12, y: 0 }, { x: 0, y: 12 },
      { x: 1.5, y: 0 }, { x: NaN, y: 0 }, { x: 0, y: Infinity }]) {
      expect(() => islandEdgeLevelAt(world, edges, cell, { x: 20, y: 20 })).toThrow();
    }
  });

  it('fails explicitly for malformed active grids, ranks, height metadata and reservations', () => {
    const world = fixture();
    for (const tileSize of [0, -1, NaN, Infinity]) {
      expect(() => createIslandTerraceEdges({ ...world, tileSize }, [])).toThrow();
    }
    expect(() => createIslandTerraceEdges({ ...world, elevations: undefined }, [])).toThrow();
    expect(() => createIslandTerraceEdges({ ...world, cells: new Uint8Array(1) }, [])).toThrow();
    expect(() => createIslandTerraceEdges({ ...world, width: 1.5 }, [])).toThrow();
    expect(() => createIslandTerraceEdges({ ...world, elevationHeights: [0, 7] }, [])).toThrow();
    world.elevations![0] = 4;
    expect(() => createIslandTerraceEdges(world, [])).toThrow();
    expect(() => createIslandTerraceEdges(fixture(), [
      reservation({ x: NaN, y: 0, width: 1, height: 1 }),
    ])).toThrow();
  });

  it('is deterministic, nonmutating, structured-clonable and does not cache mutable worlds', () => {
    const world = fixture(), before = structuredClone(world);
    const ascents = [reservation({ x: 35, y: 35, width: 1, height: 1 })];
    const beforeAscents = structuredClone(ascents);
    const edges = createIslandTerraceEdges(world, ascents);
    expect(createIslandTerraceEdges(world, ascents)).toEqual(edges);
    expect(structuredClone(edges)).toEqual(edges);
    expect(world).toEqual(before);
    expect(ascents).toEqual(beforeAscents);
    expect(islandEdgeLevelAt(world, structuredClone(edges), { x: 5, y: 5 }, { x: 20.5, y: 20.5 })).toBe(0);
    world.elevations!.fill(1);
    expect(createIslandTerraceEdges(world, ascents).patches).toEqual([]);
    expect(edges.patches).toHaveLength(1);
  });

  it.each([77, 91, 152941])('conditions generated V2 outlines and preserves complete stair reservations: seed %i', seed => {
    const world = generateTerracedIslandWorld(seed), before = structuredClone(world);
    const ascents = createIslandAscents(world), edges = createIslandTerraceEdges(world, ascents);
    verifyGeometry(world, edges);
    verifyReservations(world, edges, ascents);
    expect(createIslandTerraceEdges(world, ascents)).toEqual(edges);
    expect(structuredClone(edges)).toEqual(edges);
    expect(world).toEqual(before);
    expect(edges.patches.length).toBeGreaterThan(10);
    console.info('terrace-edge statistics', {
      seed, heights: world.elevationHeights, cuts: edges.cutCorners, fills: edges.fillCorners,
      protected: edges.protectedCorners, ascents: ascents.length,
      changedArea: edges.patches.reduce((sum, patch) => sum + area(patch.polygon), 0),
    });
  });

  it('has bounded, meaningful coverage over seeds 0..127 without conditioning stairs or coasts', () => {
    let patches = 0, conditionedWorlds = 0, protectedCorners = 0;
    for (let seed = 0; seed <= 127; seed++) {
      const world = generateTerracedIslandWorld(seed), ascents = createIslandAscents(world);
      const edges = createIslandTerraceEdges(world, ascents);
      patches += edges.patches.length;
      conditionedWorlds += Number(edges.patches.length > 0);
      protectedCorners += edges.protectedCorners;
      verifyGeometry(world, edges);
      verifyReservations(world, edges, ascents);
    }
    expect(patches).toBeGreaterThan(128);
    expect(conditionedWorlds).toBeGreaterThan(80);
    expect(protectedCorners).toBeGreaterThan(0);
    console.info('terrace-edge sweep', { seeds: 128, patches, conditionedWorlds, protectedCorners });
  }, 120000);
});
