import { describe, expect, it } from 'vitest';
import { generateIslandLandform } from './core/island-landform';
import type { LandTriangle } from './core/landform-study';
import { createIslandWaterDepth } from './render/island-water-depth';
import { WATER_MAX_DEPTH } from './render/island-water-color';
import { createIslandEnvironment } from './render/island-environment';
import { ISLAND_WATER_HEIGHT } from './core/island-water-level';

function rectangle(x: number, y: number, width: number, height: number, depth: number): LandTriangle[] {
  const z = ISLAND_WATER_HEIGHT - depth;
  const a = { x, y, z }, b = { x: x + width, y, z };
  const c = { x: x + width, y: y + height, z }, d = { x, y: y + height, z };
  const faces: LandTriangle['vertices'][] = [[a, b, c], [a, c, d]];
  return faces.map(vertices => ({
    vertices, plane: 'top', level: 0, submerged: depth >= 0,
  }));
}

describe('world-space water bathymetry', () => {
  it('feathers finite beds in world space before their silhouette while keeping broad interiors clear', () => {
    const field = createIslandWaterDepth(rectangle(0, 0, 24, 24, 2));
    expect(field.bedVisibility(-0.5, 12.5)).toBe(0);
    expect(field.bedVisibility(0.5, 12.5)).toBeLessThan(0.03);
    expect(field.bedVisibility(2.5, 12.5)).toBeCloseTo(0.5);
    expect(field.bedVisibility(6.5, 12.5)).toBe(1);
    expect(field.bedVisibility(12.5, 12.5)).toBe(1);
    let previous = 0;
    for (let x = -0.5; x <= 6.5; x += 0.125) {
      const next = field.bedVisibility(x, 12.5);
      expect(next).toBeGreaterThanOrEqual(previous);
      expect(next - previous).toBeLessThan(0.04);
      previous = next;
    }
    expect(field.sample(0.5, 12.5)).toBe(2);
  });

  it('softens body-water depth transitions without modifying actual shelf depths', () => {
    const field = createIslandWaterDepth([
      ...rectangle(0, 0, 24, 24, 0.75),
      ...rectangle(24, 0, 24, 24, 3.5),
    ]);
    expect(field.sample(23.5, 12.5)).toBe(0.75);
    expect(field.sample(24.5, 12.5)).toBe(3.5);
    expect(field.bodyDepth(23.5, 12.5)).toBeGreaterThan(1.5);
    expect(field.bodyDepth(24.5, 12.5)).toBeLessThan(2.5);
    expect(field.bodyDepth(12.5, 12.5)).toBe(0.75);
    let previous = field.bodyDepth(20.5, 12.5);
    for (let x = 20.625; x <= 27.5; x += 0.125) {
      const next = field.bodyDepth(x, 12.5);
      expect(next - previous).toBeGreaterThanOrEqual(0);
      expect(next - previous).toBeLessThan(0.05);
      previous = next;
    }
  });

  it('does not feather a wet bed merely because it meets dry terrain', () => {
    const field = createIslandWaterDepth([
      ...rectangle(0, 0, 24, 24, -4),
      ...rectangle(24, 0, 24, 24, 0.75),
    ]);
    expect(field.bedVisibility(24.5, 12.5)).toBe(1);
    expect(field.bedVisibility(12.5, 12.5)).toBe(0);
  });

  it('does not interpolate dry-ground visibility back into a submerged step corner', () => {
    const field = createIslandWaterDepth([
      ...rectangle(0, 0, 24, 48, 0),
      ...rectangle(24, 0, 24, 24, -4),
      ...rectangle(24, 24, 24, 24, 0.75),
    ]);
    expect(field.bedVisibility(24, 24)).toBeLessThan(0.1);
    expect(field.bedVisibility(24.5, 12.5)).toBe(0);
    expect(field.bedVisibility(23.5, 12.5)).toBe(1);
    expect(field.bedVisibility(23.5, 24.5)).toBe(0);
    expect(field.bedVisibility(24.5, 24.5)).toBe(0);
  });

  it.each([false, true])('feathers both sides of internal shallow steps without changing broad interiors (transposed %s)', transpose => {
    const source = [
      ...rectangle(0, 0, 24, 48, 0),
      ...rectangle(24, 0, 24, 48, 0.75),
      ...rectangle(48, 0, 24, 48, 2),
    ];
    const swap = ({ x, y, z }: LandTriangle['vertices'][0]) => ({ x: y, y: x, z });
    const triangles = transpose ? source.map((triangle): LandTriangle => ({
      ...triangle, vertices: [swap(triangle.vertices[0]), swap(triangle.vertices[2]), swap(triangle.vertices[1])],
    })) : source;
    const before = structuredClone(triangles);
    const field = createIslandWaterDepth(triangles);
    const visibility = (x: number) => transpose ? field.bedVisibility(24.5, x) : field.bedVisibility(x, 24.5);
    for (const boundary of [24, 48]) {
      for (let x = boundary - 0.5; x <= boundary + 0.5; x += 0.125) expect(visibility(x)).toBe(0);
      for (const direction of [-1, 1]) {
        let previous = 0;
        for (let distance = 0.5; distance <= 3.5; distance += 0.125) {
          const next = visibility(boundary + direction * distance);
          expect(next).toBeGreaterThanOrEqual(previous);
          expect(next - previous).toBeLessThan(0.08);
          previous = next;
        }
        expect(previous).toBe(1);
      }
    }
    for (const x of [12.5, 36.5, 60.5]) expect(visibility(x)).toBe(1);
    expect(triangles).toEqual(before);
  });

  it('does not mistake coplanar joins or a continuous shallow slope for shelf steps', () => {
    const joined = createIslandWaterDepth([
      ...rectangle(0, 0, 24, 48, 0.75),
      ...rectangle(24, 0, 24, 48, 0.75),
    ]);
    expect(joined.bedVisibility(24, 24.5)).toBe(1);
    const slopePoint = (point: LandTriangle['vertices'][0]) => ({ ...point, z: point.z + point.x / 8 });
    const triangles = rectangle(0, 0, 48, 48, 7).map((triangle): LandTriangle => ({
      ...triangle, vertices: [
        slopePoint(triangle.vertices[0]), slopePoint(triangle.vertices[1]), slopePoint(triangle.vertices[2]),
      ],
    }));
    const slope = createIslandWaterDepth(triangles);
    for (let x = 8.5; x <= 39.5; x++) expect(slope.bedVisibility(x, 24.5)).toBe(1);
  });
  it('measures real flat tops, gaps and detached pieces without inventing depth from coastal distance', () => {
    const field = createIslandWaterDepth([
      ...rectangle(0, 0, 12, 12, 0.75),
      ...rectangle(12, 0, 12, 12, 3.5),
      ...rectangle(36, 0, 8, 8, 4.75),
    ]);
    expect(field.sample(4.5, 4.5)).toBe(0.75);
    expect(field.sample(16.5, 4.5)).toBe(3.5);
    expect(field.sample(39.5, 4.5)).toBe(4.75);
    expect(field.sample(29.5, 4.5)).toBeGreaterThan(4.75);
    expect(field.sample(100, 100)).toBe(WATER_MAX_DEPTH);
  });

  it('continues only missing seabed into deeper water and meets the open sea without a field-border seam', () => {
    const field = createIslandWaterDepth(rectangle(-8, -8, 16, 16, 2));
    let previous = field.sample(7.5, 0.5);
    for (let x = 7.75; x <= 48; x += 0.25) {
      const next = field.sample(x, 0.5);
      expect(next).toBeGreaterThanOrEqual(previous);
      expect(next - previous).toBeLessThanOrEqual(0.126);
      previous = next;
    }
    expect(previous).toBe(WATER_MAX_DEPTH);
  });

  it('does not turn dry cliff tops into shallow-water propagation sources', () => {
    const field = createIslandWaterDepth(rectangle(0, 0, 24, 24, -10));
    expect(field.sample(12, -3)).toBe(WATER_MAX_DEPTH);
    expect(field.sample(27, 12)).toBe(WATER_MAX_DEPTH);
  });

  it('takes the upper incident surface and reproduces sloped top heights', () => {
    const triangles = rectangle(0, 0, 16, 16, 4).map((triangle): LandTriangle => {
      const slope = (point: LandTriangle['vertices'][0]) => ({ ...point, z: point.z + point.x / 8 });
      return { ...triangle, vertices: [
        slope(triangle.vertices[0]), slope(triangle.vertices[1]), slope(triangle.vertices[2]),
      ] };
    });
    const field = createIslandWaterDepth(triangles);
    expect(field.sample(4.5, 2.5)).toBeCloseTo(4 - 4.5 / 8, 6);
    const upper = createIslandWaterDepth([...triangles, ...rectangle(0, 0, 8, 8, 0.75)]);
    expect(upper.sample(4.5, 2.5)).toBe(0.75);
  });

  it('invalidates cached bathymetry for replacement geometry but not sunlight edits', () => {
    const island = generateIslandLandform(153025);
    const environment = createIslandEnvironment(island);
    const first = environment.waterDepth;
    environment.setSun({ ...environment.sun.settings, azimuth: 180 });
    expect(environment.waterDepth).toBe(first);
    island.beach.underwaterTriangles = [...island.beach.underwaterTriangles];
    expect(environment.waterDepth).not.toBe(first);
  });

  it.each([12, 77, 153025, 902479])('retains exact shelf depths and all source geometry for seed %i', seed => {
    const island = generateIslandLandform(seed), before = structuredClone(island);
    const depth = createIslandWaterDepth([...island.triangles, ...island.beach.underwaterTriangles]);
    let checked = 0;
    for (const cell of island.beach.seabed.cells) {
      const x = (cell.x + 0.5) * island.beach.seabed.cellSize;
      const y = (cell.y + 0.5) * island.beach.seabed.cellSize;
      expect(depth.sample(x, y)).toBeCloseTo([0, 0.75, 2, 3.5, 4.75][cell.level], 6);
      expect(depth.bodyDepth(x, y)).toBeGreaterThanOrEqual(0);
      expect(depth.bodyDepth(x, y)).toBeLessThanOrEqual(WATER_MAX_DEPTH);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
    for (let y = -32; y <= island.world.height * island.world.tileSize + 32; y += 3.5)
      for (let x = -32; x <= island.world.width * island.world.tileSize + 32; x += 3.5)
        expect(depth.bodyDepth(x, y)).toBeGreaterThanOrEqual(0);
    expect(island).toEqual(before);
  });

  it('bounds allocations and rejects nonfinite geometry and queries', () => {
    const empty = createIslandWaterDepth([]);
    expect(empty.sample(0, 0)).toBe(WATER_MAX_DEPTH);
    expect(empty.bodyDepth(0, 0)).toBe(WATER_MAX_DEPTH);
    expect(empty.bedVisibility(0, 0)).toBe(0);
    expect(() => empty.sample(NaN, 0)).toThrow('finite');
    expect(() => empty.bodyDepth(Infinity, 0)).toThrow('finite');
    expect(() => empty.bedVisibility(0, NaN)).toThrow('finite');
    expect(() => createIslandWaterDepth(rectangle(0, 0, 100000, 100000, 1))).toThrow('budget');
    expect(() => createIslandWaterDepth(rectangle(NaN, 0, 8, 8, 1))).toThrow('finite');
  });
});
