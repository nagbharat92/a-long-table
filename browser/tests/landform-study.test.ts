import { describe, expect, it } from 'vitest';
import {
  LANDFORM_FIXTURE, SCALE_PLACEMENTS, OCCLUSION_PLACEMENT, ASCENT_RESERVATION,
  containsLandPoint, landHeightAt, landformTriangles, projectLandVertex,
} from '../src/core/landform-study';
import {
  rasterLandform, rasterRabbit, STUDY_WIDTH, STUDY_HEIGHT, STUDY_ORIGIN, type LandPalette,
} from '../src/render/landform-study';

const palette: LandPalette = {
  water: [82, 105, 106], top: [182, 198, 147],
  light: [184, 181, 159], middle: [147, 152, 139], dark: [116, 127, 120],
  levels: [[211, 217, 184], [164, 187, 142], [112, 142, 120]],
};

function polygonArea(points: readonly { x: number; y: number }[]): number {
  return points.reduce((area, a, i) => {
    const b = points[(i + 1) % points.length];
    return area + a.x * b.y - a.y * b.x;
  }, 0) / 2;
}

describe('isolated landform fixture', () => {
  it('has three supported, nested elevations and no disconnected component', () => {
    expect(LANDFORM_FIXTURE.map(mass => mass.height)).toEqual([0, 20, 48]);
    for (let level = 1; level < LANDFORM_FIXTURE.length; level++) {
      const upper = LANDFORM_FIXTURE[level], lower = LANDFORM_FIXTURE[level - 1];
      expect(upper.floor).toBe(lower.height);
      for (let i = 0; i < upper.boundary.length; i++) {
        const a = upper.boundary[i], b = upper.boundary[(i + 1) % upper.boundary.length];
        for (let step = 0; step <= 20; step++) {
          const point = { x: a.x + (b.x - a.x) * step / 20, y: a.y + (b.y - a.y) * step / 20 };
          expect(containsLandPoint(lower.boundary, point), `${upper.id} at ${point.x},${point.y}`).toBe(true);
        }
      }
    }
  });

  it('triangulates concave tops without losing or adding area', () => {
    const triangles = landformTriangles();
    for (const [level, mass] of LANDFORM_FIXTURE.entries()) {
      const top = triangles.filter(triangle => triangle.level === level && triangle.plane === 'top');
      expect(top).toHaveLength(mass.boundary.length - 2);
      expect(top.reduce((area, triangle) => area + polygonArea(triangle.vertices), 0)).toBeCloseTo(polygonArea(mass.boundary), 8);
      for (const triangle of top) {
        expect(triangle.vertices.every(vertex => vertex.z === mass.height)).toBe(true);
      }
      const walls = triangles.filter(triangle => triangle.level === level && triangle.plane !== 'top');
      expect(walls).toHaveLength(mass.boundary.length * 2);
      expect(walls.every(triangle => triangle.vertices.every(vertex => vertex.z === mass.height || vertex.z === mass.floor))).toBe(true);
    }
  });

  it('places the original-scale references on their actual supporting levels', () => {
    expect(SCALE_PLACEMENTS.map(point => landHeightAt(point))).toEqual([0, 20, 48]);
    expect(landHeightAt(OCCLUSION_PLACEMENT)).toBe(0);
    expect(landHeightAt({ x: 1000, y: 1000 })).toBeUndefined();
  });

  it('reserves ascent space on land rather than drawing a corridor across water', () => {
    for (let i = 1; i < ASCENT_RESERVATION.length; i++) {
      const a = ASCENT_RESERVATION[i - 1], b = ASCENT_RESERVATION[i];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      for (let step = 0; step <= 20; step++) {
        for (const side of [-4.5, 0, 4.5]) {
          expect(landHeightAt({
            x: a.x + (b.x - a.x) * step / 20 - (b.y - a.y) / length * side,
            y: a.y + (b.y - a.y) * step / 20 + (b.x - a.x) / length * side,
          })).toBeDefined();
        }
      }
    }
  });

  it('changes only projection, preserving explicit elevation and near/far order', () => {
    const p = { x: 12, y: 8, z: 20 };
    expect(projectLandVertex(p, 'current')).toEqual({ x: 12, y: -12, z: 28 });
    const oblique = projectLandVertex(p, 'oblique');
    expect(oblique.x).toBeCloseTo(3.4, 8);
    expect(oblique.y).toBeCloseTo(-11.5, 8);
    expect(oblique.z).toBeCloseTo(31.45, 8);
    expect(projectLandVertex(p, 'plan')).toEqual(p);
    expect(LANDFORM_FIXTURE.map(mass => mass.height)).toEqual([0, 20, 48]);
  });
});

describe('depth-aware pixel blockout', () => {
  it('fills the plan with exactly the shared polygon regions, without triangle seams', () => {
    const raster = rasterLandform('plan', palette);
    for (let y = 0; y < STUDY_HEIGHT; y++) {
      for (let x = 0; x < STUDY_WIDTH; x++) {
        const height = landHeightAt({ x: x + 0.5 - STUDY_ORIGIN.x, y: y + 0.5 - STUDY_ORIGIN.y });
        const expected = LANDFORM_FIXTURE.findIndex(mass => mass.height === height);
        if (raster.levels[y * STUDY_WIDTH + x] !== expected) {
          throw new Error(`Plan region mismatch at ${x},${y}: expected ${expected}.`);
        }
      }
    }
  });

  it.each(['current', 'oblique'] as const)('uses only flat plane colors and frames every elevation in %s', projection => {
    const raster = rasterLandform(projection, palette);
    expect(new Set(raster.levels)).toEqual(new Set([-1, 0, 1, 2]));
    const colors = new Set<string>();
    for (let i = 0; i < raster.pixels.length; i += 4) {
      colors.add([...raster.pixels.subarray(i, i + 3)].join(','));
      expect(raster.pixels[i + 3]).toBe(255);
    }
    expect(colors).toEqual(new Set([palette.water, palette.top, palette.light, palette.middle, palette.dark].map(color => color.join(','))));
    for (let x = 0; x < STUDY_WIDTH; x++) {
      expect(raster.levels[x]).toBe(-1);
      expect(raster.levels[(STUDY_HEIGHT - 1) * STUDY_WIDTH + x]).toBe(-1);
    }
    for (let y = 0; y < STUDY_HEIGHT; y++) {
      expect(raster.levels[y * STUDY_WIDTH]).toBe(-1);
      expect(raster.levels[(y + 1) * STUDY_WIDTH - 1]).toBe(-1);
    }
    expect(rasterLandform(projection, palette).pixels).toEqual(raster.pixels);
  });

  it.each(['current', 'oblique'] as const)('occludes a rear probe instead of painting it over the cliff in %s', projection => {
    const rabbit = { width: 18, height: 29, pixels: new Uint8ClampedArray(18 * 29 * 4).fill(255) };
    for (const placement of SCALE_PLACEMENTS) {
      const result = rasterRabbit(rasterLandform(projection, palette), rabbit, placement, projection);
      expect(result.visible).toBeGreaterThan(60);
    }
    const result = rasterRabbit(rasterLandform(projection, palette), rabbit, OCCLUSION_PLACEMENT, projection);
    expect(result.hidden).toBeGreaterThan(0);
    expect(rabbit.pixels.every(value => value === 255)).toBe(true);
  });
});
