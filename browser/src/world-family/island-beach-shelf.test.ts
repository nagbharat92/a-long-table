import { describe, expect, it } from 'vitest';
import type { Point, World } from './core/contracts';
import { createIslandAscents, type IslandAscent } from './core/island-ascents';
import { createIslandBeachShelf, ISLAND_BEACH_HEIGHTS, islandBeachHeightAt, type IslandBeachShelf } from './core/island-beach-shelf';
import { ISLAND_WATER_HEIGHT } from './core/island-water-level';
import { createIslandCove, type IslandCove } from './core/island-cove';
import { generateTerracedIslandWorld } from './core/island-terraces';
import { createIslandShoreField } from './render/island-shore-field';
import { ISLAND_SEABED_HEIGHTS } from './core/island-seabed';

function fixture(): World {
  const width = 16, height = 16;
  const cells = new Uint8Array(width * height);
  const heights = new Float32Array(cells.length).fill(-0.7);
  for (let y = 2; y < 14; y++) {
    for (let x = 2; x < 14; x++) {
      cells[y * width + x] = 1;
      heights[y * width + x] = 0.06;
    }
  }
  return {
    seed: 77, generatorVersion: 'beach-fixture', provenance: 'test-fixture',
    width, height, tileSize: 4, seaLevel: 0, cells, heights,
    elevations: new Uint8Array(cells.length), rampIds: new Int32Array(cells.length).fill(-1), ramps: [],
  };
}

const area = (vertices: readonly Point[]) => vertices.reduce((sum, a, i) => {
  const b = vertices[(i + 1) % vertices.length];
  return sum + a.x * b.y - a.y * b.x;
}, 0) / 2;

function checkCellCoverageAndQueries(world: World, shelf: IslandBeachShelf): void {
  for (const [index, surfaces] of shelf.landSurfaces) {
    const cell = { x: index % world.width, y: Math.floor(index / world.width) };
    expect(surfaces.reduce((sum, surface) => sum + area(surface.vertices), 0)).toBeCloseTo(world.tileSize ** 2);
    for (const surface of surfaces) {
      expect(surface.level).toBe(0);
      expect(surface.vertices).toHaveLength(4);
      expect(new Set(surface.vertices.map(vertex => vertex.z)).size).toBe(1);
      expect(area(surface.vertices)).toBeGreaterThan(0);
      const centroid = surface.vertices.reduce((sum, p) => ({
        x: sum.x + p.x / 4, y: sum.y + p.y / 4, z: sum.z + p.z / 4,
      }), { x: 0, y: 0, z: 0 });
      expect(islandBeachHeightAt(world, shelf, cell, centroid)).toBeCloseTo(centroid.z, 10);
      for (const vertex of surface.vertices) {
        expect(Object.values(vertex).every(Number.isFinite)).toBe(true);
        expect(vertex.z).toBeLessThanOrEqual(0);
        expect(vertex.z).toBeGreaterThanOrEqual(ISLAND_WATER_HEIGHT);
        expect(vertex.x).toBeGreaterThanOrEqual(cell.x * world.tileSize);
        expect(vertex.x).toBeLessThanOrEqual((cell.x + 1) * world.tileSize);
        expect(vertex.y).toBeGreaterThanOrEqual(cell.y * world.tileSize);
        expect(vertex.y).toBeLessThanOrEqual((cell.y + 1) * world.tileSize);
        expect(ISLAND_BEACH_HEIGHTS).toContain(vertex.z);
      }
    }
  }
}

describe('island beach grade and submerged shelf snapshot', () => {
  it('keeps the beach entry while replacing the cove bed with broad flat underwater steps', () => {
    const source = generateTerracedIslandWorld(153025);
    const { cove: prototype } = createIslandCove(source, createIslandAscents(source));
    const cove: IslandCove = {
      ...prototype, center: { x: -60, y: 30 }, radius: { x: 68, y: 200 }, rotation: 0,
    };
    const shelf = createIslandBeachShelf(fixture(), [], cove);
    const row = shelf.seabed.cells.filter(cell => cell.y === 14 && cell.x < 4);
    expect(row.some(cell => cell.x === 3 && cell.level === 0)).toBe(true);
    expect(row.some(cell => cell.x < -8)).toBe(true);
    expect(new Set(row.map(cell => cell.level)).size).toBeGreaterThanOrEqual(3);
    expect(islandBeachHeightAt(fixture(), shelf, { x: 2, y: 7 }, { x: 8, y: 30 })).toBe(ISLAND_WATER_HEIGHT);
  });

  it('leaves the original beach and seabed exactly unchanged outside cove influence', () => {
    const world = fixture();
    const cove: IslandCove = {
      center: { x: -1000, y: -1000 }, radius: { x: 56, y: 40 }, rotation: 0,
      gradeWidth: 24, shelfWidth: 52, shelfDepth: 2, focus: { x: 0, y: 0 },
    };
    expect(createIslandBeachShelf(world, [], cove)).toEqual(createIslandBeachShelf(world, []));
  });

  it('uses broad flat treads between the unchanged dry ground and waterline', () => {
    const world = fixture(), shelf = createIslandBeachShelf(world, []);
    const cell = { x: 2, y: 7 };
    const at = (x: number) => islandBeachHeightAt(world, shelf, cell, { x, y: 30 })!;
    expect(at(8)).toBe(ISLAND_WATER_HEIGHT);
    expect(at(9)).toBe(at(8));
    expect(at(9.9)).toBe(at(8));
    expect(at(11)).toBeGreaterThanOrEqual(at(10));
    expect(shelf.landSurfaces.get(7 * world.width + 2)).toHaveLength(4);
    expect(islandBeachHeightAt(world, shelf, { x: 5, y: 7 }, { x: 22, y: 30 }) ?? 0).toBe(0);
    expect(islandBeachHeightAt(world, shelf, { x: 7, y: 7 }, { x: 30, y: 30 })).toBeUndefined();
    checkCellCoverageAndQueries(world, shelf);
  });

  it('queries flat tread interiors exactly and uses the upper tread at riser boundaries', () => {
    const world = fixture(), shelf = createIslandBeachShelf(world, []);
    let risers = 0;
    for (const [index, surfaces] of shelf.landSurfaces) {
      const cell = { x: index % world.width, y: Math.floor(index / world.width) };
      for (const surface of surfaces) {
        const [a, b, , d] = surface.vertices;
        for (const [dx, dy] of [[0.2, 0.3], [1.8, 1.7], [0.7, 1.2]]) {
          expect(islandBeachHeightAt(world, shelf, cell, { x: a.x + dx, y: a.y + dy })).toBe(a.z);
        }
        const neighbor = surfaces.find(other => other.vertices[0].x === b.x && other.vertices[0].y === a.y);
        if (neighbor && neighbor.vertices[0].z !== a.z) {
          expect(islandBeachHeightAt(world, shelf, cell, { x: b.x, y: (a.y + d.y) / 2 }))
            .toBe(Math.max(a.z, neighbor.vertices[0].z));
          risers++;
        }
      }
    }
    expect(risers).toBeGreaterThan(0);
  });

  it('keeps grassy rock coast, inland sand, elevated sand and source ramps untouched', () => {
    const world = fixture();
    for (let y = 2; y < 14; y++) world.heights[y * world.width + 13] = 0.35;
    world.elevations![7 * world.width + 2] = 1;
    world.rampIds![9 * world.width + 2] = 0;
    const shelf = createIslandBeachShelf(world, []);
    for (const cell of [{ x: 13, y: 7 }, { x: 7, y: 7 }, { x: 2, y: 7 }, { x: 2, y: 9 }]) {
      expect(shelf.landSurfaces.has(cell.y * world.width + cell.x)).toBe(false);
    }
    // Adjacent modified cells retain zero at their shared edge with excluded land.
    expect(islandBeachHeightAt(world, shelf, { x: 2, y: 6 }, { x: 9, y: 28 })).toBe(0);
    for (const triangle of shelf.underwaterTriangles) {
      const x = triangle.vertices.reduce((sum, p) => sum + p.x / 3, 0);
      const y = triangle.vertices.reduce((sum, p) => sum + p.y / 3, 0);
      if (y > 24 && y < 40) expect(x).toBeLessThan(56);
    }
    const grassOnly = fixture();
    for (let i = 0; i < grassOnly.cells.length; i++) {
      if (grassOnly.cells[i]) grassOnly.heights[i] = 0.35;
    }
    const rock = createIslandBeachShelf(grassOnly, []);
    expect(rock.landSurfaces.size).toBe(0);
    expect(rock.underwaterTriangles).toHaveLength(0);
  });

  it('protects actual ascent bounds, landings and a two-unit support buffer', () => {
    const world = fixture();
    const ascent: IslandAscent = {
      id: 0, kind: 'stairs', origin: { x: 10, y: 24 }, direction: { x: 1, y: 0 },
      upperLevel: 1, lowerLevel: 0, upperHeight: 20, lowerHeight: 0,
      length: 10, topWidth: 8, bottomWidth: 8, stepCount: 5, sections: [],
      bounds: { x: 10, y: 24, width: 10, height: 8 },
    };
    const shelf = createIslandBeachShelf(world, [ascent]);
    for (let y = 5; y <= 8; y++) {
      for (let x = 2; x <= 5; x++) expect(shelf.landSurfaces.has(y * world.width + x)).toBe(false);
    }
    expect(shelf.landSurfaces.has(3 * world.width + 2)).toBe(true);
  });

  it('retains the jagged XY outline and every source buffer without mutation', () => {
    const world = fixture();
    for (const [x, y] of [[2, 5], [2, 6], [3, 6], [11, 13]]) world.cells[y * world.width + x] = 0;
    world.elevationHeights = [0, 20, 48];
    const before = structuredClone(world), shelf = createIslandBeachShelf(world, []);
    expect(world).toEqual(before);
    for (const [index, surfaces] of shelf.landSurfaces) {
      expect(world.cells[index]).toBe(1);
      const cx = index % world.width, cy = Math.floor(index / world.width);
      for (const { vertices } of surfaces) for (const p of vertices) {
        expect(p.x >= cx * 4 && p.x <= (cx + 1) * 4 && p.y >= cy * 4 && p.y <= (cy + 1) * 4).toBe(true);
      }
    }
    expect(islandBeachHeightAt(world, shelf, { x: 3, y: 5 }, { x: 12, y: 22 })).toBe(ISLAND_WATER_HEIGHT);
    checkCellCoverageAndQueries(world, shelf);
  });

  it('joins cell edges exactly and tolerates boundary roundoff', () => {
    const world = fixture(), shelf = createIslandBeachShelf(world, []);
    for (const y of [28, 29, 30, 31, 32]) {
      const point = { x: 8, y };
      const cell = { x: 2, y: Math.min(7, Math.floor(y / 4)) };
      expect(islandBeachHeightAt(world, shelf, cell, point)).toBe(ISLAND_WATER_HEIGHT);
    }
    const a = { x: 2, y: 6 }, b = { x: 2, y: 7 };
    for (const x of [8, 8.5, 9.5, 10, 11, 12]) {
      expect(islandBeachHeightAt(world, shelf, a, { x, y: 28 + 1e-9 }))
        .toBeCloseTo(islandBeachHeightAt(world, shelf, b, { x, y: 28 - 1e-9 })!, 8);
    }
  });

  it('emits bounded water-only solid shelves with flat tops, sidewalls and closed undersides', () => {
    const world = fixture(), shelf = createIslandBeachShelf(world, []), shore = createIslandShoreField(world);
    expect(shelf.underwaterTriangles.length).toBeGreaterThan(0);
    expect(shelf.underwaterTriangles.length).toBeLessThan(5000);
    let coastVertices = 0, outerVertices = 0;
    for (const triangle of shelf.underwaterTriangles) {
      expect(triangle.level).toBe(0);
      expect(triangle.submerged).toBe(true);
      if (triangle.plane === 'top') {
        expect(area(triangle.vertices)).toBeGreaterThan(0);
        expect(new Set(triangle.vertices.map(p => p.z)).size).toBe(1);
        expect(ISLAND_SEABED_HEIGHTS).toContain(triangle.vertices[0].z);
      }
      const center = triangle.vertices.reduce((sum, p) => ({ x: sum.x + p.x / 3, y: sum.y + p.y / 3 }), { x: 0, y: 0 });
      const cx = Math.floor(center.x / 4), cy = Math.floor(center.y / 4);
      if (area(triangle.vertices) !== 0 && cx >= 0 && cy >= 0 && cx < world.width && cy < world.height) {
        expect(world.cells[cy * world.width + cx]).toBe(0);
      }
      for (const p of triangle.vertices) {
        expect(Object.values(p).every(Number.isFinite)).toBe(true);
        expect(p.z).toBeLessThanOrEqual(ISLAND_WATER_HEIGHT);
        const distance = shore.sample(p.x, p.y).beachDistance;
        expect(distance).toBeLessThanOrEqual(40);
        if (triangle.plane === 'top' && distance === 0) { coastVertices++; expect(p.z).toBe(ISLAND_WATER_HEIGHT); }
        if (triangle.plane === 'top' && distance >= 14) { outerVertices++; expect(p.z).toBeLessThan(ISLAND_WATER_HEIGHT); }
      }
    }
    expect(coastVertices).toBeGreaterThan(0);
    expect(outerVertices).toBeGreaterThan(0);
    expect(shelf.underwaterTriangles.some(t => area(t.vertices) === 0)).toBe(true);
    expect(shelf.underwaterTriangles.some(t => area(t.vertices) < 0)).toBe(true);
  });

  it('is deterministic, cloneable and queryable after cloning', () => {
    const world = fixture(), shelf = createIslandBeachShelf(world, []);
    expect(createIslandBeachShelf(world, [])).toEqual(shelf);
    const clone = structuredClone(shelf);
    expect(clone).toEqual(shelf);
    expect(islandBeachHeightAt(world, clone, { x: 2, y: 7 }, { x: 9, y: 30 }))
      .toBe(islandBeachHeightAt(world, shelf, { x: 2, y: 7 }, { x: 9, y: 30 }));
  });

  it('rejects invalid construction and query inputs explicitly', () => {
    const world = fixture(), shelf = createIslandBeachShelf(world, []);
    for (const tileSize of [0, 3, NaN]) expect(() => createIslandBeachShelf({ ...world, tileSize }, [])).toThrow(RangeError);
    for (const gradeWidth of [0, NaN, Infinity]) expect(() => createIslandBeachShelf(world, [], {
      center: { x: 0, y: 0 }, radius: { x: 20, y: 20 }, rotation: 0,
      gradeWidth, shelfWidth: 16, shelfDepth: 2, focus: { x: 0, y: 0 },
    })).toThrow(RangeError);
    for (const cell of [{ x: -1, y: 2 }, { x: 2.5, y: 2 }, { x: 16, y: 2 }]) {
      expect(() => islandBeachHeightAt(world, shelf, cell, { x: 8, y: 8 })).toThrow(RangeError);
    }
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(() => islandBeachHeightAt(world, shelf, { x: 2, y: 7 }, { x: value, y: 30 })).toThrow(RangeError);
    }
    expect(() => islandBeachHeightAt(world, shelf, { x: 2, y: 7 }, { x: 18, y: 30 })).toThrow(RangeError);
  });

  it.each([77, 91, 152941, 902479])('keeps generated seed %i bounded and its ascent supports unchanged', seed => {
    const world = generateTerracedIslandWorld(seed), ascents = createIslandAscents(world);
    const before = structuredClone(world), shelf = createIslandBeachShelf(world, ascents);
    expect(world).toEqual(before);
    expect(shelf.landSurfaces.size).toBeGreaterThan(0);
    expect(shelf.underwaterTriangles.length).toBeGreaterThan(0);
    expect(shelf.underwaterTriangles.length).toBeLessThan(50000);
    for (const [index, surfaces] of shelf.landSurfaces) {
      const x = index % world.width, y = Math.floor(index / world.width);
      for (const { bounds } of ascents) {
        expect((x + 1) * 4 > bounds.x - 2 && x * 4 < bounds.x + bounds.width + 2
          && (y + 1) * 4 > bounds.y - 2 && y * 4 < bounds.y + bounds.height + 2).toBe(false);
      }
      for (const surface of surfaces) expect(area(surface.vertices)).toBeGreaterThan(0);
    }
  });
});
