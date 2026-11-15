import { describe, expect, it } from 'vitest';
import { createIslandOcean } from './render/island-ocean';
import { waterPaletteColor } from './render/island-water-color';
import {
  sampleWaterNoise, WATER_NOISE_GLSL, WATER_NOISE_PATCH_SIZE, WATER_NOISE_TIME_PERIOD,
} from './render/island-water-noise';
import { DEFAULT_WATER_SETTINGS, resetWaterSettings, type WaterSettings } from './render/island-water-settings';

const settings = (overrides: Partial<WaterSettings> = {}): WaterSettings => ({ ...resetWaterSettings(), ...overrides });
const patches = createIslandOcean(153026).bake.patches;

describe('coherent baked water patch sampling', () => {
  it('reads the supplied scalar bytes with fractional bilinear filtering, including negative coordinates', () => {
    const supplied = Uint8Array.from({ length: 256 * 256 }, (_, i) => (i % 256 + Math.floor(i / 256)) % 256);
    const before = supplied.slice(), still = settings({ noiseSpeed: 0 });
    expect(sampleWaterNoise(supplied, 0, 0, 0, still)).toBe(-1);
    expect(sampleWaterNoise(supplied, 2, 1, 123, still)).toBeCloseTo(0.75 / 255 * 2 - 1, 14);
    expect(sampleWaterNoise(supplied, 4, 4, -2560, still)).toBeCloseTo(2 / 255 * 2 - 1, 14);
    expect(sampleWaterNoise(supplied, -1, 0, 0, still)).toBeCloseTo(63.75 / 255 * 2 - 1, 14);
    expect(supplied).toEqual(before);
    expect(sampleWaterNoise(new Uint8Array(256 * 256), -1.5, 9.2, 500)).toBe(-1);
    expect(sampleWaterNoise(new Uint8Array(256 * 256).fill(255), -1.5, 9.2, 500)).toBe(1);
    expect(WATER_NOISE_PATCH_SIZE).toBe(256);
    expect(WATER_NOISE_TIME_PERIOD).toBe(2560);
  });

  it('is deterministic, seed-led, and spatially periodic without integer world snapping', () => {
    const sameSeed = createIslandOcean(153026).bake.patches, otherSeed = createIslandOcean(153027).bake.patches;
    const before = patches.slice();
    let seedDifference = 0, fractionalDifference = 0;
    for (const [x, y] of [[-317.8, -42.2], [-1.125, 0.25], [17.21, 33.14], [407.15, 902.85]]) {
      const value = sampleWaterNoise(patches, x, y, 37.125);
      expect(sampleWaterNoise(sameSeed, x, y, 37.125)).toBe(value);
      expect(sampleWaterNoise(patches, x + 1024, y - 1024, 37.125)).toBeCloseTo(value, 13);
      seedDifference += Math.abs(value - sampleWaterNoise(otherSeed, x, y, 37.125));
      fractionalDifference += Math.abs(value - sampleWaterNoise(patches, Math.floor(x), Math.floor(y), 37.125));
    }
    expect(seedDifference).toBeGreaterThan(0.1);
    expect(fractionalDifference).toBeGreaterThan(0.0001);
    expect(patches).toEqual(before);
  });

  it.each([
    [0, 1], [0.137, 7.125], [0.2, 4], [1, 32], [0.999, 1],
  ])('closes continuously over positive/negative clock wraps for speed %s and scale %s', (noiseSpeed, noiseScale) => {
    const input = settings({ noiseSpeed, noiseScale }), before = structuredClone(input);
    for (const [x, y] of [[-981.125, -1.5], [0, 0], [417.8125, 93.0625]]) {
      expect(sampleWaterNoise(patches, x, y, 0, input)).toBe(sampleWaterNoise(patches, x, y, 2560, input));
      expect(sampleWaterNoise(patches, x, y, -2560, input)).toBe(sampleWaterNoise(patches, x, y, 0, input));
      expect(sampleWaterNoise(patches, x, y, -0.125, input)).toBe(sampleWaterNoise(patches, x, y, 2559.875, input));
      expect(sampleWaterNoise(patches, x, y, 37.125, input)).toBe(sampleWaterNoise(patches, x, y, 2597.125, input));
      expect(Math.abs(sampleWaterNoise(patches, x, y, -0.00001, input) - sampleWaterNoise(patches, x, y, 0.00001, input)))
        .toBeLessThan(0.00005);
    }
    expect(input).toEqual(before);
  });

  it('keeps signed samples bounded and temporal/spatial frame changes gentle', () => {
    let animatedDifference = 0;
    for (let i = 0; i < 250; i++) {
      const x = i * 5.125 - 512, y = i * 7.375 - 1024, time = i * 10.25;
      const value = sampleWaterNoise(patches, x, y, time);
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThanOrEqual(1);
      expect(Math.abs(value - sampleWaterNoise(patches, x, y, time + 1 / 60))).toBeLessThan(0.005);
      expect(Math.abs(value - sampleWaterNoise(patches, x + 0.01, y - 0.01, time))).toBeLessThan(0.01);
      const color = waterPaletteColor(0.75, value), nextColor = waterPaletteColor(0.75, sampleWaterNoise(patches, x, y, time + 1 / 60));
      expect(Math.max(...color.map((c, channel) => Math.abs(c - nextColor[channel])))).toBeLessThan(0.04);
      animatedDifference += Math.abs(value - sampleWaterNoise(patches, x, y, time + 10));
    }
    expect(animatedDifference).toBeGreaterThan(0.1);
  });

  it('does not derive scalar noise from deep amplitude, so noiseDeep zero leaves shallow variation alive', () => {
    const input = settings({ noiseDeep: 0 });
    let shallowDifference = 0;
    for (let x = -100; x <= 100; x += 10) {
      const scalar = sampleWaterNoise(patches, x, 13.5, 20, input);
      expect(scalar).toBe(sampleWaterNoise(patches, x, 13.5, 20));
      const color = waterPaletteColor(0.75, scalar, input), calm = waterPaletteColor(0.75, 0, input);
      shallowDifference += Math.abs(color[1] - calm[1]);
      expect(waterPaletteColor(16, scalar, input)).toEqual(DEFAULT_WATER_SETTINGS.deep);
    }
    expect(shallowDifference).toBeGreaterThan(1);
  });

  it('supports still noise, changed scale and rejected invalid sources/input without mutation', () => {
    const still = settings({ noiseSpeed: 0 }), scaled = settings({ noiseScale: 7.125 });
    expect(sampleWaterNoise(patches, -17.5, 47.25, 0, still)).toBe(sampleWaterNoise(patches, -17.5, 47.25, 2399, still));
    expect(sampleWaterNoise(patches, 17.5, 47.25, 0, scaled)).not.toBe(sampleWaterNoise(patches, 17.5, 47.25, 0));
    for (const source of [new Uint8Array(255 * 256), new Float32Array(256 * 256), []]) {
      expect(() => sampleWaterNoise(source as Uint8Array, 0, 0, 0)).toThrow('256 by 256 Uint8Array');
    }
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(() => sampleWaterNoise(patches, value, 0, 0)).toThrow('must be finite');
      expect(() => sampleWaterNoise(patches, 0, value, 0)).toThrow('must be finite');
      expect(() => sampleWaterNoise(patches, 0, 0, value)).toThrow('must be finite');
    }
    const invalid = settings({ noiseScale: 0 }), before = structuredClone(invalid);
    expect(() => sampleWaterNoise(patches, 0, 0, 0, invalid)).toThrow('noiseScale');
    expect(invalid).toEqual(before);
  });

  it('keeps the shader alpha data sampling unsnapped, bilinear and periodically bounded without derivatives', () => {
    expect(WATER_NOISE_GLSL).toContain(').a;');
    expect(WATER_NOISE_GLSL).toContain('u_patches,worldPoint,seconds,u_waterNoise.zw');
    expect(WATER_NOISE_GLSL).toContain('mix(mix(a,b,blend.x),mix(c,d,blend.x),blend.y)*2.0-1.0');
    expect(WATER_NOISE_GLSL).toContain('radius*vec2(sin(phase),1.0-cos(phase))');
    expect(WATER_NOISE_GLSL).not.toMatch(/dFdx|dFdy|fwidth|extension|floor\(worldPoint|random|hash/);
  });
});
