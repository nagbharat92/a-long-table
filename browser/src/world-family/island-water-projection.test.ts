import { describe, expect, it } from 'vitest';
import { createIslandOcean } from './render/island-ocean';
import { waterPaletteColor, WATER_PALETTE_GLSL } from './render/island-water-color';
import { sampleWaterNoise, WATER_NOISE_GLSL } from './render/island-water-noise';
import {
  projectedWaterColor, sampleProjectedWaterMasks, WATER_PROJECTED_PALETTE_STEPS,
  WATER_PROJECTED_TEXEL_SIZE, WATER_PROJECTION_GLSL, WATER_EDGE_MOTION_PERIOD, WATER_EDGE_MOTION_STRENGTH,
} from './render/island-water-projection';
import { DEFAULT_WATER_SETTINGS, resetWaterSettings, type WaterSettings } from './render/island-water-settings';
import type { SurfaceColor } from './render/island-surface';

const patches = createIslandOcean(153026).bake.patches;
const otherPatches = createIslandOcean(153027).bake.patches;
const settings = (overrides: Partial<WaterSettings> = {}): WaterSettings => ({ ...resetWaterSettings(), ...overrides });
const calm = settings({ noiseShallow: 0, noiseDeep: 0 });
const sample = (depth: number, x: number, y: number, input: Readonly<WaterSettings> = DEFAULT_WATER_SETTINGS, noise = true, seconds = 0) =>
  projectedWaterColor(depth, patches, x, y, seconds, input, noise);
const ramp = (input: Readonly<WaterSettings>) => Array.from({ length: WATER_PROJECTED_PALETTE_STEPS * 2 + 1 }, (_, stop) => {
  const first = stop <= WATER_PROJECTED_PALETTE_STEPS;
  const from = first ? input.shallow : input.middle, to = first ? input.middle : input.deep;
  const t = (first ? stop : stop - WATER_PROJECTED_PALETTE_STEPS) / WATER_PROJECTED_PALETTE_STEPS;
  return from.map((value, channel) => Math.floor(value + (to[channel] - value) * t + 0.5));
});

// Independent float32 reference for the GLSL math, including alpha texture reads.
function shaderReference(depth: number, source: Uint8Array, x: number, y: number, input: Readonly<WaterSettings>, enabled: boolean, seconds = 0): SurfaceColor {
  const f = Math.fround, add = (a: number, b: number) => f(f(a) + f(b));
  const sub = (a: number, b: number) => f(f(a) - f(b)), mul = (a: number, b: number) => f(f(a) * f(b));
  const div = (a: number, b: number) => f(f(a) / f(b));
  const mix = (a: number, b: number, t: number) => add(mul(a, sub(1, t)), mul(b, t));
  const clamp = (v: number, hi = 1) => Math.max(0, Math.min(hi, v));
  const mod = (v: number) => f(v - Math.floor(v / 256) * 256);
  const byte = (u: number, v: number) => source[mod(v) * 256 + mod(u)];
  const scalar = (u: number, v: number, time = 0) => {
    const tau = f(6.283185307179586), wrappedTime = sub(time, mul(Math.floor(div(time, 2560)), 2560));
    const phase = mul(wrappedTime, div(tau, 2560)), radius = mul(input.noiseSpeed, div(2560, tau));
    const dx = mul(radius, f(Math.sin(phase))), dy = mul(radius, sub(1, f(Math.cos(phase))));
    const px = mod(add(div(u, input.noiseScale), div(dx, input.noiseScale)));
    const py = mod(add(div(v, input.noiseScale), div(dy, input.noiseScale)));
    const ix = Math.floor(px), iy = Math.floor(py), fx = sub(px, ix), fy = sub(py, iy);
    const a = div(byte(ix, iy), 255), b = div(byte(ix + 1, iy), 255);
    const c = div(byte(ix, iy + 1), 255), d = div(byte(ix + 1, iy + 1), 255);
    return sub(mul(mix(mix(a, b, fx), mix(c, d, fx), fy), 2), 1);
  };
  const tx = Math.floor(f(x)), ty = Math.floor(f(y)), px = add(tx, 0.5), py = add(ty, 0.5);
  const shape = add(mul(scalar(add(px, 13), sub(py, 29)), 0.7), mul(scalar(sub(83, py), add(px, 137)), 0.3));
  const cx = mod(tx), cy = mod(ty);
  const a = byte(cx * 37 + cy * 17 + 91, cy * 53 - cx * 11 + 47);
  const b = byte(cx * 23 - cy * 41 + 173, cy * 31 + cx * 43 + 113);
  const dither = (mod(a * 73 + b * 151 + cx * 19 + cy * 29) + 0.5) / 256;
  const toneDither = (mod(a * 137 + b * 61 + cx * 43 + cy * 101 + 67) + 0.5) / 256;
  const blend = (p: number) => {
    const t = clamp(p);
    const cubic = mul(mul(t, t), sub(3, mul(2, t)));
    const quintic = mul(mul(mul(t, t), t), add(mul(t, sub(mul(t, 6), 15)), 10));
    return mix(quintic, cubic, f(input.blendSoftness));
  };
  const shallowBlend = blend(div(depth, input.transitionDepth));
  const deepBlend = blend(div(sub(depth, input.transitionDepth), sub(input.deepDepth, input.transitionDepth)));
  const amplitude = mix(input.noiseShallow, input.noiseDeep, clamp(div(depth, input.deepDepth)));
  const contrast = (a: SurfaceColor, b: SurfaceColor) => Math.max(1, ...a.map((c, i) => Math.abs(c - b[i])));
  const span = depth < input.transitionDepth ? contrast(input.shallow, input.middle) : contrast(input.middle, input.deep);
  const noise = enabled ? shape : 0;
  const position = clamp(add(mul(add(shallowBlend, deepBlend), 8), mul(div(mul(mul(noise, amplitude), 8), span), sub(1, deepBlend))), 16);
  const choose = (v: number, threshold: number) => Math.floor(v) + (sub(v, Math.floor(v)) > threshold ? 1 : 0);
  const fraction = sub(position, Math.floor(position));
  const strength = enabled ? mul(mul(0.25, clamp(div(amplitude, 2))), clamp(div(input.noiseSpeed, 0.2))) : 0;
  const time = sub(seconds, mul(Math.floor(div(seconds, 16)), 16));
  const phase = add(mul(time, f(2 * Math.PI / 16)), mul(shape, f(2 * Math.PI)));
  const motion = strength > 0 ? mul(f(Math.sin(phase)), strength) : 0;
  const coverage = add(position, mul(mul(mul(motion, 4), fraction), sub(1, fraction)));
  const stop = choose(coverage, dither), first = stop <= 8, t = (first ? stop : stop - 8) / 8;
  const from = first ? input.shallow : input.middle, to = first ? input.middle : input.deep;
  const toneNoise = enabled && amplitude > 0 ? scalar(px, py, seconds) : 0;
  const tone = choose(mul(toneNoise, amplitude), toneDither);
  const component = (channel: number) => clamp(Math.floor(add(mix(from[channel], to[channel], t), 0.5)) + tone, 255);
  return [component(0), component(1), component(2)];
}

describe('world-projected pixel water palette', () => {
  it('uses only 17 finite ramp shades without noisy shaping, not three harsh anchor bands', () => {
    const allowed = new Set(ramp(calm).map(color => color.join(','))), seen = new Set<string>();
    for (let step = 0; step <= 1600; step++) {
      const color = sample(step / 100, step * 7.25, step * -3.125, calm);
      expect(allowed.has(color.join(','))).toBe(true);
      expect(color.every(Number.isInteger)).toBe(true);
      seen.add(color.join(','));
    }
    expect(seen.size).toBe(17);
    expect(WATER_PROJECTED_TEXEL_SIZE).toBe(1);
    for (const depth of [0, calm.transitionDepth, calm.deepDepth, 1000]) {
      expect(sample(depth, 19, -47, calm)).toEqual(waterPaletteColor(depth, 0, calm));
    }
  });

  it.each([0.55, 1.35, 2.75, 4.25, 6.125, 8.75, 10.7])('dithers only the two neighbouring shades and averages the approved broad slope at depth %s', depth => {
    const colors = new Set<string>(), totals = [0, 0, 0];
    for (let y = -32; y < 32; y++) for (let x = -32; x < 32; x++) {
      const color = sample(depth, x, y, calm);
      colors.add(color.join(','));
      color.forEach((value, channel) => { totals[channel] += value; });
    }
    expect(colors.size).toBe(2);
    const continuous = waterPaletteColor(depth, 0, calm);
    totals.forEach((total, channel) => expect(Math.abs(total / 4096 - continuous[channel])).toBeLessThan(0.65));
  });

  it('has independent, approximately uniform fine dither rather than using smooth patch brightness as a threshold', () => {
    const histogram = new Array<number>(16).fill(0), tuples: (readonly [number, number, number])[] = [];
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const masks = sampleProjectedWaterMasks(patches, x, y, DEFAULT_WATER_SETTINGS);
      tuples.push(masks);
      histogram[Math.floor(masks[1] * 16)]++;
      expect(masks[0]).toBeGreaterThanOrEqual(-1);
      expect(masks[0]).toBeLessThanOrEqual(1);
      expect(masks[1]).toBeGreaterThan(0);
      expect(masks[1]).toBeLessThan(1);
    }
    histogram.forEach(count => expect(Math.abs(count - 1024)).toBeLessThan(140));
    const mean = (index: number) => tuples.reduce((sum, tuple) => sum + tuple[index], 0) / tuples.length;
    const averages = [mean(0), mean(1), mean(2)];
    const correlation = (a: number, b: number) => {
      let covariance = 0, va = 0, vb = 0;
      for (const tuple of tuples) {
        const da = tuple[a] - averages[a], db = tuple[b] - averages[b];
        covariance += da * db; va += da * da; vb += db * db;
      }
      return covariance / Math.sqrt(va * vb);
    };
    expect(Math.abs(correlation(0, 1))).toBeLessThan(0.04);
    expect(Math.abs(correlation(1, 2))).toBeLessThan(0.04);
  });

  it('shares exactly anchored texels for positive/negative coordinates and wraps fine seed sampling', () => {
    for (const [x, y] of [[17, 23], [-1, -1], [-317, 9]]) {
      const masks = sampleProjectedWaterMasks(patches, x, y, DEFAULT_WATER_SETTINGS);
      for (const offset of [0.0001, 0.25, 0.5, 0.9999]) {
        expect(sampleProjectedWaterMasks(patches, x + offset, y + offset, DEFAULT_WATER_SETTINGS)).toEqual(masks);
        expect(sample(2.125, x + offset, y + offset)).toEqual(sample(2.125, x, y));
      }
      expect(sampleProjectedWaterMasks(patches, x + 1, y, DEFAULT_WATER_SETTINGS)).not.toEqual(masks);
      expect(sampleProjectedWaterMasks(patches, x + 1024, y - 1024, DEFAULT_WATER_SETTINGS)).toEqual(masks);
    }
    expect(sampleProjectedWaterMasks(patches, -0.0001, 0, DEFAULT_WATER_SETTINGS))
      .toEqual(sampleProjectedWaterMasks(patches, -1, 0, DEFAULT_WATER_SETTINGS));
    expect(sampleProjectedWaterMasks(patches, -0.0001, 0, DEFAULT_WATER_SETTINGS))
      .not.toEqual(sampleProjectedWaterMasks(patches, 0, 0, DEFAULT_WATER_SETTINGS));
  });

  it('reuses seed data deterministically without mutating patches or settings', () => {
    const sameSeed = createIslandOcean(153026).bake.patches, before = patches.slice(), input = settings(), saved = structuredClone(input);
    let maskDifferences = 0, colorDifferences = 0;
    for (let i = 0; i < 256; i++) {
      const x = i * 11.25 - 400, y = i * -7.125 + 130;
      expect(projectedWaterColor(2.125, sameSeed, x, y, 8, input, true)).toEqual(sample(2.125, x, y, input, true, 8));
      if (sampleProjectedWaterMasks(patches, x, y, input)[1] !== sampleProjectedWaterMasks(otherPatches, x, y, input)[1]) maskDifferences++;
      if (projectedWaterColor(2.125, otherPatches, x, y, 0, input, true).join(',') !== sample(2.125, x, y, input).join(',')) colorDifferences++;
    }
    expect(maskDifferences).toBeGreaterThan(200);
    expect(colorDifferences).toBeGreaterThan(30);
    expect(patches).toEqual(before);
    expect(input).toEqual(saved);
  });

  it('preserves integer wrapping and exact float32 affine hashes after shader vectorization', () => {
    const mod = (value: number) => ((value % 256) + 256) % 256;
    for (const x of [-4294967313, -2049, -1, 0, 255, 256, 4294967313]) {
      const masks = sampleProjectedWaterMasks(patches, x, -x, DEFAULT_WATER_SETTINGS);
      const cx = mod(x), cy = mod(-x);
      const byte = (u: number, v: number) => patches[mod(v) * 256 + mod(u)];
      const a = byte(cx * 37 + cy * 17 + 91, cy * 53 - cx * 11 + 47);
      const b = byte(cx * 23 - cy * 41 + 173, cy * 31 + cx * 43 + 113);
      expect(masks.slice(1)).toEqual([
        ((a * 73 + b * 151 + cx * 19 + cy * 29) % 256 + 0.5) / 256,
        ((a * 137 + b * 61 + cx * 43 + cy * 101 + 67) % 256 + 0.5) / 256,
      ]);
    }
    const f = Math.fround;
    for (let x = 0; x < 256; x++) for (let y = 0; y < 256; y++) {
      expect(f(f(f(37 * x) + f(17 * y)) + 91)).toBe(x * 37 + y * 17 + 91);
      expect(f(f(f(-11 * x) + f(53 * y)) + 47)).toBe(y * 53 - x * 11 + 47);
      expect(f(f(f(23 * x) + f(-41 * y)) + 173)).toBe(x * 23 - y * 41 + 173);
      expect(f(f(f(43 * x) + f(31 * y)) + 113)).toBe(y * 31 + x * 43 + 113);
    }
    expect(WATER_PROJECTION_GLSL).toContain('mat2(37.,-11.,17.,53.)*c+vec2(91.,47.)');
    expect(WATER_PROJECTION_GLSL).toContain('mat2(23.,43.,-41.,31.)*c+vec2(173.,113.)');
    expect(WATER_PROJECTION_GLSL).toContain('a*vec2(73.,137.)+b*vec2(151.,61.)');
  });

  it('keeps shape and fine masks static, with speed zero freezing both coverage and tone', () => {
    const fast = settings({ noiseSpeed: 1 }), still = settings({ noiseSpeed: 0 });
    const x = -173.25, y = 81.5, masks = sampleProjectedWaterMasks(patches, x, y, fast);
    expect(sampleProjectedWaterMasks(patches, x, y, still)).toEqual(masks);
    for (const depth of [0.75, 2.125, 7.375, 16]) {
      const selected = (input: WaterSettings, seconds: number) => {
        const amplitude = input.noiseShallow + (input.noiseDeep - input.noiseShallow) * Math.min(1, depth / input.deepDepth);
        const target = sampleWaterNoise(patches, Math.floor(x) + 0.5, Math.floor(y) + 0.5, seconds, input) * amplitude;
        const tone = Math.floor(target) + (target - Math.floor(target) > masks[2] ? 1 : 0);
        return sample(depth, x, y, input, true, seconds).map(value => value - tone);
      };
      for (const time of [-2560, -0.125, 0, 8, 67.5, 2560, 1e6]) {
        expect(selected(still, time)).toEqual(selected(still, 0));
        expect(sample(depth, x, y, still, true, time)).toEqual(sample(depth, x, y, still));
        expect(sample(depth, x, y, calm, true, time)).toEqual(sample(depth, x, y, calm));
        expect(sample(depth, x, y, fast, false, time)).toEqual(sample(depth, x, y, calm));
      }
    }
  });

  it.each([DEFAULT_WATER_SETTINGS, settings({ noiseDeep: 0 })])('keeps noise-only animation meaningful, including shallow-only amplitude %j', input => {
    let evolved = 0, speedDifference = 0;
    for (let i = 0; i < 512; i++) {
      const x = i * -3.25 + 43.125, y = i * 7.5 - 800;
      const initial = sample(0.75, x, y, input), later = sample(0.75, x, y, input, true, 30);
      if (initial.join(',') !== later.join(',')) evolved++;
      const fast = { ...input, noiseSpeed: 1 };
      if (sample(0.75, x, y, fast, true, 30).join(',') !== later.join(',')) speedDifference++;
      const nextFrame = sample(0.75, x, y, input, true, 30 + 1 / 60);
      nextFrame.forEach((value, channel) => expect(Math.abs(value - later[channel])).toBeLessThanOrEqual(6));
      expect(sample(0.75, Math.floor(x) + 0.25, Math.floor(y) + 0.125, input, true, 30)).toEqual(later);
    }
    expect(evolved).toBeGreaterThan(20);
    expect(speedDifference).toBeGreaterThan(20);
  });

  it('evolves readable fringe clusters over 16 seconds without leaving their existing shade pair', () => {
    expect(WATER_EDGE_MOTION_PERIOD).toBe(16);
    expect(2560 % WATER_EDGE_MOTION_PERIOD).toBe(0);
    expect(WATER_EDGE_MOTION_STRENGTH).toBe(0.25);
    const allowed = ramp(DEFAULT_WATER_SETTINGS).map(color => color.join(','));
    const paletteStop = (depth: number, x: number, y: number, time: number) => {
      const amplitude = 2 + (0.5 - 2) * Math.min(1, depth / 12);
      const toneNoise = sampleWaterNoise(patches, x + 0.5, y + 0.5, time, DEFAULT_WATER_SETTINGS) * amplitude;
      const toneDither = sampleProjectedWaterMasks(patches, x, y, DEFAULT_WATER_SETTINGS)[2];
      const tone = Math.floor(toneNoise) + (toneNoise - Math.floor(toneNoise) > toneDither ? 1 : 0);
      const color = sample(depth, x, y, DEFAULT_WATER_SETTINGS, true, time);
      const stop = allowed.indexOf(color.map(value => value - tone).join(','));
      expect(stop).toBeGreaterThanOrEqual(0);
      return stop;
    };
    for (const depth of [0.875, 2.125, 7.375, 10.7]) {
      let evolved = 0, nextFrameChanges = 0, meanShift = 0;
      const count = 64 ** 2;
      for (let y = -32; y < 32; y++) for (let x = -32; x < 32; x++) {
        const stops = [0, 4, 8, 12, 16].map(time => paletteStop(depth, x, y, time));
        const next = paletteStop(depth, x, y, 4 + 1 / 60);
        expect(stops[4]).toBe(stops[0]);
        expect(Math.max(...stops) - Math.min(...stops)).toBeLessThanOrEqual(1);
        expect(Math.abs(next - stops[1])).toBeLessThanOrEqual(1);
        if (next !== stops[1]) nextFrameChanges++;
        if (new Set(stops).size > 1) evolved++;
        meanShift += stops[1] - stops[0];
      }
      expect(evolved / count).toBeGreaterThan(0.03);
      expect(evolved / count).toBeLessThan(0.5);
      expect(nextFrameChanges / count).toBeLessThan(0.005);
      expect(Math.abs(meanShift / count)).toBeLessThan(0.15);
    }
  });

  it('closes edge coverage and drifting tone across positive and negative clock wraps', () => {
    for (const input of [DEFAULT_WATER_SETTINGS, settings({ noiseSpeed: 1, noiseScale: 7.125, noiseShallow: 24, noiseDeep: 6 })]) {
      for (const depth of [0.75, 4.25, 16]) for (const time of [-2560, -0.125, 0, 37.125, 2559.875]) {
        expect(sample(depth, -107.125, 431.625, input, true, time))
          .toEqual(sample(depth, -107.125, 431.625, input, true, time + 2560));
      }
    }
  });

  it('never crosses into a third shade at near-anchor fractions throughout the depth ramp', () => {
    const shades = ramp(DEFAULT_WATER_SETTINGS).map(color => color.join(','));
    for (let step = 1; step < 400; step++) for (let i = 0; i < 12; i++) {
      const depth = step * 0.03, x = i * 37 - 201, y = step * 7 - 127;
      const color = waterPaletteColor(depth, 0), first = depth < 3.5;
      const progress = first ? (191 - color[1]) / 38 * 8 : 8 + (153 - color[1]) / 40 * 8;
      const offshore = first ? 0 : (153 - color[1]) / 40;
      const amplitude = 2 - 1.5 * depth / 12;
      const masks = sampleProjectedWaterMasks(patches, x, y, DEFAULT_WATER_SETTINGS);
      const position = Math.max(0, Math.min(16, progress + masks[0] * amplitude * 8 / (first ? 38 : 40) * (1 - offshore)));
      const pair = Math.floor(position);
      for (const seconds of [0, 2, 4, 6, 8, 10, 12, 14]) {
        const noise = sampleWaterNoise(patches, x + 0.5, y + 0.5, seconds, DEFAULT_WATER_SETTINGS) * amplitude;
        const tone = Math.floor(noise) + (noise - Math.floor(noise) > masks[2] ? 1 : 0);
        const stop = shades.indexOf(sample(depth, x, y, DEFAULT_WATER_SETTINGS, true, seconds)
          .map(value => value - tone).join(','));
        expect(stop === pair || stop === pair + 1).toBe(true);
      }
    }
  });

  it('keeps deep water quiet, preserves exact zero-amplitude anchors and never leaks bright shelf stops offshore', () => {
    const shallowOnly = settings({ noiseDeep: 0 }), deepOnly = settings({ noiseShallow: 0, noiseDeep: 6 });
    const colors = new Set<string>();
    for (let i = 0; i < 512; i++) for (const depth of [12, 16, 1000]) {
      const x = i * 2.375 - 700, y = i * 5.125 - 500, time = i * 7.125, color = sample(depth, x, y, DEFAULT_WATER_SETTINGS, true, time);
      colors.add(color.join(','));
      color.forEach((value, channel) => expect(Math.abs(value - DEFAULT_WATER_SETTINGS.deep[channel])).toBeLessThanOrEqual(1));
      expect(sample(depth, x, y, shallowOnly, true, time)).toEqual(shallowOnly.deep);
      expect(sample(depth, x, y, deepOnly, false)).toEqual(deepOnly.deep);
      const loud = sample(depth, x, y, deepOnly, true, time);
      loud.forEach((value, channel) => expect(Math.abs(value - deepOnly.deep[channel])).toBeLessThanOrEqual(6));
      expect(color).toEqual(sample(1000, x, y, DEFAULT_WATER_SETTINGS, true, time));
    }
    expect(colors.size).toBe(3);
  });

  it('uses independent scale, softness, depth/palette and shallow/deep amplitude controls', () => {
    const scaled = settings({ noiseScale: 11 }), softer = settings({ blendSoftness: 0 });
    const stronger = settings({ noiseShallow: 24, noiseDeep: 0 });
    const recolored = settings({ shallow: [140, 180, 220], middle: [70, 120, 170], deep: [20, 60, 90], transitionDepth: 2, deepDepth: 16 });
    const differences = [0, 0, 0];
    for (let i = 0; i < 512; i++) {
      const x = i * 7 - 500, y = i * -3 + 17, base = sample(0.875, x, y);
      const masks = sampleProjectedWaterMasks(patches, x, y, DEFAULT_WATER_SETTINGS);
      expect(sampleProjectedWaterMasks(patches, x, y, scaled).slice(1)).toEqual(masks.slice(1));
      for (const [index, input] of [scaled, softer, stronger].entries()) {
        if (sample(0.875, x, y, input).join(',') !== base.join(',')) differences[index]++;
      }
      expect(sample(0.875, x, y, stronger, false)).toEqual(sample(0.875, x, y, calm));
      expect(sample(16, x, y, recolored, false)).toEqual(recolored.deep);
      expect(sample(0, x, y, recolored, false)).toEqual(recolored.shallow);
      expect(sample(2, x, y, recolored, false)).toEqual(recolored.middle);
    }
    differences.forEach(count => expect(count).toBeGreaterThan(20));
  });

  it('uses only finite ramp stops plus integer shallow-to-deep tones for arbitrary noisy palettes, including saturated/equal colors', () => {
    for (const input of [
      settings({ noiseShallow: 24, noiseDeep: 6 }),
      settings({ shallow: [0, 255, 0], middle: [255, 0, 255], deep: [0, 255, 0], noiseDeep: 6 }),
      settings({ shallow: [100, 100, 100], middle: [100, 100, 100], deep: [100, 100, 100] }),
    ]) {
      const allowed = new Set<string>();
      const amplitude = Math.ceil(Math.max(input.noiseShallow, input.noiseDeep));
      for (const color of ramp(input)) for (let tone = -amplitude; tone <= amplitude; tone++) {
        allowed.add(color.map(value => Math.max(0, Math.min(255, value + tone))).join(','));
      }
      for (let i = 0; i < 1024; i++) {
        const color = sample(i / 64, i * -2.875, i * 5.25, input, true, i * 3.125);
        expect(allowed.has(color.join(','))).toBe(true);
        expect(color.every(value => Number.isInteger(value) && value >= 0 && value <= 255)).toBe(true);
      }
    }
  });

  it('matches float32 shader decisions at irregular and negative world coordinates with custom controls', () => {
    for (const input of [
      DEFAULT_WATER_SETTINGS, calm,
      settings({ transitionDepth: 2.125, deepDepth: 14.375, blendSoftness: 0.137, noiseShallow: 17.5, noiseDeep: 4.25, noiseScale: 7.125 }),
    ]) for (let i = 0; i < 512; i++) for (const time of [-0.125, 0, 8, 637.375, 2559.875, 2560]) {
      const depth = i * 0.03125, x = i * -13.125 + 133.25, y = i * 7.375 - 871.5;
      expect(sample(depth, x, y, input, i % 3 !== 0, time))
        .toEqual(shaderReference(depth, patches, x, y, input, i % 3 !== 0, time));
    }
    expect(WATER_PROJECTION_GLSL).toContain('floor(point/1.0)');
    expect(WATER_PROJECTION_GLSL).toContain('fract(pos)>cut');
    expect(WATER_PROJECTION_GLSL).toContain('drift*amp,masks.z');
    expect(WATER_PROJECTION_GLSL).toContain('sampleWaterNoise(floor(point/1.0)+0.5,seconds)');
    expect(WATER_PROJECTION_GLSL).toContain('pos+motion*4.*fraction*(1.-fraction)');
    expect(WATER_PROJECTION_GLSL).not.toMatch(/gl_FragCoord|dFdx|dFdy|fwidth|cos\(|extension/);
    expect(WATER_PROJECTION_GLSL).not.toMatch(/seconds[^,)]*[+*/-]/);
    expect(`${WATER_PALETTE_GLSL}${WATER_NOISE_GLSL}${WATER_PROJECTION_GLSL}`)
      .toContain('vec3 projectedWaterColor(float depth,vec2 point,float seconds,float enabled)');
  });

  it('rejects invalid depth, coordinates, seconds, noise toggle, sources and settings even offshore/disabled', () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(() => sample(value, 0, 0)).toThrow('finite and nonnegative');
      expect(() => sample(16, value, 0, calm, false)).toThrow('coordinates must be finite');
      expect(() => sample(16, 0, value, calm, false)).toThrow('coordinates must be finite');
      expect(() => sample(16, 0, 0, calm, false, value)).toThrow('seconds must be finite');
    }
    expect(() => sample(-1, 0, 0)).toThrow('finite and nonnegative');
    for (const source of [new Uint8Array(1), new Float32Array(65536), []]) {
      expect(() => projectedWaterColor(16, source as Uint8Array, 0, 0, 0, calm, false)).toThrow('256 by 256 Uint8Array');
    }
    expect(() => sample(16, 0, 0, calm, 1 as unknown as boolean)).toThrow('noiseEnabled must be boolean');
    for (const invalid of [settings({ noiseScale: 0 }), settings({ transitionDepth: 12 }), settings({ shallow: [0, 256, 0] })]) {
      const before = structuredClone(invalid);
      expect(() => sample(16, 0, 0, invalid, false)).toThrow();
      expect(invalid).toEqual(before);
    }
  });
});
