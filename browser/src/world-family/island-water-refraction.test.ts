import { describe, expect, it } from 'vitest';
import { createWaterRefraction, waterBedBlurRadius, waterRefractionOffset } from './render/island-water-refraction';
import type { LandRaster } from './render/landform-study';
import { projectLandVertex } from './core/landform-study';
import { waterViewDirection } from './render/island-water-surface';

const normal = { x: -0.15, y: 0, z: Math.sqrt(1 - 0.15 ** 2) };
function fixture() {
  const width = 8, height = 8, ground = -4.5;
  const original = new Uint8ClampedArray(width * height * 4);
  const raster: LandRaster = {
    pixels: original, depth: new Float64Array(width * height), levels: new Int8Array(width * height),
    submerged: new Uint8Array(width * height).fill(1),
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x;
    original.set([x * 30, y * 20, 70, 255], index * 4);
    raster.depth[index] = y + 0.5 + ground * 2;
  }
  const sample = (yaw = 0) => createWaterRefraction(raster, original, width, height, 0,
    'current', { yaw, center: { x: 64, y: 64 } });
  return { raster, original, width, height, ground, sample };
}

describe('guarded bottom refraction', () => {
  it('fades at shallow/contact edges and independently caps flat and ripple bends', () => {
    expect(waterRefractionOffset(0, 12, normal)).toEqual({ x: 0, y: 0 });
    expect(waterRefractionOffset(3, 0.5, normal)).toEqual({ x: 0, y: 0 });
    expect(waterRefractionOffset(3, -4, normal)).toEqual({ x: 0, y: 0 });
    const offset = waterRefractionOffset(8, 24, { x: 0.8, y: 0.5, z: 0.2 });
    expect(Math.hypot(offset.x, offset.y)).toBeCloseTo(2.25, 12);
    const oblique = waterRefractionOffset(8, 24, { x: 0.8, y: 0.5, z: 0.2 }, waterViewDirection('oblique'));
    expect(Math.hypot(oblique.x, oblique.y)).toBeLessThanOrEqual(3.75);
    expect(waterRefractionOffset(0.75, 12, normal).x).toBeLessThan(waterRefractionOffset(2, 12, normal).x);
    expect(waterRefractionOffset(2, 1, normal).x).toBeLessThan(waterRefractionOffset(2, 12, normal).x);
  });

  it('bilinearly bends only the original bottom colors, in the rotated view direction', () => {
    const { raster, original, width, sample } = fixture();
    const index = 2 * width + 2;
    const before = original.slice(), depths = raster.depth.slice();
    for (const yaw of [0, Math.PI / 2]) {
      const offset = waterRefractionOffset(2, 12, normal, waterViewDirection('current', yaw));
      const screen = projectLandVertex({ ...offset, z: 0 }, 'current', { yaw, center: { x: 0, y: 0 } });
      const color = sample(yaw)(index, -2.5, 12, normal, { blur: false });
      expect(color[0]).toBeCloseTo(60 + screen.x * 30, 10);
      expect(color[1]).toBeCloseTo(40 + screen.y * 20, 10);
    }
    expect(sample()(index, -2.5, 12, normal)).toEqual(sample()(index, -2.5, 12, normal));
    expect(original).toEqual(before);
    expect(raster.depth).toEqual(depths);
  });

  it.each(['dry', 'foreground', 'gap', 'shelf-jump', 'marker'] as const)('rejects a %s tap instead of smearing it into water', kind => {
    const { raster, original, width, sample } = fixture();
    const index = 2 * width + 2;
    const ground = kind === 'dry' ? 0 : kind === 'foreground' ? 8 : kind === 'gap' ? -Infinity : -8;
    for (let neighbor = 0; neighbor < raster.depth.length; neighbor++) {
      if (neighbor === index) continue;
      original.set([255, 0, 255, 255], neighbor * 4);
      if (kind === 'marker') raster.submerged![neighbor] = 0;
      else raster.depth[neighbor] = Math.floor(neighbor / width) + 0.5 + ground * 2;
    }
    expect(sample()(index, -2.5, 12, normal, { blur: false })).toEqual([60, 40, 70]);
  });

  it('retains the original sample at the viewport edge and never distorts exposed pixels', () => {
    const { raster, width, sample } = fixture();
    expect(sample()(2 * width + 7, -2.5, 12, normal, { blur: false })[0]).toBe(210);
    raster.depth[2 * width + 2] = 2.5;
    expect(sample()(2 * width + 2, -2.5, 12, normal)).toEqual([60, 40, 70]);
  });

  it('rejects invalid optical inputs explicitly', () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(() => waterRefractionOffset(value, 12, normal)).toThrow('finite');
      expect(() => waterRefractionOffset(2, 12, { ...normal, x: value })).toThrow('finite');
    }
    expect(() => waterRefractionOffset(2, NaN, normal)).toThrow('finite');
    expect(() => waterRefractionOffset(-1, 12, normal)).toThrow('nonnegative');
  });

  it('accepts infinite signed distance for fields without a nearby coast', () => {
    expect(waterRefractionOffset(2, Infinity, normal)).toEqual(waterRefractionOffset(2, 128, normal));
    expect(waterRefractionOffset(2, -Infinity, normal)).toEqual(waterRefractionOffset(2, -8, normal));
  });

  it.each(['current', 'oblique'] as const)('bends a flat shallow-water ray in the %s view, not only tilted normals', projection => {
    const view = waterViewDirection(projection), flat = { x: 0, y: 0, z: 1 };
    const offset = waterRefractionOffset(0.75, 12, flat, view);
    const eta = 1 / 1.333;
    const rayZ = Math.sqrt(1 - eta * eta * (1 - view.z * view.z));
    const x = 0.75 * (view.x / view.z - eta * view.x / rayZ);
    const y = 0.75 * (view.y / view.z - eta * view.y / rayZ);
    const cap = Math.max(1, Math.hypot(x, y) / 1.5);
    expect(offset.x).toBeCloseTo(x / cap, 10);
    expect(offset.y).toBeCloseTo(y / cap, 10);
    expect(Math.hypot(offset.x, offset.y)).toBeGreaterThan(0.25);
    const rotated = waterRefractionOffset(0.75, 12, flat, waterViewDirection(projection, Math.PI / 2));
    expect(rotated.x).toBeCloseTo(offset.y, 10);
    expect(rotated.y).toBeCloseTo(-offset.x, 10);
    expect(waterRefractionOffset(0.75, 12, flat)).toEqual({ x: 0, y: 0 });
  });

  it('rejects downward normals and invalid viewing directions', () => {
    for (const z of [0, -1, NaN, Infinity]) {
      expect(() => waterRefractionOffset(1, 12, { x: 0, y: 0, z })).toThrow('upward');
      expect(() => waterRefractionOffset(1, 12, normal, { x: 0, y: 0, z })).toThrow('upward');
    }
  });

  it('keeps shallow detail sharp and progressively blurs submerged detail even with refraction disabled', () => {
    const { original, width, sample } = fixture();
    for (let i = 0; i < original.length / 4; i++) {
      const value = (i % width + Math.floor(i / width)) % 2 ? 200 : 40;
      original.set([value, value, value, 255], i * 4);
    }
    const index = 3 * width + 4, optics = sample();
    expect(waterBedBlurRadius(0.75)).toBe(0);
    expect(waterBedBlurRadius(5.5)).toBe(0.65);
    expect(waterBedBlurRadius(2)).toBeLessThan(0.15);
    expect(optics(index, -3.75, 12, normal, { refraction: false })).toEqual([200, 200, 200]);
    const soft = optics(index, -2.5, 12, normal, { refraction: false });
    expect(soft[0]).toBeGreaterThan(80);
    expect(soft[0]).toBeLessThan(200);
    expect(soft[1]).toBe(soft[0]);
    expect(optics(index, -2.5, 12, normal, { refraction: false, blur: false })).toEqual([200, 200, 200]);
  });

  it.each(['current', 'oblique'] as const)('does not flatten animated ripples when the %s flat bend reaches its cap', projection => {
    const view = waterViewDirection(projection);
    const left = waterRefractionOffset(4.75, 12, { x: -0.08, y: 0.06, z: 1 }, view);
    const right = waterRefractionOffset(4.75, 12, { x: 0.08, y: -0.06, z: 1 }, view);
    expect(Math.hypot(left.x - right.x, left.y - right.y)).toBeGreaterThan(1);
    for (const offset of [left, right]) expect(Math.hypot(offset.x, offset.y)).toBeLessThanOrEqual(3.75);
  });

  it.each(['dry', 'foreground', 'gap', 'shelf-jump', 'marker'] as const)(
    'guards all blur taps from %s colors, not just the refracted center', kind => {
      const { raster, original, width, sample } = fixture();
      for (let i = 0; i < original.length / 4; i++) original.set([60, 60, 60, 255], i * 4);
      const index = 3 * width + 3;
      for (const neighbor of [index + 1, index - width, index + width + 1]) {
        original.set([255, 0, 255, 255], neighbor * 4);
        const ground = kind === 'dry' ? 0 : kind === 'foreground' ? 8 : kind === 'gap' ? -Infinity : -8;
        if (kind === 'marker') raster.submerged![neighbor] = 0;
        else raster.depth[neighbor] = Math.floor(neighbor / width) + 0.5 + ground * 2;
      }
      const color = sample()(index, -2.5, 12, normal);
      for (const channel of color) expect(channel).toBeCloseTo(60, 12);
    },
  );

  it('rejects invalid blur depth', () => {
    for (const depth of [NaN, Infinity, -Infinity, -1])
      expect(() => waterBedBlurRadius(depth)).toThrow('finite nonnegative');
  });
});
