import { describe, expect, it } from 'vitest';
import { intersectIslandPolygon, subtractIslandPolygon, islandColumnTriangles, type IslandSurfacePolygon } from './core/island-columns';
import { generateIslandLandform, islandSurfaceHeight } from './core/island-landform';
import type { LandPoint, LandTriangle } from './core/landform-study';

const polygonArea = (points: readonly LandPoint[]) => Math.abs(points.reduce((sum, point, i) => {
  const next = points[(i + 1) % points.length];
  return sum + point.x * next.y - next.x * point.y;
}, 0) / 2);
const triangleArea = ({ vertices: [a, b, c] }: LandTriangle) => {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
};
function quad(x: number, y: number, width: number, height: number, z: (y: number) => number, ascentId?: number): IslandSurfacePolygon {
  return {
    level: 0, ascentId,
    vertices: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
      .map(point => ({ ...point, z: z(point.y) })),
  };
}

describe('clipped solid terrain columns', () => {
  it('cuts a true tapered footprint without missing or overlapping ground', () => {
    const ground = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const footprint = [{ x: 3, y: 0 }, { x: 7, y: 0 }, { x: 9, y: 10 }, { x: 1, y: 10 }];
    const inside = intersectIslandPolygon(ground, footprint), outside = subtractIslandPolygon(ground, footprint);
    expect(polygonArea(inside)).toBeCloseTo(60, 8);
    expect(outside.reduce((sum, polygon) => sum + polygonArea(polygon), 0)).toBeCloseTo(40, 8);
  });

  it('removes coplanar internal walls even at partially shared cell edges', () => {
    const triangles = islandColumnTriangles([
      quad(0, 0, 4, 8, () => 4), quad(4, 0, 4, 4, () => 4), quad(4, 4, 4, 4, () => 4),
    ]);
    expect(triangles.filter(triangle => triangle.plane !== 'top' && triangle.vertices.every(v => Math.abs(v.x - 4) < 1e-8))).toHaveLength(0);
    expect(triangles.filter(triangle => triangle.plane === 'top').reduce((sum, triangle) => sum + triangleArea(triangle), 0)).toBe(64);
  });

  it('builds genuine vertical risers, tagged with the higher tread, across split edges', () => {
    const triangles = islandColumnTriangles([
      quad(0, 0, 4, 8, () => 4, 2), quad(4, 0, 4, 4, () => 2, 2), quad(4, 4, 4, 4, () => 2, 2),
    ]);
    const risers = triangles.filter(triangle => triangle.plane !== 'top' && triangle.vertices.every(v => Math.abs(v.x - 4) < 1e-8));
    expect(risers.reduce((sum, triangle) => sum + triangleArea(triangle), 0)).toBeCloseTo(16, 8);
    expect(risers.every(triangle => triangle.ascentId === 2)).toBe(true);
  });

  it('splits crossing height profiles instead of emitting inverted walls', () => {
    const triangles = islandColumnTriangles([quad(0, 0, 4, 8, y => y), quad(4, 0, 4, 8, () => 4)]);
    const walls = triangles.filter(triangle => triangle.plane !== 'top' && triangle.vertices.every(v => Math.abs(v.x - 4) < 1e-8));
    expect(walls.reduce((sum, triangle) => sum + triangleArea(triangle), 0)).toBeCloseTo(16, 8);
    expect(walls.some(triangle => triangle.vertices.some(v => Math.abs(v.y - 4) < 1e-8 && Math.abs(v.z - 4) < 1e-8))).toBe(true);
  });

  it.each([12, 41, 71, 902479])('matches every ascent top and actual riser to the height model for seed %i', seed => {
    const island = generateIslandLandform(seed);
    for (const triangle of island.triangles.filter(triangle => triangle.plane === 'top' && triangle.ascentId !== undefined)) {
      const point = {
        x: triangle.vertices.reduce((sum, p) => sum + p.x, 0) / 3,
        y: triangle.vertices.reduce((sum, p) => sum + p.y, 0) / 3,
      };
      const cell = { x: Math.floor(point.x / island.world.tileSize), y: Math.floor(point.y / island.world.tileSize) };
      const expected = triangle.vertices.reduce((sum, p) => sum + p.z, 0) / 3;
      expect(islandSurfaceHeight(island.world, cell, point, island.ascents, island.edges, island.beach, island.shoulders)).toBeCloseTo(expected, 7);
    }
    for (const ascent of island.ascents) {
      let risers = 0;
      for (let i = 1; i < ascent.sections.length; i++) {
        const before = ascent.sections[i - 1], after = ascent.sections[i];
        const rise = before.toHeight - after.fromHeight;
        if (rise < 1e-7) continue;
        risers++;
        const faces = island.triangles.filter(triangle => triangle.plane !== 'top' && triangle.ascentId === ascent.id
          && triangle.vertices.every(point => Math.abs(
            (point.x - ascent.origin.x) * ascent.direction.x + (point.y - ascent.origin.y) * ascent.direction.y - after.from,
          ) < 1e-6));
        const sharedWidth = Math.min(before.toWidth, after.fromWidth);
        const riserBounds = [
          { x: -sharedWidth / 2, y: after.fromHeight }, { x: sharedWidth / 2, y: after.fromHeight },
          { x: sharedWidth / 2, y: before.toHeight }, { x: -sharedWidth / 2, y: before.toHeight },
        ];
        const covered = faces.reduce((sum, triangle) => {
          const face = triangle.vertices.map(point => ({
            x: -(point.x - ascent.origin.x) * ascent.direction.y + (point.y - ascent.origin.y) * ascent.direction.x,
            y: point.z,
          }));
          // Project in either winding; the clipping rectangle is counterclockwise.
          const clipped = intersectIslandPolygon(face, riserBounds);
          return sum + polygonArea(clipped);
        }, 0);
        expect(covered).toBeCloseTo(rise * sharedWidth, 5);
      }
      expect(risers).toBe(ascent.stepCount);
    }
  });
});
