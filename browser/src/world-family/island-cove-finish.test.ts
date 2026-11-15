import { beforeAll, describe, expect, it } from 'vitest';
import { generateIslandLandform, type IslandLandform } from './core/island-landform';
import { islandCoveInfluence } from './core/island-cove';
import type { LandTriangle } from './core/landform-study';
import { createIslandSurface } from './render/island-surface';
import { createIslandSun, DEFAULT_SUN } from './render/island-sun';
import { closestSurfacePoint, projectionWeights, sampleProjectedTexture, surfaceNormal } from './render/surface-projection';
import { createIslandTextures, MATERIAL_COLORS } from './render/island-textures';

let island: IslandLandform;
beforeAll(() => { island = generateIslandLandform(153025, { pilotCove: true }); });
const centroid = (triangle: LandTriangle) => ({
  x: triangle.vertices.reduce((sum, p) => sum + p.x / 3, 0),
  y: triangle.vertices.reduce((sum, p) => sum + p.y / 3, 0),
  z: triangle.vertices.reduce((sum, p) => sum + p.z / 3, 0),
});

describe('local cove finishing without another terrain pass', () => {
  it('removes false dark beach speckles without changing geometry, settings or unrelated surfaces', () => {
    const before = structuredClone(island);
    const sun = createIslandSun([...island.triangles, ...island.beach.underwaterTriangles]);
    const original = createIslandSurface(island.world, undefined, island.ascents, island.edges, island.beach, () => sun);
    const finish = createIslandSurface(island.world, undefined, island.ascents, island.edges, island.beach, () => sun, island.cove);
    let unchanged = 0, corrected = 0, clampedLit = 0;
    for (const triangle of island.triangles) {
      const point = centroid(triangle), weight = islandCoveInfluence(island.cove!, point.x, point.y);
      const a = original.shade(triangle, point), b = finish.shade(triangle, point);
      if ((!weight && original.material(point.x, point.y) === finish.material(point.x, point.y))
        || triangle.ascentId !== undefined || triangle.level > 0) {
        expect(b).toEqual(a);
        unchanged++;
      }
      if (weight === 1 && triangle.plane === 'top' && point.x >= 318 && point.x <= 336
        && point.y >= 108 && point.y <= 124) {
        const normal = surfaceNormal(triangle), vertex = triangle.vertices[0];
        for (const [dx, dy] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5]]) {
          const sample = { x: vertex.x + dx, y: vertex.y + dy, z: vertex.z - (normal.x * dx + normal.y * dy) / normal.z };
          const old = original.shade(triangle, sample), next = finish.shade(triangle, sample);
          if (old[0] < 180 && sun.visibility(closestSurfacePoint(triangle, sample), normal, true) === 1) {
            expect(next[0]).toBeGreaterThan(old[0] + 30);
            corrected++;
            if (sun.visibility(closestSurfacePoint(triangle, sample), normal) === 1) clampedLit++;
          }
        }
      }
    }
    expect(corrected).toBeGreaterThan(0);
    expect(clampedLit).toBeGreaterThan(0);
    expect(unchanged).toBeGreaterThan(100);
    expect(sun.settings).toEqual(DEFAULT_SUN);
    expect(island).toEqual(before);
  });

  it('retains a real overhead caster instead of simply brightening the beach', () => {
    const triangle = island.triangles.find(triangle => {
      const p = centroid(triangle);
      return triangle.plane === 'top' && p.x > 324 && p.x < 332 && p.y > 112 && p.y < 120;
    })!;
    const point = centroid(triangle), normal = surfaceNormal(triangle);
    const direction = createIslandSun([]).direction;
    const x = point.x + direction.x * 15, y = point.y + direction.y * 15, z = point.z + direction.z * 15;
    const roof: LandTriangle[] = [
      { plane: 'top', level: 1, vertices: [{ x: x - 8, y: y - 8, z }, { x: x + 8, y: y - 8, z }, { x: x + 8, y: y + 8, z }] },
      { plane: 'top', level: 1, vertices: [{ x: x - 8, y: y - 8, z }, { x: x + 8, y: y + 8, z }, { x: x - 8, y: y + 8, z }] },
    ];
    const mesh = [...island.triangles, ...island.beach.underwaterTriangles, ...roof];
    const sun = createIslandSun(mesh), unshadowed = createIslandSun(mesh, { ...DEFAULT_SUN, shadowStrength: 0 });
    const finish = createIslandSurface(island.world, undefined, island.ascents, island.edges, island.beach, () => sun, island.cove);
    const clear = createIslandSurface(island.world, undefined, island.ascents, island.edges, island.beach, () => unshadowed, island.cove);
    expect(sun.visibility(point, normal, true)).toBe(0);
    expect(finish.shade(triangle, point)[0]).toBeLessThan(clear.shade(triangle, point)[0] - 40);
  });

  it('uses rounded discrete sand/grass masks, never intermediate sand/grass colors', () => {
    const sun = createIslandSun([], { ...DEFAULT_SUN, intensity: 0, skyFill: 1 });
    const original = createIslandSurface(island.world, undefined, island.ascents, island.edges, island.beach, () => sun);
    const finish = createIslandSurface(island.world, undefined, island.ascents, island.edges, island.beach, () => sun, island.cove);
    const again = createIslandSurface(island.world, undefined, island.ascents, island.edges, island.beach, () => sun, island.cove);
    let replaced = 0, untouchedGrass = 0, retainedSand = 0;
    for (const triangle of island.triangles) {
      if (triangle.plane !== 'top' || triangle.level !== 0 || triangle.ascentId !== undefined) continue;
      const point = centroid(triangle), source = original.material(point.x, point.y);
      const selected = finish.material(point.x, point.y);
      expect(again.material(point.x, point.y)).toBe(selected);
      expect(finish.regions(triangle, point)).toEqual(MATERIAL_COLORS[selected]);
      const before = original.shade(triangle, point), after = finish.shade(triangle, point);
      if (source !== selected) {
        expect([source, selected].sort()).toEqual(['dry-sand', 'turf']);
        const normal = surfaceNormal(triangle);
        const textures = createIslandTextures(island.world.seed);
        const color = sampleProjectedTexture(point, projectionWeights(normal), (u, v) => textures.sample(selected, u, v));
        const weight = selected === 'dry-sand' ? islandCoveInfluence(island.cove!, point.x, point.y) * 0.4 : 0;
        const base = MATERIAL_COLORS[selected];
        const finished: readonly [number, number, number] = [
          color[0] + (base[0] - color[0]) * weight,
          color[1] + (base[1] - color[1]) * weight,
          color[2] + (base[2] - color[2]) * weight,
        ];
        expect(after).toEqual(sun.shade(finished, normal));
        replaced++;
      } else if (source !== 'dry-sand' && source !== 'wet-sand') {
        expect(after).toEqual(before);
        untouchedGrass++;
      } else retainedSand++;
    }
    expect(replaced).toBeGreaterThan(0);
    expect(retainedSand).toBeGreaterThan(100);
    expect(untouchedGrass).toBeGreaterThan(100);
  });

});
