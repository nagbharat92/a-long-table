import { describe, expect, it } from 'vitest';
import { createIslandOcean } from './render/island-ocean';
import {
  waterBodyColor, waterPaletteColor, waterBedTransmission, waterTintedBed, WATER_MAX_DEPTH, WATER_BODY_GLSL, WATER_PALETTE_GLSL,
} from './render/island-water-color';
import { DEFAULT_WATER_SETTINGS, resetWaterSettings, type WaterSettings } from './render/island-water-settings';
import { createDefaultLayersInspection } from './render/landform-diagnostics';
import type { SurfaceColor } from './render/island-surface';

const ocean: SurfaceColor = DEFAULT_WATER_SETTINGS.deep;
const brightness = (color: SurfaceColor) => color.reduce((sum, value) => sum + value, 0);

describe('terrain-led base water', () => {
  it('distinguishes the requested lighter blue shallows, middle shelf and unchanged deep water', () => {
    const near = waterBodyColor(ocean, 0.75), shelf = waterBodyColor(ocean, 3.5);
    expect(brightness(near)).toBeGreaterThan(brightness(shelf) + 25);
    expect(brightness(shelf)).toBeGreaterThan(brightness(ocean) + 15);
    expect(near[1]).toBeGreaterThan(140);
    expect(near[2]).toBeGreaterThan(near[1]);
    expect(near[1]).toBeGreaterThan(near[0]);
    expect(waterBodyColor(ocean, WATER_MAX_DEPTH)).toEqual(ocean);
    expect(waterBodyColor(ocean, 1000)).toEqual(ocean);
  });

  it('retains shallow bottom detail and gradually obscures deeper shelves without changing dry wash', () => {
    expect(waterBedTransmission(0, true)).toBe(0.85);
    expect(waterBedTransmission(0.75, true)).toBeGreaterThan(0.75);
    expect(waterBedTransmission(0.75, true)).toBeLessThan(0.8);
    expect(waterBedTransmission(2, true)).toBeGreaterThan(0.5);
    expect(waterBedTransmission(2, true)).toBeLessThan(0.6);
    expect(waterBedTransmission(3.5, true)).toBeGreaterThan(0.2);
    expect(waterBedTransmission(3.5, true)).toBeLessThan(0.25);
    expect(waterBedTransmission(4.75, true)).toBeGreaterThan(0);
    expect(waterBedTransmission(4.75, true)).toBeLessThan(0.04);
    let previous = waterBedTransmission(0, true);
    for (let depth = 0; depth <= 8; depth += 0.125) {
      const transmission = waterBedTransmission(depth, true);
      expect(transmission).toBeLessThanOrEqual(previous);
      expect(previous - transmission).toBeLessThan(0.075);
      previous = transmission;
    }
    expect(waterBedTransmission(5.5, true)).toBe(0);
    expect(waterBedTransmission(12, true)).toBe(0);
    expect(waterBedTransmission(0.75, false)).toBeCloseTo(Math.exp(-0.75 * 0.22) * 0.55);
  });

  it('has continuous absorption without depth color bands', () => {
    let previous = waterBodyColor(ocean, 0);
    const colors = new Set<string>();
    for (let depth = 0.025; depth <= WATER_MAX_DEPTH; depth += 0.025) {
      const color = waterBodyColor(ocean, depth);
      colors.add(color.join(','));
      expect(Math.max(...color.map((value, channel) => Math.abs(value - previous[channel])))).toBeLessThanOrEqual(1);
      previous = color;
    }
    expect(colors.size).toBeGreaterThan(50);
  });

  it('passes continuously through all three editable anchors, independent of bottom transmission', () => {
    expect(waterPaletteColor(0, 0)).toEqual(DEFAULT_WATER_SETTINGS.shallow);
    expect(waterPaletteColor(DEFAULT_WATER_SETTINGS.transitionDepth, 0)).toEqual(DEFAULT_WATER_SETTINGS.middle);
    expect(waterPaletteColor(DEFAULT_WATER_SETTINGS.deepDepth, 0)).toEqual(DEFAULT_WATER_SETTINGS.deep);
    expect(waterBedTransmission(5.5, true)).toBe(0);
    expect(waterPaletteColor(0.75, 0)[1]).toBeGreaterThan(140);
    const input: WaterSettings = {
      ...resetWaterSettings(), shallow: [125, 180, 200], middle: [68, 130, 160], deep: [20, 70, 110],
      transitionDepth: 2.5, deepDepth: 16,
    };
    const before = structuredClone(input);
    expect(waterPaletteColor(0, 0, input)).toEqual(input.shallow);
    expect(waterPaletteColor(2.5, 0, input)).toEqual(input.middle);
    expect(waterPaletteColor(16, 0, input)).toEqual(input.deep);
    for (const depth of [0, 2.5, 16]) {
      const left = waterPaletteColor(Math.max(0, depth - 1e-5), 0, input), right = waterPaletteColor(depth + 1e-5, 0, input);
      expect(Math.max(...left.map((c, channel) => Math.abs(c - right[channel])))).toBeLessThan(0.001);
    }
    expect(input).toEqual(before);
  });

  it.each([0, 0.65, 1])('keeps the default ramp monotonic and fractional for blend softness %s', blendSoftness => {
    const input = { ...resetWaterSettings(), blendSoftness };
    let previous = waterPaletteColor(0, 0, input), fractional = 0;
    for (let step = 1; step <= 1600; step++) {
      const current = waterPaletteColor(step / 100, 0, input);
      for (let channel = 0; channel < 3; channel++) {
        expect(current[channel]).toBeLessThanOrEqual(previous[channel] + 1e-12);
        expect(previous[channel] - current[channel]).toBeLessThan(0.25);
        if (!Number.isInteger(current[channel])) fractional++;
      }
      previous = current;
    }
    expect(fractional).toBeGreaterThan(1000);
    expect(previous).toEqual(ocean);
  });

  it('keeps default depth darkening monotonic even at both signed-noise extremes', () => {
    for (const scalar of [-1, 1]) {
      let previous = waterPaletteColor(0, scalar);
      for (let step = 1; step <= 1600; step++) {
        const current = waterPaletteColor(step / 100, scalar);
        for (let channel = 0; channel < 3; channel++) {
          expect(current[channel]).toBeLessThanOrEqual(previous[channel] + 1e-12);
        }
        previous = current;
      }
    }
  });

  it('has exact constant deep color when amplitudes are zero and bounded independent shallow/deep noise', () => {
    const calm = { ...resetWaterSettings(), noiseShallow: 0, noiseDeep: 0 };
    for (const depth of [12, 16, 1000]) for (const scalar of [-1, -0.25, 0, 0.75, 1]) {
      expect(waterPaletteColor(depth, scalar, calm)).toEqual(ocean);
    }
    expect(waterPaletteColor(WATER_MAX_DEPTH, 0)).toEqual(ocean);
    expect(waterPaletteColor(WATER_MAX_DEPTH, 1)[1] - ocean[1]).toBe(DEFAULT_WATER_SETTINGS.noiseDeep);
    const shallowOnly = { ...resetWaterSettings(), noiseDeep: 0 };
    expect(waterPaletteColor(0, 1, shallowOnly)[1] - waterPaletteColor(0, -1, shallowOnly)[1]).toBe(4);
    expect(waterPaletteColor(16, 1, shallowOnly)).toEqual(ocean);
    for (let depth = 0; depth <= 16; depth += 0.125) {
      const calmColor = waterPaletteColor(depth, 0), noisy = waterPaletteColor(depth, 1);
      expect(Math.max(...noisy.map((c, channel) => Math.abs(c - calmColor[channel])))).toBeLessThanOrEqual(2);
      const darkest = waterPaletteColor(depth, -1);
      expect(Math.max(...noisy.map((c, channel) => c - darkest[channel]))).toBeLessThanOrEqual(4);
      expect(waterPaletteColor(depth, 100)).toEqual(noisy);
      expect(waterPaletteColor(depth, -100)).toEqual(waterPaletteColor(depth, -1));
    }
    const blackWhite = { ...resetWaterSettings(), shallow: [0, 255, 0] as const, deep: [255, 0, 255] as const };
    expect(waterPaletteColor(0, -1, blackWhite)).toEqual([0, 253, 0]);
    expect(waterPaletteColor(0, 1, blackWhite)).toEqual([2, 255, 2]);
  });

  it('keeps legacy deep anchors while explicit settings and signed noise own the full body palette', () => {
    const legacyOcean: SurfaceColor = [43, 98, 111];
    expect(waterBodyColor(legacyOcean, 16)).toEqual(legacyOcean);
    expect(waterBodyColor(legacyOcean, 16, DEFAULT_WATER_SETTINGS)).toEqual(ocean);
    expect(waterBodyColor(legacyOcean, 0.75, DEFAULT_WATER_SETTINGS, -0.5))
      .toEqual(waterPaletteColor(0.75, -0.5));
  });

  it('rejects invalid depths, noise and settings in the primary palette without mutating inputs', () => {
    for (const depth of [NaN, Infinity, -Infinity, -1]) expect(() => waterPaletteColor(depth, 0)).toThrow('finite and nonnegative');
    for (const scalar of [NaN, Infinity, -Infinity]) expect(() => waterPaletteColor(1, scalar)).toThrow('signedNoise must be finite');
    const invalid = { ...resetWaterSettings(), transitionDepth: 12 }, before = structuredClone(invalid);
    expect(() => waterPaletteColor(1, 0, invalid)).toThrow('transitionDepth must be less than deepDepth');
    expect(() => waterBodyColor(ocean, 1, invalid)).toThrow();
    expect(invalid).toEqual(before);
  });

  it('tints real bottom luminance with water hue while retaining readable texture contrast', () => {
    const water: SurfaceColor = [54, 191, 193];
    const bright = waterTintedBed([162, 153, 111], water);
    const dark = waterTintedBed([144, 136, 98], water);
    expect(bright[1] - dark[1]).toBeGreaterThan(30);
    for (const color of [bright, dark, waterTintedBed([0, 0, 0], water)]) {
      expect(color[0] / color[1]).toBeCloseTo(water[0] / water[1], 8);
      expect(color[1] / color[2]).toBeCloseTo(water[1] / water[2], 8);
      expect(color.every(value => value >= 0 && value <= 255)).toBe(true);
    }
    expect(waterTintedBed([140, 140, 140], water)).toEqual(water);
    const grain = waterTintedBed([173, 163, 121], water);
    expect(grain[1] - bright[1]).toBeGreaterThan(20);
    waterTintedBed([255, 255, 255], [200, 200, 200])
      .forEach(channel => expect(channel).toBeCloseTo(255, 10));
  });

  it('shares the encoded GPU palette, tinted bottom and distinct seabed/dry-wash transmission', () => {
    for (const name of ['u_waterShallow', 'u_waterMiddle', 'u_waterDeep', 'u_waterDepth', 'u_waterNoise']) {
      expect(WATER_PALETTE_GLSL).toContain(name);
    }
    expect(WATER_PALETTE_GLSL).toContain('u_waterDepth,u_waterNoise.xy');
    expect(WATER_BODY_GLSL).not.toMatch(/floor|pow|dFdx|dFdy|fwidth|extension/);
    expect(WATER_BODY_GLSL).toContain('exp(-max(0.0,depth)*0.22-max(0.0,depth-0.75)*0.1)');
    expect(WATER_BODY_GLSL).toContain('*0.55*(1.0-smoothstep(0.75,3.5,depth))');
    expect(WATER_BODY_GLSL).toContain('exp(-max(0.0,depth)*0.12)*0.85*(1.0-smoothstep(0.75,5.5,depth))');
    expect(WATER_BODY_GLSL).toContain('vec3 waterTintedBed');
    for (let depth = 0; depth <= 16; depth += 0.125) for (const bed of [true, false]) {
      const t = Math.max(0, Math.min(1, (depth - 0.75) / ((bed ? 5.5 : 3.5) - 0.75)));
      const expected = (bed ? Math.exp(-depth * 0.12) * 0.85
        : Math.exp(-depth * 0.22 - Math.max(0, depth - 0.75) * 0.1) * 0.55)
        * (1 - t * t * (3 - 2 * t));
      expect(waterBedTransmission(depth, bed)).toBe(expected);
    }
  });

  it('rejects invalid depth instead of returning invalid colors or transmission', () => {
    for (const depth of [NaN, Infinity, -Infinity, -1]) {
      expect(() => waterBodyColor(ocean, depth)).toThrow('finite and nonnegative');
      expect(() => waterBedTransmission(depth, true)).toThrow('finite and nonnegative');
    }
  });

  it.each([153026, 153027, 153028])('limits offshore base variation to four byte levels for seed %i', seed => {
    const points: number[] = [];
    for (let y = 0; y < 512; y += 4) for (let x = 0; x < 512; x += 4) points.push(x, y);
    const frame = createIslandOcean(seed).prepare(new Float64Array(points));
    for (let channel = 0; channel < 3; channel++) {
      let minimum = 255, maximum = 0;
      for (let i = channel; i < frame.basePixels.length; i += 4) {
        minimum = Math.min(minimum, frame.basePixels[i]);
        maximum = Math.max(maximum, frame.basePixels[i]);
      }
      expect(maximum - minimum).toBeGreaterThan(0);
      expect(maximum - minimum).toBeLessThanOrEqual(4);
    }
  });

  it('keeps quiet variation stationary, enables beach wash, and leaves legacy ripples inspection-only', () => {
    const water = createDefaultLayersInspection().water;
    expect(water.surfaceHighlights).toBe(false);
    expect(water.surfaceResponse).toBe(true);
    expect(water.waves).toBe(false);
    expect(water.shoreFoam).toBe(true);
    const sampler = createIslandOcean(153025);
    const frame = sampler.prepare(new Float64Array([0, 0, 17, 24, 128, 64]));
    const base = frame.basePixels.slice();
    frame.animate(20);
    expect(frame.basePixels).toEqual(base);
  });
});
