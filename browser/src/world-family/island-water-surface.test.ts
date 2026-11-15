import { describe, expect, it } from 'vitest';
import { createIslandSun, DEFAULT_SUN } from './render/island-sun';
import { coastalWaterNormal, coastalWaterNormalFromGradient, createWaterSurfaceResponse, waterRefractionNormal, waterSurfaceNormal, waterViewDirection } from './render/island-water-surface';
import { beachWaveGradient, shoreWaveWeight } from './render/island-beach-wash';
import type { SurfaceColor } from './render/island-surface';

const sun = createIslandSun([], { ...DEFAULT_SUN, mapSize: 512 });
const base: SurfaceColor = [45, 100, 113];

describe('gentle water surface response', () => {
  it('retains optical ripples at calm beaches without changing sheen normals or mesh slopes', () => {
    const flat = coastalWaterNormal(13, 27, 1.2, 3, 1, true);
    expect(flat).toEqual({ x: 0, y: 0, z: 1 });
    const optical = waterRefractionNormal(flat, 13, 27, 1.2, 3, 1, true);
    expect(Math.hypot(optical.x, optical.y)).toBeGreaterThan(0.01);
    const later = waterRefractionNormal(flat, 13, 27, 4.5, 3, 1, true);
    expect(Math.hypot(optical.x - later.x, optical.y - later.y)).toBeGreaterThan(0.01);
    const loop = waterRefractionNormal(flat, 13, 27, 2561.2, 3, 1, true);
    expect(loop.x).toBeCloseTo(optical.x, 12);
    expect(loop.y).toBeCloseTo(optical.y, 12);
    for (const wash of [false, true]) {
      const offshore = coastalWaterNormal(13, 27, 1.2, 18, 1, wash);
      const refracting = waterRefractionNormal(offshore, 13, 27, 1.2, 18, 1, wash);
      for (const axis of ['x', 'y', 'z'] as const) expect(refracting[axis]).toBeCloseTo(offshore[axis], 12);
    }
    expect(() => waterRefractionNormal({ x: 0, y: 0, z: 0 }, 0, 0, 0, 3, 1, true)).toThrow('upward');
  });

  it('includes along-beach attenuation in its normal and smoothly recovers the offshore baseline at wave ends', () => {
    const x = 13, y = 27, seconds = 3.2, distance = -4;
    const offshore = waterSurfaceNormal(x, y, seconds);
    for (const endSoftness of [0.05, 0.3, 0.4]) {
      let previous = Infinity;
      for (const epsilon of [0.001, 0.0001, 0.00001, 0.000001, 0]) {
        const beach = 0.6 + epsilon;
        const gradient = beachWaveGradient(distance, 0, beach, seconds, { x: 1, y: 0 }, { x: 0, y: 0.1 }, endSoftness);
        const normal = coastalWaterNormalFromGradient(x, y, seconds, distance, beach, true, gradient, endSoftness);
        const delta = Math.hypot(normal.x - offshore.x, normal.y - offshore.y, normal.z - offshore.z);
        expect(delta).toBeLessThan(previous);
        expect(Math.hypot(normal.x, normal.y, normal.z)).toBeCloseTo(1, 12);
        previous = delta;
      }
      expect(previous).toBeLessThan(1e-12);
      const gradient = beachWaveGradient(distance, 0, 0.75, seconds, { x: 1, y: 0 }, { x: 0, y: 0.1 }, endSoftness);
      const normal = coastalWaterNormalFromGradient(x, y, seconds, distance, 0.75, true, gradient, endSoftness);
      const strength = 1 - shoreWaveWeight(distance, 0.75, endSoftness);
      const z = 1 + (offshore.z - 1) * strength;
      expect(normal.y / normal.z).toBeCloseTo(offshore.y * strength / z - gradient.y, 12);
      expect(Math.abs(normal.y - coastalWaterNormal(x, y, seconds, distance, 0.75, true, 0).y)).toBeGreaterThan(0.1);
    }
  });

  it('preserves normal validation for full local gradients and numeric softness', () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(() => coastalWaterNormalFromGradient(0, 0, 0, 0, 1, true, { x: value, y: 0 })).toThrow('finite');
      expect(() => coastalWaterNormalFromGradient(0, 0, 0, 0, 1, true, { x: 0, y: value })).toThrow('finite');
      expect(() => coastalWaterNormalFromGradient(0, 0, 0, 0, 1, false, { x: 0, y: 0 }, value)).toThrow('end softness');
    }
    expect(() => coastalWaterNormalFromGradient(0, 0, 0, NaN, 1, true)).toThrow('finite');
  });

  it('shares the underlying sea normal at a flat local mesh edge and retains offshore ripples on its outer flank', () => {
    for (const distance of [0, 3, 5, 9, 14, 17.99, 18, 30, Infinity]) {
      for (const beach of [0, 0.6, 0.75, 1]) {
        const base = coastalWaterNormal(13, 27, 1.2, distance, beach, true);
        const meshEdge = coastalWaterNormal(13, 27, 1.2, distance, beach, true, 0, { x: 1, y: 0 });
        expect(meshEdge).toEqual(base);
        expect(Math.hypot(base.x, base.y, base.z)).toBeCloseTo(1, 12);
        const noWash = coastalWaterNormal(13, 27, 1.2, distance, beach, false);
        const offshore = waterSurfaceNormal(13, 27, 1.2);
        for (const axis of ['x', 'y', 'z'] as const) expect(noWash[axis]).toBeCloseTo(offshore[axis], 12);
      }
    }
    expect(coastalWaterNormal(13, 27, 1.2, 0, 1, true)).toEqual({ x: 0, y: 0, z: 1 });
    expect(Math.abs(coastalWaterNormal(13, 27, 1.2, 12, 1, true).x)).toBeGreaterThan(0.001);
    const left = coastalWaterNormal(13, 27, 1.2, 0, 1, true, 0.2, { x: -1, y: 0 });
    const right = coastalWaterNormal(13, 27, 1.2, 0, 1, true, 0.2, { x: 1, y: 0 });
    expect(left.x).toBeCloseTo(-right.x, 12);
    expect(left.z).toBe(right.z);
    expect(() => coastalWaterNormal(0, 0, 0, NaN, 1, true)).toThrow('finite');
  });

  it('uses bounded, smooth normals rather than moving geometry or pixel streaks', () => {
    let moving = 0;
    for (let y = -64; y < 128; y += 3) for (let x = -64; x < 128; x += 3) {
      const a = waterSurfaceNormal(x, y, 0), b = waterSurfaceNormal(x, y, 2);
      expect(Math.hypot(a.x, a.y, a.z)).toBeCloseTo(1, 12);
      expect(a.z).toBeGreaterThan(0.95);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.5);
      const adjacent = waterSurfaceNormal(x + 0.1, y + 0.1, 0);
      expect(Math.hypot(a.x - adjacent.x, a.y - adjacent.y)).toBeLessThan(0.012);
      if (Math.hypot(a.x - b.x, a.y - b.y) > 0.02) moving++;
    }
    expect(moving).toBeGreaterThan(2000);
  });

  it('is deterministic, continuous over its clock wrap, and reversible when paused', () => {
    for (const [x, y] of [[0, 0], [-83.2, 91.7], [555, 394]]) {
      expect(waterSurfaceNormal(x, y, 2.5)).toEqual(waterSurfaceNormal(x, y, 2.5));
      const a = waterSurfaceNormal(x, y, 0), b = waterSurfaceNormal(x, y, 2560);
      expect(b).toEqual(a);
      expect(waterSurfaceNormal(x, y, -0.001).x).toBeCloseTo(a.x, 3);
    }
  });

  it.each(['current', 'oblique'] as const)('uses the %s projection eye direction rotated into world space', projection => {
    const a = waterViewDirection(projection), b = waterViewDirection(projection, Math.PI / 2);
    expect(Math.hypot(a.x, a.y, a.z)).toBeCloseTo(1, 12);
    expect(b.x).toBeCloseTo(a.y, 12);
    expect(b.y).toBeCloseTo(-a.x, 12);
    expect(b.z).toBe(a.z);
    expect(a.z).toBeGreaterThan(0.5);
  });

  it('limits contrast and motion steps while preserving the contrast of shallow formations', () => {
    const shade = createWaterSurfaceResponse(sun, 'oblique');
    let moving = 0, brightest = 0, strongHighlights = 0, samples = 0;
    const skyOnly = createWaterSurfaceResponse(createIslandSun([], { ...DEFAULT_SUN, intensity: 0 }), 'oblique');
    for (let y = 0; y < 128; y += 2) for (let x = 0; x < 128; x += 2) {
      const color = shade(base, x, y, 0, 0, 1);
      const next = shade(base, x, y, 0.125, 0, 1);
      brightest = Math.max(brightest, ...color.map((v, i) => v - base[i]));
      const reflected = skyOnly(base, x, y, 0, 0, 1);
      if (color[0] - reflected[0] > 6) strongHighlights++;
      samples++;
      expect(Math.max(...color.map((v, i) => Math.abs(v - next[i])))).toBeLessThanOrEqual(3);
      if (color.some((v, i) => v !== next[i])) moving++;
      const sand = shade([120, 139, 120], x, y, 0, 0.7, 1);
      expect(sand[0] - color[0]).toBeGreaterThan(65);
      expect(sand[1] - color[1]).toBeGreaterThan(30);
    }
    expect(brightest).toBeLessThan(22);
    expect(strongHighlights).toBeLessThan(samples / 4);
    expect(moving).toBeGreaterThan(200);
  });

  it('receives sun shadows and sky fill independently, without a self-lit glow', () => {
    const dark = createWaterSurfaceResponse(createIslandSun([], { ...DEFAULT_SUN, intensity: 0, skyFill: 0 }), 'oblique');
    expect(dark([0, 0, 0], 24, 50, 2, 0, 1)).toEqual([0, 0, 0]);
    const shade = createWaterSurfaceResponse(sun, 'oblique');
    const sky = createWaterSurfaceResponse(createIslandSun([], { ...DEFAULT_SUN, intensity: 0 }), 'oblique');
    expect(shade(base, 24, 50, 2, 0, 0)).toEqual(sky(base, 24, 50, 2, 0, 1));
    const noShadows = createWaterSurfaceResponse(createIslandSun([], { ...DEFAULT_SUN, shadowStrength: 0 }), 'oblique');
    expect(noShadows(base, 24, 50, 2, 0, 0)).toEqual(shade(base, 24, 50, 2, 0, 1));
  });

  it('rejects nonfinite surface coordinates, time and view angles', () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(() => waterSurfaceNormal(value, 0, 0)).toThrow('finite');
      expect(() => waterSurfaceNormal(0, value, 0)).toThrow('finite');
      expect(() => waterSurfaceNormal(0, 0, value)).toThrow('finite');
      expect(() => waterViewDirection('oblique', value)).toThrow('finite');
    }
  });
});
