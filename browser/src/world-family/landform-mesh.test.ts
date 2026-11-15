import { describe, expect, it } from 'vitest';
import { optimizeLandformMesh } from './core/landform-mesh';
import { buildIslandLandform } from './core/island-landform';
import { generateIslandWorld } from './core/world';
import type { LandTriangle, LandVertex } from './core/landform-study';
import { rasterLandform, type LandPalette } from './render/landform-study';
import { createIslandSurface } from './render/island-surface';

const palette: LandPalette = {
  water: [0, 0, 0], top: [100, 200, 100], light: [200, 200, 150],
  middle: [150, 150, 100], dark: [100, 100, 50],
  levels: [[200, 200, 200], [150, 150, 150], [100, 100, 100]],
};
function quad(x: number, y: number, width = 1, height = 1, transform = (point: LandVertex) => point): LandTriangle[] {
  const [a, b, c, d] = [
    { x, y, z: 0 }, { x: x + width, y, z: 0 },
    { x: x + width, y: y + height, z: 0 }, { x, y: y + height, z: 0 },
  ].map(transform);
  return [{ vertices: [a, b, c], plane: 'top', level: 0 }, { vertices: [a, c, d], plane: 'top', level: 0 }];
}
function area(triangles: readonly LandTriangle[]): number {
  return triangles.reduce((sum, { vertices: [a, b, c] }) => {
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    return sum + Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }, 0);
}

describe('boundary-triangulated terrain mesh', () => {
  it('turns a tiled flat interior into two triangles, not a coarse hidden grid', () => {
    const source = Array.from({ length: 100 }, (_, i) => quad(i % 10, Math.floor(i / 10))).flat();
    const before = structuredClone(source), optimized = optimizeLandformMesh(source);
    expect(optimized).toHaveLength(2);
    expect(area(optimized)).toBe(100);
    expect(source).toEqual(before);
  });

  it('cancels partial shared edges at T-junctions and removes collinear grid vertices', () => {
    const source = [...quad(0, 0, 2, 2), ...quad(2, 0, 2, 1), ...quad(2, 1, 2, 1)];
    expect(optimizeLandformMesh(source)).toHaveLength(2);
    expect(area(optimizeLandformMesh(source))).toBe(8);
  });

  it('retains holes and separates surfaces that only meet at a corner', () => {
    const ring = Array.from({ length: 9 }, (_, i) => i === 4 ? [] : quad(i % 3, Math.floor(i / 3))).flat();
    const optimized = optimizeLandformMesh(ring);
    expect(optimized).toHaveLength(8);
    expect(area(optimized)).toBe(8);
    const raster = rasterLandform('plan', palette, [], {
      triangles: optimized, viewport: { width: 3, height: 3, origin: { x: 0, y: 0 } },
    });
    expect(Array.from(raster.levels)).toEqual([0, 0, 0, 0, -1, 0, 0, 0, 0]);
    const touching = optimizeLandformMesh([...quad(0, 0), ...quad(1, 1)]);
    expect(touching).toHaveLength(4);
    expect(area(touching)).toBe(2);
  });

  it.each([
    (p: LandVertex) => ({ x: p.x, y: p.y, z: p.x * 5 / 3 + 20 }),
    (p: LandVertex) => ({ x: 12, y: p.x, z: p.y }),
    (p: LandVertex) => ({ x: p.x, y: 12, z: -p.y }),
  ])('merges coplanar slopes and vertical walls without changing outward winding', transform => {
    const source = [...quad(0, 0, 2, 2, transform), ...quad(2, 0, 2, 2, transform)];
    const optimized = optimizeLandformMesh(source);
    expect(optimized).toHaveLength(2);
    expect(area(optimized)).toBeCloseTo(area(source), 8);
    expect(optimizeLandformMesh(source)).toEqual(optimized);
    expect(area(optimizeLandformMesh(optimized))).toBeCloseTo(area(source), 8);
  });

  it('keeps separate elevations and surface classifications separate', () => {
    const low = quad(0, 0), high = quad(1, 0, 1, 1, p => ({ ...p, z: 20 }));
    high.forEach(triangle => { triangle.level = 1; });
    expect(optimizeLandformMesh([...low, ...high])).toHaveLength(4);
    expect(optimizeLandformMesh([...low, ...quad(1, 0).map(triangle => ({ ...triangle, plane: 'dark' as const }))])).toHaveLength(4);
  });

  it('gives shared pixel-center edges one owner regardless of triangle order', () => {
    const source = [
      ...quad(0.5, 0.5, 2, 2),
      ...quad(2.5, 0.5, 2, 2).map(triangle => ({ ...triangle, level: 1 })),
    ];
    const render = (triangles: LandTriangle[]) => rasterLandform('plan', palette, [], {
      triangles, viewport: { width: 6, height: 4, origin: { x: 0, y: 0 } },
      shadePlan: true, shade: triangle => triangle.level ? [180, 130, 80] : [20, 90, 30],
    });
    const before = render(source), after = render([...source].reverse());
    expect(after.pixels).toEqual(before.pixels);
    expect([...before.pixels.slice((1 * 6 + 2) * 4, (1 * 6 + 2) * 4 + 3)]).toEqual([180, 130, 80]);
  });

  it.each([...new Set([
    ...Array.from({ length: 128 }, (_, seed) => seed),
    ...Array.from({ length: 32 }, (_, i) => ((i + 1) * 7919) % 1000000),
    999999,
  ])])('keeps complete surface area and bounds beach-layer boundary overhead for seed %i', seed => {
    const world = generateIslandWorld(seed);
    const source = buildIslandLandform(world, { optimize: false }), optimized = buildIslandLandform(world);
    const geometryOnly = optimizeLandformMesh(source.triangles.map(({ layer, ...triangle }) => triangle));
    const shoulderBoundaryBudget = source.shoulders.patches.reduce((sum, patch) => {
      const cells = new Set(patch.cells);
      return sum + patch.cells.reduce((edges, index) => edges
        + [index - 1, index + 1, index - world.width, index + world.width].filter(next => !cells.has(next)).length * 2, 0);
    }, 0);
    // Real beach risers add silhouette edges that must survive coplanar merging.
    expect(geometryOnly.length).toBeLessThan(source.triangles.length * 0.32 + shoulderBoundaryBudget);
    // Independent layer boundaries cannot be merged into Base's flat polygons.
    expect(optimized.triangles.length).toBeLessThan(source.triangles.length * 0.34 + shoulderBoundaryBudget);
    expect(area(optimized.triangles)).toBeCloseTo(area(source.triangles), 5);
  });

  it.each([0, 12, 26, 41, 71, 902479, 999999])('preserves every visible surface and depth for seed %i', seed => {
    const world = generateIslandWorld(seed);
    const source = buildIslandLandform(world, { optimize: false });
    const optimized = buildIslandLandform(world);
    expect(optimized.triangles.length).toBeLessThan(source.triangles.length * 0.34);
    expect(optimized.sourceTriangleCount).toBe(source.triangles.length);
    expect(area(optimized.triangles)).toBeCloseTo(area(source.triangles), 5);
    expect(optimized.placements).toEqual(source.placements);
    for (const projection of ['plan', 'current', 'oblique'] as const) {
      const viewport = { width: 640, height: 520, origin: projection === 'oblique' ? { x: 280, y: 80 } : { x: 24, y: 80 } };
      const render = (triangles: LandTriangle[]) => rasterLandform(projection, palette, [], { triangles, viewport });
      const before = render(source.triangles), after = render(optimized.triangles);
      expect(after.levels.every((value, i) => value === before.levels[i])).toBe(true);
      expect(after.pixels.every((value, i) => value === before.pixels[i])).toBe(true);
      let error = 0;
      for (let i = 0; i < before.depth.length; i++) {
        if (before.depth[i] !== -Infinity) error = Math.max(error, Math.abs(after.depth[i] - before.depth[i]));
      }
      expect(error).toBeLessThan(1e-7);
    }
  });

  it('retains world-space materials and cliff lip shading after retriangulation', () => {
    const world = generateIslandWorld(71), surface = createIslandSurface(world);
    const source = buildIslandLandform(world, { optimize: false }), optimized = buildIslandLandform(world);
    const viewport = { width: 640, height: 520, origin: { x: 280, y: 80 } };
    const render = (triangles: LandTriangle[]) => rasterLandform('oblique', palette, [], { triangles, viewport, shade: surface.shade });
    const before = render(source.triangles), after = render(optimized.triangles);
    let significantDifferences = 0;
    for (let i = 0; i < before.depth.length; i++) {
      const offset = i * 4;
      if ([0, 1, 2].some(channel => Math.abs(after.pixels[offset + channel] - before.pixels[offset + channel]) > 3)) significantDifferences++;
    }
    expect(significantDifferences).toBe(0);
  });
});
