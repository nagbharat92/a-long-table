import { describe, expect, it } from 'vitest';
import {
  createSteppedLandform, resolveSteppedLandformContacts, steppedLandformSurfaces,
  type SteppedLandformOptions, type SteppedLandformSample,
} from './core/stepped-landform';
import type { LandTriangle } from './core/landform-study';
import { openMeshEdges } from './core/mesh-boundaries';

const options: SteppedLandformOptions = {
  bounds: { x: -2, y: -2, width: 10, height: 8 }, cellSize: 2,
  heights: [0, -1, -3], floor: -5, minFragmentCells: 2, maxFragmentCells: 8,
  sample: (x, y) => x < 0 && y < 0 ? { level: 0, anchored: true } : undefined,
};

function signedVolume(triangles: readonly LandTriangle[]): number {
  return triangles.reduce((sum, { vertices: [a, b, c] }) => sum + (
    a.x * (b.y * c.z - b.z * c.y) + a.y * (b.z * c.x - b.x * c.z) + a.z * (b.x * c.y - b.y * c.x)
  ) / 6, 0);
}

function expectClosed(triangles: readonly LandTriangle[]): void {
  // Shear vertical edges into XY so the shared partial-edge matcher can inspect all faces.
  const edges = triangles.flatMap(triangle => {
    const points = triangle.vertices.map(p => ({ x: p.x + p.z * 0.173, y: p.y + p.z * 0.317, z: p.z }));
    return points.map((from, i) => ({ from, to: points[(i + 1) % 3] }));
  });
  expect(openMeshEdges(edges)).toEqual([]);
}

describe('shared stepped landform builder', () => {
  it('shares exact grid-cell surfaces between joined terrain patches and closed volumes', () => {
    const cells = [{ x: -1, y: 2, level: 1 }, { x: 0, y: 2, level: 0 }];
    const before = structuredClone(cells);
    const surfaces = steppedLandformSurfaces(cells, 2, [0, -0.5]);
    expect(surfaces).toEqual([
      { level: 1, vertices: [{ x: -2, y: 4, z: -0.5 }, { x: 0, y: 4, z: -0.5 }, { x: 0, y: 6, z: -0.5 }, { x: -2, y: 6, z: -0.5 }] },
      { level: 0, vertices: [{ x: 0, y: 4, z: 0 }, { x: 2, y: 4, z: 0 }, { x: 2, y: 6, z: 0 }, { x: 0, y: 6, z: 0 }] },
    ]);
    expect(cells).toEqual(before);
    expect(() => steppedLandformSurfaces(cells, 0, [0, -0.5])).toThrow(RangeError);
    expect(() => steppedLandformSurfaces(cells, 2, [NaN])).toThrow(RangeError);
    expect(() => steppedLandformSurfaces([{ x: 0, y: 0, level: -1 }], 2, [0])).toThrow(RangeError);
  });

  it('resolves terrain height saddles without removing cells or moving protected anchors', () => {
    for (const anchored of [false, true]) {
      const samples: SteppedLandformSample[] = [
        { level: 0, anchored }, { level: 2, anchored: false },
        { level: 2, anchored: false }, { level: 0, anchored },
      ];
      resolveSteppedLandformContacts(samples, 2, 2, 3, true);
      expect(samples.every(Boolean)).toBe(true);
      if (anchored) {
        expect(samples[0]).toEqual({ level: 0, anchored: true });
        expect(samples[3]).toEqual({ level: 0, anchored: true });
      }
      const heights = [0, -0.5, -1];
      const cells = samples.map((sample, i) => ({ x: i % 2, y: Math.floor(i / 2), level: sample.level }));
      const result = createSteppedLandform({
        ...options, bounds: { x: 0, y: 0, width: 2, height: 2 }, heights,
        sample: (x, y) => samples[Math.floor(y / 2) * 2 + Math.floor(x / 2)],
      });
      expect(result.cells).toHaveLength(cells.length);
      expectClosed(result.triangles);
    }
    expect(() => resolveSteppedLandformContacts([], 2, 2, 3, true)).toThrow(RangeError);
  });

  it('builds outward-facing closed volumes, culls internal walls and merges flat faces', () => {
    const result = createSteppedLandform(options);
    expect(result.cells).toHaveLength(4);
    expect(result.components).toEqual([{ anchored: true, cellCount: 4 }]);
    expect(result.triangles).toHaveLength(12);
    expect(result.sourceTriangleCount).toBe(32);
    expect(signedVolume(result.triangles)).toBeCloseTo(4 * 4 * 5, 8);
    expectClosed(result.triangles);
    for (const { vertices: [a, b, c] } of result.triangles) {
      const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
      const v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
      const normal = [u.y * v.z - u.z * v.y, u.z * v.x - u.x * v.z, u.x * v.y - u.y * v.x];
      expect(normal.filter(value => Math.abs(value) > 1e-8)).toHaveLength(1);
      const center = [(a.x + b.x + c.x) / 3 + 2, (a.y + b.y + c.y) / 3 + 2, (a.z + b.z + c.z) / 3 + 2.5];
      expect(normal.reduce((sum, value, i) => sum + value * center[i], 0)).toBeGreaterThan(0);
    }
  });

  it('preserves holes and multiple height tiers without duplicate interior faces', () => {
    const result = createSteppedLandform({
      ...options, bounds: { x: 0, y: 0, width: 5, height: 5 },
      sample: (x, y) => x > 4 && x < 6 && y > 4 && y < 6 ? undefined : { level: x < 4 ? 0 : 1, anchored: true },
    });
    expect(result.cells).toHaveLength(24);
    const expected = result.cells.reduce((sum, cell) => sum + (options.heights[cell.level] - options.floor) * 4, 0);
    expect(signedVolume(result.triangles)).toBeCloseTo(expected, 8);
    expectClosed(result.triangles);
    expect(result.triangles.length).toBeLessThan(result.sourceTriangleCount / 2);
  });

  it('uses four-neighbor components and retains only bounded detached clusters', () => {
    const result = createSteppedLandform({
      ...options, bounds: { x: 0, y: 0, width: 12, height: 3 },
      sample: (x, y) => y > 2 ? undefined
        : x < 2 ? { level: 0, anchored: true }
          : x >= 4 && x < 6 ? { level: 2, anchored: false }
            : x >= 8 && x < 12 ? { level: 2, anchored: false }
              : x >= 14 ? { level: 1, anchored: false } : undefined,
      maxFragmentCells: 4,
    });
    expect(result.components).toEqual([{ anchored: true, cellCount: 1 }, { anchored: false, cellCount: 2 }]);
    expect(result.cells.map(cell => cell.x)).toEqual([0, 4, 5]);
  });

  it('resolves diagonal contacts and height saddles without mutating sampled objects', () => {
    const high = { level: 0, anchored: false };
    const result = createSteppedLandform({
      ...options, bounds: { x: 0, y: 0, width: 3, height: 3 }, minFragmentCells: 1,
      sample: (x, y) => x > 4 && y < 2 ? undefined
        : (x < 2 && y < 2) || (x > 2 && x < 4 && y > 2 && y < 4) ? high
          : { level: 2, anchored: false },
    });
    expect(high).toEqual({ level: 0, anchored: false });
    expectClosed(result.triangles);
    expect(() => createSteppedLandform({
      ...options, bounds: { x: 0, y: 0, width: 2, height: 2 },
      sample: (x, y) => (x < 2) === (y < 2) ? { level: 0, anchored: true } : undefined,
    })).toThrow(/anchors/);
  });

  it('is deterministic, cloneable, accepts empty fields and reports invalid inputs', () => {
    expect(createSteppedLandform(options)).toEqual(createSteppedLandform(options));
    const empty = createSteppedLandform({ ...options, sample: () => undefined });
    expect(empty.cells).toEqual([]);
    expect(empty.triangles).toEqual([]);
    expect(structuredClone(empty)).toEqual(empty);
    for (const change of [
      { cellSize: 0 }, { floor: 1 }, { heights: [0, 1] }, { minFragmentCells: 0 },
      { maxFragmentCells: 1 }, { bounds: { x: 0, y: 0, width: 1001, height: 1000 } },
      { sample: () => ({ level: 4, anchored: true }) },
    ]) expect(() => createSteppedLandform({ ...options, ...change })).toThrow(RangeError);
  });
});
