import { describe, expect, it } from 'vitest';
import type { World } from './core/contracts';
import { generateIslandLandform } from './core/island-landform';
import type { LandTriangle } from './core/landform-study';
import { ISLAND_WATER_HEIGHT } from './core/island-water-level';
import { BEACH_WASH_MAX_HEIGHT, BEACH_WASH_PERIOD, beachWaveAt, shoreWaveWeight } from './render/island-beach-wash';
import { createIslandShoreField } from './render/island-shore-field';
import type { IslandShoreField } from './render/island-shore-field';
import { createIslandShoreMesh, SHORE_MESH_STRIDE, shoreMeshSample, shoreMeshTriangles } from './render/island-shore-mesh';
import { rasterLandform } from './render/landform-study';

function fixture(beach = true): World {
  const cells = new Uint8Array(256);
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) cells[y * 16 + x] = 1;
  return {
    seed: 153025, generatorVersion: 'shore-mesh-test', provenance: 'test-fixture',
    width: 16, height: 16, tileSize: 4, seaLevel: 0,
    cells, heights: new Float32Array(256).fill(beach ? 0.012 : 1),
    elevations: new Uint8Array(256), rampIds: new Int32Array(256).fill(-1), ramps: [],
  };
}

describe('beach-local water geometry', () => {
  it('appends continuous beach-weight derivatives without changing the preceding attribute layout or tessellation', () => {
    const world = fixture(), actual = createIslandShoreField(world);
    const shore: IslandShoreField = {
      distance: (x, y) => actual.distance(x, y),
      sample: (x, y) => ({ ...actual.sample(x, y), beachWeight: 0.72 + x * 0.001 + y * 0.002 }),
    };
    const mesh = createIslandShoreMesh(world, shore);
    expect(SHORE_MESH_STRIDE).toBe(10);
    expect(mesh.vertices.length % (SHORE_MESH_STRIDE * 3)).toBe(0);
    for (let i = 0; i < mesh.vertices.length; i += SHORE_MESH_STRIDE) {
      const p = mesh.vertices.subarray(i, i + SHORE_MESH_STRIDE), sample = shore.sample(p[0], p[1]);
      expect([...p.slice(0, 6)]).toEqual([...new Float32Array([
        p[0], p[1], sample.distance, sample.beachWeight, sample.phase, sample.breakup,
      ])]);
      expect(p[6]).toBeCloseTo(shore.distance(p[0] + 0.5, p[1]) - shore.distance(p[0] - 0.5, p[1]), 6);
      expect(p[7]).toBeCloseTo(shore.distance(p[0], p[1] + 0.5) - shore.distance(p[0], p[1] - 0.5), 6);
      expect(p[8]).toBeCloseTo(0.001, 9);
      expect(p[9]).toBeCloseTo(0.002, 9);
    }
    const triangles = shoreMeshTriangles(mesh, 3.2);
    for (const triangle of triangles) {
      const [a, b, c] = triangle.vertices;
      expect(Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))).toBe(1);
      const centre = shoreMeshSample(triangle, { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3, z: 0 });
      expect(centre.length).toBe(10);
      expect(centre[8]).toBeCloseTo(0.001, 9);
      expect(centre[9]).toBeCloseTo(0.002, 9);
    }
  });

  it('builds a finite, non-overlapping coastal band with different local directions on all four shores', () => {
    const world = fixture(), before = structuredClone(world);
    const shore = createIslandShoreField(world), mesh = createIslandShoreMesh(world, shore);
    expect(mesh.vertices.length).toBeGreaterThan(1000);
    expect(mesh.vertices.every(Number.isFinite)).toBe(true);
    const directions = new Set<string>(), centers = new Set<string>();
    for (let i = 0; i < mesh.vertices.length; i += SHORE_MESH_STRIDE * 3) {
      const points = [0, 1, 2].map(n => mesh.vertices.subarray(i + n * SHORE_MESH_STRIDE));
      const key = `${points.reduce((s, p) => s + p[0], 0)}:${points.reduce((s, p) => s + p[1], 0)}`;
      expect(centers.has(key)).toBe(false);
      centers.add(key);
      for (const p of points) {
        if (p[3] < 0.99 || Math.abs(p[2] - 3) > 0.01) continue;
        if (Math.abs(p[6]) > 0.99 && Math.abs(p[7]) < 0.01) directions.add(p[6] > 0 ? 'east' : 'west');
        if (Math.abs(p[7]) > 0.99 && Math.abs(p[6]) < 0.01) directions.add(p[7] > 0 ? 'south' : 'north');
      }
    }
    expect(directions.size).toBe(4);
    expect(world).toEqual(before);
    expect(createIslandShoreMesh(world, shore).vertices).toEqual(mesh.vertices);
  });

  it('moves an approaching crest toward decreasing offshore distance and reuses the run-up clock', () => {
    const first = beachWaveAt(10, 0, 1, BEACH_WASH_PERIOD * 0.05);
    const next = beachWaveAt(5, 0, 1, BEACH_WASH_PERIOD * 0.15);
    expect(first.front).toBeGreaterThan(next.front + 5);
    expect(beachWaveAt(first.front + 0.9, 0, 1, BEACH_WASH_PERIOD * 0.05).height)
      .toBeGreaterThan(ISLAND_WATER_HEIGHT + 0.1);
    const world = fixture(), mesh = createIslandShoreMesh(world, createIslandShoreField(world));
    const frames = [0, 1.28, 2.56, 3.84].map(time => shoreMeshTriangles(mesh, time));
    expect(frames[0].some((triangle, i) => triangle.vertices.some((p, v) => p.z !== frames[1][i].vertices[v].z))).toBe(true);
    for (const triangles of frames) for (const triangle of triangles) {
      for (const p of triangle.vertices) {
        expect(p.z).toBeGreaterThanOrEqual(ISLAND_WATER_HEIGHT);
        expect(p.z).toBeLessThanOrEqual(BEACH_WASH_MAX_HEIGHT);
      }
      expect(shoreMeshSample(triangle, triangle.vertices[0])).toEqual(triangle.shore[0]);
    }
    expect(shoreMeshTriangles(mesh, 2560)).toEqual(frames[0]);
    expect(shoreWaveWeight(0, 1)).toBe(1);
    expect(shoreWaveWeight(18, 1)).toBe(0);
    expect(shoreWaveWeight(0, 0.6)).toBe(0);
  });

  it('keeps phase constant across a straight beach so the approaching crest reaches its own run-up', () => {
    const world = fixture(), shore = createIslandShoreField(world);
    for (const point of [{ x: 32, y: 16 }, { x: 16, y: 32 }, { x: 48, y: 32 }, { x: 32, y: 48 }]) {
      const dx = point.x === 16 ? -1 : point.x === 48 ? 1 : 0;
      const dy = point.y === 16 ? -1 : point.y === 48 ? 1 : 0;
      const phase = shore.sample(point.x, point.y).phase;
      for (const distance of [-6, -2, 0, 4, 8, 12]) {
        expect(shore.sample(point.x + dx * distance, point.y + dy * distance).phase).toBeCloseTo(phase, 7);
      }
    }
  });

  it('keeps the front coherent along each full beach and around corners', () => {
    const world = fixture(), shore = createIslandShoreField(world);
    const mesh = createIslandShoreMesh(world, shore);
    const coastal = [];
    for (let i = 0; i < mesh.vertices.length; i += SHORE_MESH_STRIDE) {
      const point = mesh.vertices.subarray(i, i + SHORE_MESH_STRIDE);
      if (Math.abs(point[2]) < 0.01 && point[3] > 0.99) coastal.push(point);
    }
    expect(coastal.length).toBeGreaterThan(100);
    for (let i = 0; i < mesh.vertices.length; i += SHORE_MESH_STRIDE) {
      const point = mesh.vertices.subarray(i, i + SHORE_MESH_STRIDE);
      expect(point[3]).toBe(1);
      expect(point[8]).toBe(0);
      expect(point[9]).toBe(0);
    }
    for (const cycle of [0.16, 0.18, 0.2, 0.22, 0.24]) {
      const fronts = coastal.map(point => beachWaveAt(point[2], point[4], point[3], cycle * BEACH_WASH_PERIOD).front);
      expect(Math.max(...fronts) - Math.min(...fronts)).toBeLessThan(0.8);
    }
  });

  it('staggers the generated review island instead of giving all shores the same phase', () => {
    const { world } = generateIslandLandform(153025), shore = createIslandShoreField(world);
    const phases = new Set<number>();
    const land = (x: number, y: number) => x >= 0 && y >= 0 && x < world.width && y < world.height
      && !!world.cells[y * world.width + x];
    for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
      if (!land(x, y)) continue;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        if (land(x + dx, y + dy)) continue;
        const px = (x + 0.5 + dx * 0.5) * world.tileSize;
        const py = (y + 0.5 + dy * 0.5) * world.tileSize;
        const sample = shore.sample(px, py);
        if (sample.beachWeight <= 0.6) continue;
        phases.add(sample.phase);
        for (const distance of [0.5, 1, 2]) {
          expect(shore.sample(px + dx * distance, py + dy * distance).phase).toBe(sample.phase);
        }
      }
    }
    expect(phases.size).toBeGreaterThan(1);
    expect((Math.max(...phases) - Math.min(...phases)) * BEACH_WASH_PERIOD).toBeGreaterThan(1);
  });

  it('does not allocate beach geometry for cliffs or empty worlds and rejects invalid dimensions', () => {
    const world = fixture(false);
    expect(createIslandShoreMesh(world, createIslandShoreField(world)).vertices.length).toBe(0);
    world.cells.fill(0);
    expect(createIslandShoreMesh(world, createIslandShoreField(world)).vertices.length).toBe(0);
    expect(() => createIslandShoreMesh({ ...world, width: 0 }, createIslandShoreField(world))).toThrow('dimensions');
    expect(() => shoreMeshTriangles({ vertices: new Float32Array() }, NaN)).toThrow('finite');
    expect(() => shoreMeshTriangles({ vertices: new Float32Array() }, 0, 0.049)).toThrow('end softness');
  });

  it('allows softness changes to alter only displacement, not source geometry, phase, attributes or triangle count', () => {
    const world = fixture(), actual = createIslandShoreField(world);
    const shore: IslandShoreField = {
      distance: (x, y) => actual.distance(x, y),
      sample: (x, y) => ({ ...actual.sample(x, y), beachWeight: 0.75, phase: 0 }),
    };
    const mesh = createIslandShoreMesh(world, shore), before = mesh.vertices.slice();
    const narrow = shoreMeshTriangles(mesh, 3.2, 0.05), broad = shoreMeshTriangles(mesh, 3.2, 0.4);
    expect(narrow.length).toBe(broad.length);
    expect(narrow.some((triangle, i) => triangle.vertices.some((point, v) => point.z > broad[i].vertices[v].z))).toBe(true);
    for (let i = 0; i < narrow.length; i++) {
      for (let v = 0; v < 3; v++) {
        expect([narrow[i].vertices[v].x, narrow[i].vertices[v].y]).toEqual([broad[i].vertices[v].x, broad[i].vertices[v].y]);
        expect(narrow[i].shore[v]).toEqual(broad[i].shore[v]);
      }
    }
    expect(mesh.vertices).toEqual(before);
  });

  it('discards transparent fragments before they can hide geometry behind them in the software reference', () => {
    const far: LandTriangle = {
      vertices: [{ x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }, { x: 0, y: 8, z: 0 }],
      level: 0, plane: 'top',
    };
    const near: LandTriangle = { ...far, level: 1, vertices: [
      { ...far.vertices[0], z: 8 }, { ...far.vertices[1], z: 8 }, { ...far.vertices[2], z: 8 },
    ] };
    const color = [0, 0, 0] as const;
    for (const triangles of [[near, far], [far, near]]) {
      const raster = rasterLandform('plan', {
        water: color, top: color, light: color, middle: color, dark: color, levels: [color, color],
      }, [], {
        triangles, viewport: { width: 10, height: 10, origin: { x: 0, y: 0 } }, shadePlan: true,
        shade: triangle => triangle === near ? undefined : [31, 87, 95],
      });
      expect(raster.depth[22]).toBe(0);
      expect([...raster.pixels.subarray(88, 91)]).toEqual([31, 87, 95]);
    }
  });
});
