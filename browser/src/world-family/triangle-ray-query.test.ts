import { describe, expect, it } from 'vitest';
import type { LandTriangle } from './core/landform-study';
import { createTriangleRayQuery } from './render/triangle-ray-query';
import { closestSurfacePoint } from './render/surface-projection';
import { createIslandSun, DEFAULT_SUN } from './render/island-sun';

const face: LandTriangle = {
  vertices: [{ x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }, { x: 0, y: 8, z: 0 }],
  plane: 'top', level: 0,
};

describe('precise curved-beach shadow receivers', () => {
  it('distinguishes real blockers from receiver contact, parallel rays and geometry behind the ray', () => {
    const before = structuredClone(face), hit = createTriangleRayQuery([face]);
    expect(hit({ x: 2, y: 2, z: -1 }, { x: 0, y: 0, z: 1 })).toBe(true);
    expect(hit({ x: 2, y: 2, z: 1 }, { x: 0, y: 0, z: -1 })).toBe(true);
    expect(hit({ x: 2, y: 2, z: 0 }, { x: 0, y: 0, z: 1 })).toBe(false);
    expect(hit({ x: 2, y: 2, z: 1 }, { x: 0, y: 0, z: 1 })).toBe(false);
    expect(hit({ x: 2, y: 2, z: 1 }, { x: 1, y: 0, z: 0 })).toBe(false);
    expect(hit({ x: 8, y: 8, z: -1 }, { x: 0, y: 0, z: 1 })).toBe(false);
    expect(face).toEqual(before);
    expect(createTriangleRayQuery([])({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })).toBe(false);
    expect(() => hit({ x: NaN, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })).toThrow(RangeError);
    expect(() => hit({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })).toThrow(RangeError);
    expect(() => createTriangleRayQuery([{
      ...face, vertices: [{ x: Infinity, y: 0, z: 0 }, face.vertices[1], face.vertices[2]],
    }])).toThrow(RangeError);
  });

  it('traverses a multi-level tree without dropping distant or edge-on blockers', () => {
    const faces = Array.from({ length: 64 }, (_, i): LandTriangle => {
      const offset = (p: LandTriangle['vertices'][number]) => ({ ...p, x: p.x + i * 16 });
      return { ...face, vertices: [offset(face.vertices[0]), offset(face.vertices[1]), offset(face.vertices[2])] };
    });
    const hit = createTriangleRayQuery(faces);
    for (let i = 0; i < faces.length; i++) {
      expect(hit({ x: i * 16 + 2, y: 2, z: -2 }, { x: 0, y: 0, z: 1 })).toBe(true);
      expect(hit({ x: i * 16 + 10, y: 2, z: -2 }, { x: 0, y: 0, z: 1 })).toBe(false);
    }
  });

  it('clamps atlas padding to the triangle while leaving interior receivers in place', () => {
    expect(closestSurfacePoint(face, { x: 2, y: 2, z: 0 })).toEqual({ x: 2, y: 2, z: 0 });
    expect(closestSurfacePoint(face, { x: 2, y: 2, z: 4 })).toEqual({ x: 2, y: 2, z: 0 });
    expect(closestSurfacePoint(face, { x: -0.5, y: 2, z: 0 })).toEqual({ x: 0, y: 2, z: 0 });
    expect(closestSurfacePoint(face, { x: 8, y: 8, z: 0 })).toEqual({ x: 4, y: 4, z: 0 });
  });

  it.each(['hard', 'filtered', 'contact'] as const)('preserves actual cast shadows and sun controls in precise %s mode', shadowMode => {
    const blocker: LandTriangle = {
      ...face, vertices: [{ x: 0, y: 0, z: 0 }, { x: 32, y: 0, z: 0 }, { x: 0, y: 32, z: 0 }],
    };
    const sun = createIslandSun([blocker], { ...DEFAULT_SUN, azimuth: 0, elevation: 45, shadowMode });
    expect(sun.visibility({ x: 2, y: 2, z: 0 }, undefined, true)).toBe(1);
    expect(sun.visibility({ x: -10, y: 8, z: -20 }, undefined, true)).toBe(0);
    expect(sun.visibility({ x: 20, y: 20, z: -20 }, undefined, true)).toBe(1);
    expect(sun.settings.shadowMode).toBe(shadowMode);
    const zero = createIslandSun([blocker], { ...sun.settings, softness: 0 });
    expect(zero.visibility({ x: -10, y: 8, z: -20 }, undefined, true)).toBe(0);
  });
});
