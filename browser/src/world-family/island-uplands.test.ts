import { describe, expect, it } from 'vitest';
import { ascentSectionPolygon, ascentHeightAt } from './core/island-ascents';
import { activeIslandLandTriangles, generateIslandLandform, islandSurfaceHeight } from './core/island-landform';
import type { LandTriangle, LandVertex } from './core/landform-study';
import { surfaceNormal } from './render/surface-projection';

const topArea = (triangles: readonly LandTriangle[]) => triangles.filter(t => t.plane === 'top')
  .reduce((sum, { vertices: [a, b, c] }) => sum + Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2, 0);

function triangleHeight(triangle: LandTriangle, point: { x: number; y: number }): number | undefined {
  const [a, b, c] = triangle.vertices;
  const determinant = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (Math.abs(determinant) < 1e-8) return undefined;
  const u = ((point.x - a.x) * (c.y - a.y) - (point.y - a.y) * (c.x - a.x)) / determinant;
  const v = ((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)) / determinant;
  return u >= -1e-7 && v >= -1e-7 && u + v <= 1 + 1e-7
    ? a.z + u * (b.z - a.z) + v * (c.z - a.z) : undefined;
}

describe('orthogonal Uplands and stair integration', () => {
  it.each([0, 1, 12, 41, 71, 77, 91, 153025, 902479, 999999])(
    'retains complete rectangular stairs and landing joins in normal and solo meshes for seed %i', seed => {
      const island = generateIslandLandform(seed, { naturalAscent: false }), before = structuredClone(island);
      const full = activeIslandLandTriangles(island);
      const solo = activeIslandLandTriangles(island, { base: false, uplands: true, beaches: false });
      const uplands = full.filter(triangle => triangle.layer === 'uplands');
      expect(topArea(solo)).toBeCloseTo(topArea(uplands), 5);
      for (const triangles of [uplands, solo]) {
        for (const triangle of triangles) {
          const normal = surfaceNormal(triangle);
          if (triangle.plane === 'top') {
            expect(normal.z).toBeCloseTo(1, 7);
          } else {
            expect(Math.abs(normal.z)).toBeLessThan(1e-7);
            expect(Math.abs(normal.x) < 1e-7 || Math.abs(normal.y) < 1e-7).toBe(true);
          }
        }
      }
      for (const ascent of island.ascents) {
        const normalTops = uplands.filter(t => t.plane === 'top' && t.ascentId === ascent.id);
        const soloTops = solo.filter(t => t.plane === 'top' && t.ascentId === ascent.id);
        const expectedArea = ascent.sections.reduce((sum, section) =>
          sum + (section.to - section.from) * section.fromWidth, 0);
        expect(topArea(normalTops)).toBeCloseTo(expectedArea, 5);
        expect(topArea(soloTops)).toBeCloseTo(expectedArea, 5);
        for (const section of ascent.sections) {
          const polygon = ascentSectionPolygon(ascent, section);
          for (const along of [0.01, 0.5, 0.99]) for (const across of [0.01, 0.5, 0.99]) {
            const point: LandVertex = {
              x: polygon[0].x + (polygon[1].x - polygon[0].x) * along + (polygon[3].x - polygon[0].x) * across,
              y: polygon[0].y + (polygon[1].y - polygon[0].y) * along + (polygon[3].y - polygon[0].y) * across,
              z: section.fromHeight,
            };
            const cell = { x: Math.floor(point.x / island.world.tileSize), y: Math.floor(point.y / island.world.tileSize) };
            expect(ascentHeightAt(ascent, point)).toBeCloseTo(point.z, 7);
            expect(islandSurfaceHeight(island.world, cell, point, island.ascents, island.edges, island.beach, island.shoulders)).toBeCloseTo(point.z, 7);
            for (const tops of [normalTops, soloTops]) {
              const heights = tops.map(triangle => triangleHeight(triangle, point)).filter(value => value !== undefined);
              expect(heights.length).toBeGreaterThan(0);
              expect(heights.every(height => Math.abs(height - point.z) < 1e-6)).toBe(true);
            }
          }
        }
      }
      expect(island).toEqual(before);
    },
  );
});
