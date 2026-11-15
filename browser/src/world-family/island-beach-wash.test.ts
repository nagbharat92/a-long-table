import { describe, expect, it } from 'vitest';
import { BEACH_WASH_GLSL, BEACH_WASH_MAX_HEIGHT, BEACH_WASH_PERIOD, BEACH_WASH_REACH, BEACH_WAVE_OFFSHORE, DEFAULT_BEACH_WAVE_END_SOFTNESS, beachWaveAt, beachWaveGradient, sampleBeachWash, shoreWaveWeight } from './render/island-beach-wash';
import { ISLAND_WATER_HEIGHT } from './core/island-water-level';
import type { IslandShoreSample } from './render/island-shore-field';
import { compositeWaterFoam } from './render/island-water-foam';
import type { SurfaceColor } from './render/island-surface';

const shore = (distance: number): IslandShoreSample => ({
  distance, beachDistance: Math.abs(distance), cliffDistance: 40,
  beachWeight: 1, kind: 'beach', phase: 0, breakup: 0.4,
  variation: 0, wetWidth: 2.2, shallowWidth: 12,
});

const smooth = (a: number, b: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function originalWave(distance: number, cycle: number, beach: number) {
  const advance = smooth(0.04, 0.36, cycle) * (1 - smooth(0.44, 0.9, cycle));
  const front = 5 - advance * 12 + (1 - smooth(0, 0.15, cycle)) * 10;
  const envelope = smooth(0, 0.1, cycle) * (1 - smooth(0.9, 1, cycle));
  const coverage = smooth(front - 0.7, front + 0.7, distance)
    * (1 - smooth(14, 18, distance)) * envelope * beach;
  const runup = 2 * advance * smooth(front - 0.8, front + 2.4, distance)
    * (1 - smooth(5, 9, distance)) * beach;
  const crest = 0.78 * (1 - smooth(0.3, 3.3, Math.abs(distance - front - 0.9)))
    * smooth(0, 0.04, cycle) * (1 - smooth(0.4, 0.65, cycle)) * smooth(-2, 1, distance) * beach;
  return { coverage, height: ISLAND_WATER_HEIGHT + Math.max(runup, crest), front };
}

function originalFoam(sample: IslandShoreSample, cycle: number, ground: number) {
  const seconds = cycle * BEACH_WASH_PERIOD;
  const current = beachWaveAt(sample.distance, 0, sample.beachWeight, seconds);
  const coverage = sampleBeachWash(sample, seconds, ground).coverage;
  const breaking = smooth(0.04, 0.18, cycle) * (1 - smooth(0.46, 0.66, cycle));
  const distanceEdge = 1 - smooth(0.18, 1.1, Math.abs(sample.distance - current.front));
  const heightEdge = 1 - smooth(0.08, 0.42, Math.abs(current.height - ground));
  const frontFoam = Math.max(distanceEdge, ground > ISLAND_WATER_HEIGHT + 0.05 ? heightEdge * coverage : 0)
    * breaking;
  const behind = sample.distance - current.front;
  const residue = smooth(0.4, 1.4, behind) * (1 - smooth(2, 4.5, behind))
    * smooth(0.22, 0.42, cycle) * (1 - smooth(0.62, 0.86, cycle));
  const pores = 0.5 + 0.5 * Math.sin(sample.distance * 1.7 + sample.breakup * 23);
  const patches = smooth(0.2 + cycle * 0.5, 0.85, pores);
  return Math.max(frontFoam, residue * patches * 0.28)
    * smooth(-0.12, 0.3, sample.breakup) * sample.beachWeight * smooth(0.6, 0.9, sample.beachWeight)
    * smooth(0, 0.35, coverage) * 0.65;
}

// Evaluate the actual scalar GLSL equations, rather than maintaining a second CPU foam implementation.
const glslBeach = new Function('smoothstep', 'fract', 'sin', 'abs', 'max', 'clamp', 'sign', 'mod', 'vec2', 'vec3', 'vec4', 'u_waveEndSoftness',
  BEACH_WASH_GLSL
    .replace(/uniform float u_waveEndSoftness;/, '')
    .replace(/\b(?:float|vec[234]) (\w+)\(([^)]*)\)\s*\{/g,
      (_, name: string, args: string) => `function ${name}(${args.replace(/\b(?:float|vec[234]) /g, '')}) {`)
    .replace(/\b(?:float|vec[234]) (\w+)=/g, 'const $1=')
  + '; return { wash: beachWash, gradient: beachWaveGradient };');
const evaluateBeachGLSL = (endSoftness = DEFAULT_BEACH_WAVE_END_SOFTNESS) => glslBeach(
  smooth, (value: number) => value - Math.floor(value), Math.sin, Math.abs, Math.max,
  (value: number, a: number, b: number) => Math.max(a, Math.min(b, value)), Math.sign,
  (value: number, period: number) => value - period * Math.floor(value / period),
  (x: number, y: number) => ({ x, y }),
  (x: number, y: number, z: number) => ({ x, y, z }),
  (x: number, y = x, z = x, w = x) => Object.assign([x, y, z, w], { x, y, z, w }),
  endSoftness,
) as {
  wash(distance: number, beach: number, phase: number, breakup: number, seconds: number, ground: number): number[];
  gradient(distance: number, cycle: number, beach: number,
    distanceGradient: { x: number; y: number }, beachGradient: { x: number; y: number }): { x: number; y: number };
};
const { wash: glslWash } = evaluateBeachGLSL();

describe('terrain-led beach run-up', () => {
  it('approaches from the sea, reaches low sand, and fully retreats each cycle', () => {
    const front = (cycle: number) => {
      for (let distance = -BEACH_WASH_REACH; distance < 9; distance += 0.025) {
        if (sampleBeachWash(shore(distance), cycle * BEACH_WASH_PERIOD).coverage > 0.5) return distance;
      }
      throw new Error('Expected an active wash front.');
    };
    expect(BEACH_WASH_PERIOD).toBe(8);
    expect(2560 % BEACH_WASH_PERIOD).toBe(0);
    expect(front(0.15)).toBeGreaterThan(1);
    expect(front(0.35)).toBeLessThan(-5);
    expect(front(0.45)).toBeLessThan(-6);
    expect(front(0.7)).toBeGreaterThan(front(0.45) + 5);
    expect(front(0.78)).toBeGreaterThan(1);
    for (const distance of [-3, -1, 0, 3, 5]) {
      expect(sampleBeachWash(shore(distance), 0)).toMatchObject({ coverage: 0, foam: 0 });
      expect(sampleBeachWash(shore(distance), BEACH_WASH_PERIOD)).toMatchObject({ coverage: 0, foam: 0 });
    }
  });

  it('has a broad near-opaque breaking core with an irregular porous perimeter, not globally transparent lace', () => {
    const step = 0.025, ground = ISLAND_WATER_HEIGHT - 0.3;
    for (const cycle of [0.18, 0.28, 0.4, 0.5]) {
      const { front } = beachWaveAt(0, 0, 1, cycle * BEACH_WASH_PERIOD);
      const fringe: number[] = [];
      for (const breakup of [-0.7, -0.3, 0, 0.2, 0.4, 0.7]) {
        let dense = 0, active = 0, previousActive = 0, mass = 0, previousMass = 0;
        for (let distance = front - 0.7; distance < Math.min(front + 8, 17); distance += step) {
          const sample = { ...shore(distance), breakup };
          const foam = sampleBeachWash(sample, cycle * BEACH_WASH_PERIOD, ground).foam;
          const previous = originalFoam(sample, cycle, ground);
          if (foam > 0.9) dense++;
          if (foam > 0.1) active++;
          if (previous > 0.1) previousActive++;
          mass += foam;
          previousMass += previous;
        }
        expect(dense * step).toBeGreaterThan(1.3);
        expect(active * step).toBeGreaterThan(2);
        expect(active).toBeGreaterThan(previousActive * 1.7);
        expect(mass).toBeGreaterThan(previousMass * 2.5);
        for (const offset of [-0.4, 0, 0.4]) {
          fringe.push(sampleBeachWash({ ...shore(front + offset), breakup }, cycle * BEACH_WASH_PERIOD, ground).foam);
        }
      }
      expect(fringe.some(foam => foam < 0.1)).toBe(true);
      expect(fringe.some(foam => foam > 0.2)).toBe(true);
    }
  });

  it('blends the trailing foam gradually back to blue without bright speckles or holes', () => {
    const step = 0.025, ground = ISLAND_WATER_HEIGHT - 0.3;
    const water: SurfaceColor = [45, 100, 113];
    for (const cycle of [0.28, 0.36, 0.44]) {
      const seconds = cycle * BEACH_WASH_PERIOD;
      const { front } = beachWaveAt(0, 0, 1, seconds);
      for (const breakup of [-0.7, -0.3, 0, 0.2, 0.4, 0.7]) {
        let previous = 1, start = 0, gradients = 0;
        for (let behind = 4.5; behind <= 10; behind += step) {
          const wash = sampleBeachWash({ ...shore(front + behind), breakup }, seconds, ground);
          expect(wash.coverage).toBeGreaterThan(0.9);
          if (behind === 4.5) start = wash.foam;
          expect(wash.foam).toBeLessThanOrEqual(previous);
          if (behind > 4.5) expect(previous - wash.foam).toBeLessThan(0.006);
          if (wash.foam > 0.05 && wash.foam < 0.4) gradients++;
          const color = compositeWaterFoam(water, wash.foam);
          expect(color[0]).toBeLessThan(150);
          previous = wash.foam;
        }
        expect(start).toBeGreaterThan(0.4);
        expect(previous).toBeLessThan(0.001);
        expect(gradients * step).toBeGreaterThan(2.5);
      }
      for (const behind of [4.5, 6, 8, 9.5]) {
        const values = Array.from({ length: 201 }, (_, i) =>
          sampleBeachWash({ ...shore(front + behind), breakup: -1 + i * 0.01 }, seconds, ground).foam);
        expect(Math.max(...values) - Math.min(...values)).toBeLessThan(Math.max(...values) * 0.041);
      }
    }
  });

  it('fades the anchored trail smoothly through retreat without reappearing', () => {
    const ground = ISLAND_WATER_HEIGHT - 0.3;
    const mass = [0, 0, 0, 0, 0];
    for (const breakup of [-0.7, -0.3, 0, 0.2, 0.4, 0.7]) {
      for (let distance = -2.5; distance < 3; distance += 0.05) {
        const sample = { ...shore(distance), breakup };
        const start = 0.72;
        let previous = sampleBeachWash(sample, start * BEACH_WASH_PERIOD, ground).foam;
        for (let cycle = start + 0.001; cycle < 0.96; cycle += 0.001) {
          const foam = sampleBeachWash(sample, cycle * BEACH_WASH_PERIOD, ground).foam;
          expect(foam).toBeLessThanOrEqual(previous + 1e-10);
          expect(previous - foam).toBeLessThan(0.04);
          previous = foam;
        }
        for (const [i, cycle] of [0.72, 0.74, 0.76, 0.78, 0.96].entries()) {
          const foam = sampleBeachWash(sample, cycle * BEACH_WASH_PERIOD, ground).foam;
          mass[i] += foam;
        }
      }
    }
    for (let i = 1; i < mass.length; i++) {
      expect(mass[i]).toBeLessThan(mass[i - 1]);
    }
    expect(mass[0]).toBeGreaterThan(0.5);
    expect(mass[3]).toBeGreaterThan(0);
    expect(mass[4]).toBe(0);
  });

  it('slows the approach and retreat without changing the wave at the corresponding phase', () => {
    for (const cycle of [0.05, 0.15, 0.28, 0.4, 0.6, 0.8, 0.95]) {
      const oldSeconds = cycle * 5.12;
      const seconds = cycle * BEACH_WASH_PERIOD;
      expect(seconds / oldSeconds).toBeCloseTo(1.5625, 12);
      for (const distance of [-7, -4, 0, 5, 10, 17]) {
        const current = beachWaveAt(distance, 0, 1, seconds);
        const original = originalWave(distance, cycle, 1);
        for (const key of ['coverage', 'height', 'front'] as const) {
          expect(current[key]).toBeCloseTo(original[key], 10);
        }
      }
    }
    const oldTravel = originalWave(0, 0.25, 1).front - originalWave(0, 0.25 + 0.01 / 5.12, 1).front;
    const travel = beachWaveAt(0, 0, 1, 0.25 * BEACH_WASH_PERIOD).front
      - beachWaveAt(0, 0, 1, 0.25 * BEACH_WASH_PERIOD + 0.01).front;
    expect(travel).toBeLessThan(oldTravel * 0.8);
  });

  it('gates all foam by actual water coverage and fades it completely before the cycle resets', () => {
    for (const breakup of [-0.7, -0.3, 0, 0.4, 0.7]) {
      for (let cycle = 0; cycle <= 1; cycle += 0.02) {
        for (let distance = -7.5; distance < 18; distance += 0.5) {
          const sample = { ...shore(distance), breakup };
          const wash = sampleBeachWash(sample, cycle * BEACH_WASH_PERIOD);
          if (wash.coverage === 0 || cycle >= 0.96) expect(wash.foam).toBe(0);
          expect(wash.foam).toBeGreaterThanOrEqual(0);
          expect(wash.foam).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('feathers displacement, coverage, wetness and foam together into mixed beach contacts', () => {
    const seconds = 0.4 * BEACH_WASH_PERIOD;
    for (const beachWeight of [0.600001, 0.65, 0.75, 0.85, 0.9, 1]) {
      const sample = { ...shore(-4), beachWeight };
      const wash = sampleBeachWash(sample, seconds, -2.5);
      expect(wash.height).toBe(beachWaveAt(-4, 0, beachWeight, seconds).height);
      expect(wash.coverage).toBeLessThanOrEqual(1);
      if (beachWeight < 0.601) {
        expect(wash.height - ISLAND_WATER_HEIGHT).toBeLessThan(1e-8);
        expect(wash.coverage).toBeLessThan(1e-8);
        expect(wash.foam).toBeLessThan(1e-8);
        expect(wash.wetness).toBeLessThan(1e-8);
      }
    }
    expect(sampleBeachWash({ ...shore(-4), beachWeight: 0.75 }, seconds, -2.5).coverage).toBeCloseTo(0.375, 8);
    expect(sampleBeachWash({ ...shore(-4), beachWeight: 0.9 }, seconds, -2.5).coverage).toBeCloseTo(0.9, 8);
  });

  it('has one endpoint support factor for displacement, coverage and foam, leaving its centre unchanged', () => {
    const seconds = 0.4 * BEACH_WASH_PERIOD, ground = ISLAND_WATER_HEIGHT - 0.3;
    const centre = sampleBeachWash(shore(-4), seconds, ground);
    expect(DEFAULT_BEACH_WAVE_END_SOFTNESS).toBe(0.3);
    for (const endSoftness of [0.05, 0.15, 0.3, 0.4]) {
      expect(sampleBeachWash(shore(-4), seconds, ground, endSoftness)).toEqual(centre);
      for (const beachWeight of [0.6, 0.600001, 0.61, 0.65, 0.75, 0.85, 0.9, 1]) {
        const support = beachWeight * smooth(0.6, 0.6 + endSoftness, beachWeight);
        const wash = sampleBeachWash({ ...shore(-4), beachWeight }, seconds, ground, endSoftness);
        expect(wash.height - ISLAND_WATER_HEIGHT).toBeCloseTo((centre.height - ISLAND_WATER_HEIGHT) * support, 12);
        expect(wash.coverage).toBeCloseTo(centre.coverage * support, 12);
        expect(wash.foam).toBeCloseTo(centre.foam * support, 12);
        expect(shoreWaveWeight(0, beachWeight, endSoftness)).toBeCloseTo(support, 12);
      }
    }
    expect(sampleBeachWash({ ...shore(-4), beachWeight: 0.75 }, seconds, ground, 0.05).height)
      .toBeGreaterThan(sampleBeachWash({ ...shore(-4), beachWeight: 0.75 }, seconds, ground, 0.4).height);
  });

  it('differentiates the complete tapered crest and run-up in both world-space directions', () => {
    const distanceGradient = { x: 0.8, y: -0.6 }, beachGradient = { x: 0.025, y: 0.07 }, step = 1e-6;
    for (const endSoftness of [0.05, 0.3, 0.4]) {
      const glsl = evaluateBeachGLSL(endSoftness);
      for (const beach of [0.59, 0.6, 0.60001, 0.62, 0.75, 0.9, 1]) {
        for (const cycle of [0.05, 0.18, 0.3, 0.4, 0.62, 0.85]) {
          for (const distance of [-6, -4, -1, 0, 4, 6, 9, 12, 16]) {
            const seconds = cycle * BEACH_WASH_PERIOD;
            const gradient = beachWaveGradient(distance, 0, beach, seconds, distanceGradient, beachGradient, endSoftness);
            const gpu = glsl.gradient(distance, cycle, beach, distanceGradient, beachGradient);
            for (const axis of ['x', 'y'] as const) {
              const height = (offset: number) => beachWaveAt(distance + offset * distanceGradient[axis], 0,
                beach + offset * beachGradient[axis], seconds, endSoftness).height;
              expect(Number.isFinite(gradient[axis])).toBe(true);
              expect(gradient[axis]).toBeCloseTo((height(step) - height(-step)) / (2 * step), 5);
              expect(gpu[axis]).toBeCloseTo(gradient[axis], 10);
            }
          }
        }
      }
    }
    const along = beachWaveGradient(-4, 0, 0.75, 3.2, { x: 1, y: 0 }, { x: 0, y: 0.1 });
    expect(along.x).toBe(0);
    expect(along.y).toBeGreaterThan(0.5);
  });

  it('returns displacement and its endpoint derivative smoothly to zero at the eligibility boundary', () => {
    for (const endSoftness of [0.05, 0.3, 0.4]) {
      const gradient = (beach: number) => beachWaveGradient(-4, 0, beach, 3.2,
        { x: 1, y: 0 }, { x: 0, y: 0.1 }, endSoftness);
      expect(beachWaveAt(-4, 0, 0.6, 3.2, endSoftness).height).toBe(ISLAND_WATER_HEIGHT);
      expect(gradient(0.6)).toEqual({ x: 0, y: 0 });
      let previous = Infinity;
      for (const epsilon of [1e-3, 1e-4, 1e-5, 1e-6, 1e-7]) {
        const slope = gradient(0.6 + epsilon).y;
        expect(slope).toBeLessThan(previous);
        previous = slope;
      }
      expect(previous).toBeLessThan(0.00003);
    }
  });

  it('validates numeric end softness in every CPU entry point, including ineligible samples and empty support', () => {
    for (const endSoftness of [0.049, 0.401, 0, -1, NaN, Infinity, -Infinity]) {
      expect(() => beachWaveAt(0, 0, 1, 0, endSoftness)).toThrow('end softness');
      expect(() => sampleBeachWash({ ...shore(0), kind: 'cliff' }, 0, 0, endSoftness)).toThrow('end softness');
      expect(() => shoreWaveWeight(Infinity, 0, endSoftness)).toThrow('end softness');
      expect(() => beachWaveGradient(0, 0, 1, 0, { x: 1, y: 0 }, { x: 0, y: 0 }, endSoftness))
        .toThrow('end softness');
    }
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(() => beachWaveAt(value, 0, 1, 0)).toThrow('finite');
      expect(() => beachWaveGradient(0, 0, 1, 0, { x: value, y: 0 }, { x: 0, y: 0 })).toThrow('finite');
      expect(() => beachWaveGradient(0, 0, 1, 0, { x: 1, y: 0 }, { x: 0, y: value })).toThrow('finite');
    }
  });

  it('preserves local phase coherence while honoring separate beach offsets', () => {
    const arrivals = [0, 0.0025, 0.005, 0.0075, 0.01].map(phase => {
      for (let seconds = 0; seconds < BEACH_WASH_PERIOD; seconds += 0.002) {
        if (sampleBeachWash({ ...shore(0), phase }, seconds).coverage > 0.5) return seconds;
      }
      throw new Error('Expected the wave to reach the shoreline.');
    });
    expect(Math.max(...arrivals) - Math.min(...arrivals)).toBeLessThanOrEqual(BEACH_WASH_PERIOD * 0.01 + 0.002);
    for (let seconds = 0; seconds < BEACH_WASH_PERIOD; seconds += 0.02) {
      const fronts = [0, 0.0025, 0.005, 0.0075, 0.01].map(phase => beachWaveAt(0, phase, 1, seconds).front);
      if (Math.min(...fronts) < -2 || Math.max(...fronts) > 2) continue;
      expect(Math.max(...fronts) - Math.min(...fronts)).toBeLessThan(0.8);
      for (const phase of [0, 0.005, 0.01, 0.25, 0.75]) {
        const sample = { ...shore(0), phase };
        expect(sampleBeachWash(sample, seconds).height).toBe(beachWaveAt(0, phase, 1, seconds).height);
      }
    }
    for (const phase of [0.2, 0.4, 0.6, 0.8]) {
      expect(beachWaveAt(0, phase, 1, 0).front)
        .toBeCloseTo(beachWaveAt(0, 0, 1, phase * BEACH_WASH_PERIOD).front, 10);
    }
  });

  it('leaves cliffs, mixed contacts and offshore untouched', () => {
    for (let seconds = 0; seconds < BEACH_WASH_PERIOD; seconds += 0.1) {
      for (const sample of [
        { ...shore(1), kind: 'cliff' as const }, { ...shore(1), beachWeight: 0.6 },
        shore(-BEACH_WASH_REACH), shore(BEACH_WAVE_OFFSHORE), shore(30),
      ]) expect(sampleBeachWash(sample, seconds)).toEqual({ coverage: 0, foam: 0, wetness: 0, height: ISLAND_WATER_HEIGHT });
    }
    expect(() => sampleBeachWash(shore(0), NaN)).toThrow('finite');
    expect(() => sampleBeachWash(shore(0), 0, Infinity)).toThrow('finite');
  });

  it('submerges several low sand treads and risers, never higher ground, and leaves a fading wet trace', () => {
    for (const ground of [-2.5, -2, -1.75, -1.25, -0.75]) {
      const raised = sampleBeachWash(shore(-4), 0.4 * BEACH_WASH_PERIOD, ground);
      expect(raised.coverage).toBeGreaterThan(0.9);
      expect(raised.height).toBeGreaterThan(ground);
      expect(sampleBeachWash(shore(-4), 0, ground).coverage).toBe(0);
    }
    for (const ground of [-0.5, 0]) {
      expect(sampleBeachWash(shore(-4), 0.4 * BEACH_WASH_PERIOD, ground).coverage).toBeLessThan(0.05);
    }
    const retreat = sampleBeachWash(shore(-4), 0.75 * BEACH_WASH_PERIOD, -1.25);
    expect(retreat.coverage).toBe(0);
    expect(retreat.wetness).toBeGreaterThan(0.4);
    expect(sampleBeachWash(shore(-4), 0.96 * BEACH_WASH_PERIOD, -1.25).wetness).toBe(0);
    for (let cycle = 0; cycle <= 1; cycle += 0.01) {
      const wash = sampleBeachWash(shore(-4), cycle * BEACH_WASH_PERIOD, -1.25);
      for (const value of [wash.coverage, wash.foam, wash.wetness]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
      expect(wash.height).toBeGreaterThanOrEqual(ISLAND_WATER_HEIGHT);
      expect(wash.height).toBeLessThanOrEqual(BEACH_WASH_MAX_HEIGHT);
    }
  });

  it('establishes a low, broad crest offshore without growing a tall hump on approach', () => {
    for (const cycle of [0.04, 0.06, 0.08]) {
      const seconds = cycle * BEACH_WASH_PERIOD;
      const { front } = beachWaveAt(0, 0, 1, seconds);
      const peak = beachWaveAt(front + 0.9, 0, 1, seconds).height - ISLAND_WATER_HEIGHT;
      expect(peak).toBeCloseTo(0.78, 8);
      expect(beachWaveAt(front + 2.4, 0, 1, seconds).height - ISLAND_WATER_HEIGHT).toBeGreaterThan(peak * 0.6);
      for (let distance = 9; distance < BEACH_WAVE_OFFSHORE; distance += 0.1) {
        expect(beachWaveAt(distance, 0, 1, seconds).height - ISLAND_WATER_HEIGHT).toBeLessThanOrEqual(0.8);
      }
    }
    expect(sampleBeachWash(shore(-4), 0.4 * BEACH_WASH_PERIOD).height - ISLAND_WATER_HEIGHT).toBeCloseTo(2, 8);
  });

  it('keeps the original centre geometry, coverage and wetness equations throughout the cycle', () => {
    expect([BEACH_WASH_PERIOD, BEACH_WASH_REACH, BEACH_WAVE_OFFSHORE, BEACH_WASH_MAX_HEIGHT])
      .toEqual([8, 8, 18, ISLAND_WATER_HEIGHT + 2]);
    for (const phase of [0, 0.23, 0.61, 0.95]) {
      for (const beachWeight of [1]) {
        for (const seconds of [0, 0.1, 0.83, 1.7, 2.4, 3.2, 4.5, 5.119, 2560.83]) {
          const time = ((seconds % 2560) + 2560) % 2560;
          const cycle = (time / BEACH_WASH_PERIOD + phase) % 1;
          for (const distance of [-7.8, -6.5, -4, -1, 0, 2, 6, 12, 15, 17.9]) {
            const current = originalWave(distance, cycle, beachWeight);
            expect(beachWaveAt(distance, phase, beachWeight, seconds)).toEqual(current);
            for (const ground of [ISLAND_WATER_HEIGHT - 0.3, ISLAND_WATER_HEIGHT, -1.25, 0]) {
              const wash = sampleBeachWash({ ...shore(distance), phase, beachWeight }, seconds, ground);
              if (ground > BEACH_WASH_MAX_HEIGHT) {
                expect(wash).toEqual({ coverage: 0, foam: 0, wetness: 0, height: ISLAND_WATER_HEIGHT });
                continue;
              }
              const edge = smooth(0.6, 0.9, beachWeight);
              const cover = (age: number) => {
                const sample = originalWave(distance, (cycle + age) % 1, beachWeight);
                return sample.coverage * smooth(-0.02, 0.18, sample.height - ground) * edge;
              };
              const coverage = cover(0);
              const wetness = Math.max(coverage, cover(0.92) * 0.9, cover(0.84) * 0.65, cover(0.76) * 0.5)
                * (1 - coverage);
              expect(wash.coverage).toBeCloseTo(coverage, 12);
              expect(wash.wetness).toBeCloseTo(wetness, 12);
              expect(wash.height).toBe(current.height);
            }
          }
        }
      }
    }
  });

  it('uses the same CPU and GLSL mask lifecycle across distances, breakup, beach phases and terrain contacts', () => {
    for (const phase of [0, 0.23, 0.61]) {
      for (const breakup of [-0.8, -0.3, 0, 0.2, 0.4, 0.8]) {
        for (const beachWeight of [0.6, 0.600001, 0.75, 0.9, 1]) {
          for (const seconds of [0, 0.3, 0.83, 1.7, 2.4, 3.2, 3.8, 4.5, 4.92, 5.119]) {
            for (const distance of [-8, -7, -4, -1, 0, 2, 5, 8, 15, 18]) {
              for (const ground of [ISLAND_WATER_HEIGHT - 0.3, ISLAND_WATER_HEIGHT, -1.25, 0]) {
                const cpu = sampleBeachWash({ ...shore(distance), phase, breakup, beachWeight }, seconds, ground);
                const glsl = glslWash(distance, beachWeight, phase, breakup, seconds, ground);
                for (const [i, key] of (['coverage', 'foam', 'wetness', 'height'] as const).entries()) {
                  expect(glsl[i]).toBeCloseTo(cpu[key], 10);
                }
              }
            }
          }
        }
      }
    }
  });

  it('is deterministic and continuous across the shared long-running water clock wrap', () => {
    for (const distance of [-3, -1, 0, 3]) {
      const sample = { ...shore(distance), phase: 0.37 };
      expect(sampleBeachWash(sample, 2.125 + 2560).coverage)
        .toBeCloseTo(sampleBeachWash(sample, 2.125).coverage, 10);
      for (const key of ['coverage', 'foam', 'wetness', 'height'] as const) {
        expect(sampleBeachWash(sample, -0.0000001)[key])
          .toBeCloseTo(sampleBeachWash(sample, 0.0000001)[key], 4);
      }
    }
  });

  it('preserves the 8-second cycle, group phase and 2560-second wrap at every softness setting', () => {
    for (const endSoftness of [0.05, 0.3, 0.4]) {
      const glsl = evaluateBeachGLSL(endSoftness);
      for (const phase of [0, 0.23, 0.61]) {
        for (const beachWeight of [0.6, 0.65, 0.75, 0.9, 1]) {
          for (const seconds of [-2560.7, -0.7, 0, 1.7, 3.2, 2560.7]) {
            const sample = { ...shore(-4), beachWeight, phase };
            const current = sampleBeachWash(sample, seconds, ISLAND_WATER_HEIGHT - 0.3, endSoftness);
            const gpu = glsl.wash(sample.distance, beachWeight, phase, sample.breakup, seconds, ISLAND_WATER_HEIGHT - 0.3);
            for (const [i, key] of (['coverage', 'foam', 'wetness', 'height'] as const).entries()) {
              expect(gpu[i]).toBeCloseTo(current[key], 10);
              expect(sampleBeachWash(sample, seconds + BEACH_WASH_PERIOD, ISLAND_WATER_HEIGHT - 0.3, endSoftness)[key])
                .toBeCloseTo(current[key], 10);
              expect(sampleBeachWash(sample, seconds + 2560, ISLAND_WATER_HEIGHT - 0.3, endSoftness)[key])
                .toBeCloseTo(current[key], 10);
            }
          }
        }
      }
    }
  });
});
