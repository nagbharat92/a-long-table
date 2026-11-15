import { describe, expect, it } from 'vitest';
import type { World } from './core/contracts';
import { BEACH_WASH_PERIOD, beachWaveAt } from './render/island-beach-wash';
import { createCoastField, createIslandShoreField } from './render/island-shore-field';

function fixture(width = 12, height = 12, tileSize = 8): World {
  const cells = new Uint8Array(width * height);
  const heights = new Float32Array(cells.length).fill(-0.7);
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const i = y * width + x;
      cells[i] = 1;
      heights[i] = 0.35;
    }
  }
  return {
    seed: 71, generatorVersion: 'shore-fixture', provenance: 'test-fixture',
    width, height, tileSize, seaLevel: 0, cells, heights,
    elevations: new Uint8Array(cells.length), rampIds: new Int32Array(cells.length).fill(-1), ramps: [],
  };
}

function mixedCoast(): World {
  const world = fixture();
  for (let y = 2; y < 10; y++) world.heights[y * world.width + 2] = 0.06;
  return world;
}

describe('shared world-space island shoreline field', () => {
  it('preserves signed coast-field half-pixel and outside-map compatibility', () => {
    const world = fixture(3, 3);
    world.cells[4] = 1;
    const coast = createCoastField(world);
    expect(coast.sample(8, 12)).toBeCloseTo(0);
    expect(coast.sample(7.5, 12)).toBeCloseTo(0.5);
    expect(coast.sample(8.5, 12)).toBeCloseTo(-0.5);
    expect(coast.sample(12, 12)).toBeLessThan(-3);
    expect(coast.sample(-20, 12)).toBeCloseTo(28);
    expect(coast.sample(44, 12)).toBeCloseTo(28);
    const shore = createIslandShoreField(world);
    for (const [x, y] of [[8, 12], [7.5, 12], [8.5, 12], [-20, 12], [150, -100]]) {
      expect(shore.sample(x, y).distance).toBe(coast.sample(x, y));
    }
  });

  it('classifies only exposed sand edges as beach and remaining edges as cliff', () => {
    const shore = createIslandShoreField(mixedCoast());
    const beach = shore.sample(15, 44), cliff = shore.sample(81, 44);
    expect(beach.distance).toBeCloseTo(1);
    expect(beach.beachDistance).toBe(1);
    expect(beach.cliffDistance).toBeGreaterThan(20);
    expect(beach.kind).toBe('beach');
    expect(beach.beachWeight).toBe(1);
    expect(shore.sample(17, 44).kind).toBe('beach');
    expect(shore.sample(16, 44).beachDistance).toBe(0);
    expect(cliff.cliffDistance).toBe(1);
    expect(cliff.beachDistance).toBeCloseTo(Math.hypot(57, 28));
    expect(cliff.kind).toBe('cliff');
    expect(cliff.beachWeight).toBe(0);
    expect(shore.sample(48, 48).kind).toBe('inland');
    expect(shore.sample(-20, 44).kind).toBe('open-water');
  });

  it('uses continuous exact edge distances and blends beach/cliff junctions', () => {
    const shore = createIslandShoreField(mixedCoast());
    const junction = shore.sample(24, 15);
    expect(junction.beachDistance).toBe(1);
    expect(junction.cliffDistance).toBe(1);
    expect(junction.beachWeight).toBe(0.5);
    expect(shore.sample(23, 15).beachWeight).toBeGreaterThan(0.5);
    expect(shore.sample(25, 15).beachWeight).toBeLessThan(0.5);
    expect(Math.abs(shore.sample(23.999, 15).beachWeight
      - shore.sample(24.001, 15).beachWeight)).toBeLessThan(0.001);
    expect(shore.sample(12, 12).beachDistance).toBeCloseTo(Math.hypot(4, 4));
  });

  it('staggers separate beaches while each whole beach retains a coherent incoming front', () => {
    const world = mixedCoast();
    for (let y = 2; y < 10; y++) world.heights[y * world.width + 9] = 0.06;
    const before = structuredClone(world), shore = createIslandShoreField(world);
    const phases = [16, 80].map(x => Array.from({ length: 49 }, (_, i) => shore.sample(x, 24 + i).phase));
    for (const beach of phases) {
      expect(new Set(beach).size).toBe(1);
    }
    const separation = Math.abs(phases[0][24] - phases[1][24]);
    expect(Math.min(separation, 1 - separation) * BEACH_WASH_PERIOD).toBeGreaterThan(1.5);
    for (const [x, direction] of [[16, -1], [80, 1]]) {
      for (const distance of [-6, -2, 0, 4, 8, 16]) {
        expect(shore.sample(x + direction * distance, 48).phase).toBeCloseTo(shore.sample(x, 48).phase, 7);
      }
    }
    expect(beachWaveAt(0, phases[0][24], 1, 0).front)
      .not.toBeCloseTo(beachWaveAt(0, phases[1][24], 1, 0).front, 1);
    expect(createIslandShoreField(world).sample(16, 48)).toEqual(shore.sample(16, 48));
    expect(createIslandShoreField({ ...world, seed: world.seed + 1 }).sample(16, 48).phase)
      .not.toBe(shore.sample(16, 48).phase);
    expect(world).toEqual(before);
  });

  it('excludes inland sand, elevated coastal sand and coastal sand ramps', () => {
    const world = fixture();
    world.heights[5 * world.width + 5] = 0.06;
    world.heights[4 * world.width + 2] = 0.06;
    world.elevations![4 * world.width + 2] = 1;
    world.rampIds![6 * world.width + 2] = 0;
    world.ramps!.push({
      surface: 'sand', rect: { x: 16, y: 48, width: 8, height: 8 },
      upperLevel: 1, lowerLevel: 0, direction: { x: 1, y: 0 },
      highCell: { x: 3, y: 6 }, lowCell: { x: 2, y: 6 },
    });
    const shore = createIslandShoreField(world);
    for (const y of [36, 52]) {
      const sample = shore.sample(15, y);
      expect(sample.beachDistance).toBe(Infinity);
      expect(sample.cliffDistance).toBe(1);
      expect(sample.beachWeight).toBe(0);
      expect(sample.kind).toBe('cliff');
    }
    expect(shore.sample(44, 44).beachDistance).toBe(Infinity);
  });

  it('handles absent beach, absent cliff and empty coast without invalid parameters', () => {
    const cliffOnly = fixture(), beachOnly = fixture(), empty = fixture();
    for (let i = 0; i < beachOnly.cells.length; i++) {
      if (beachOnly.cells[i]) beachOnly.heights[i] = 0.06;
    }
    empty.cells.fill(0);
    for (const [world, weight, absent] of [
      [cliffOnly, 0, 'beachDistance'], [beachOnly, 1, 'cliffDistance'], [empty, 0, 'beachDistance'],
    ] as const) {
      const field = createIslandShoreField(world);
      const sample = field.sample(15, 44);
      expect(sample[absent]).toBe(Infinity);
      expect(sample.beachWeight).toBe(weight);
      for (const key of ['variation', 'breakup', 'phase', 'wetWidth', 'shallowWidth'] as const) {
        expect(Number.isFinite(sample[key])).toBe(true);
      }
    }
    expect(createIslandShoreField(empty).sample(40, 40).kind).toBe('open-water');
    expect(createIslandShoreField(beachOnly).sample(15, 44).kind).toBe('beach');
    expect(createIslandShoreField(cliffOnly).sample(15, 44).kind).toBe('cliff');
  });

  it('is seeded, coherent across tiles, deterministic and within the directed band widths', () => {
    const world = mixedCoast(), first = createIslandShoreField(world), second = createIslandShoreField(world);
    const otherSeed = createIslandShoreField({ ...world, seed: world.seed + 1 });
    expect(first.sample(15, 44).variation).not.toBe(otherSeed.sample(15, 44).variation);
    for (const [x, y] of [[15, 44], [81, 44], [-100, 25], [500, -250], [1e100, -1e100],
      [Number.MAX_VALUE, Number.MAX_VALUE]]) {
      const sample = first.sample(x, y);
      expect(sample).toEqual(second.sample(x, y));
      expect(sample.variation).toBeGreaterThanOrEqual(-1);
      expect(sample.variation).toBeLessThanOrEqual(1);
      expect(sample.breakup).toBeGreaterThanOrEqual(-1);
      expect(sample.breakup).toBeLessThanOrEqual(1);
      expect(sample.phase).toBeGreaterThanOrEqual(0);
      expect(sample.phase).toBeLessThanOrEqual(1);
      expect(sample.beachWeight).toBeGreaterThanOrEqual(0);
      expect(sample.beachWeight).toBeLessThanOrEqual(1);
      expect(sample.wetWidth).toBeGreaterThanOrEqual(1.5);
      expect(sample.wetWidth).toBeLessThanOrEqual(2.9 + 1e-12);
      expect(sample.shallowWidth).toBeGreaterThanOrEqual(3);
      expect(sample.shallowWidth).toBeLessThanOrEqual(15);
    }
    const beach = first.sample(15, 44), cliff = first.sample(81, 44);
    expect(beach.shallowWidth).toBeGreaterThanOrEqual(9);
    expect(cliff.shallowWidth).toBeLessThanOrEqual(5);
    // At least five units of this eight-unit sand tile remain above the wet band.
    expect(8 - beach.wetWidth).toBeGreaterThan(5);
    for (const x of [8, 16, 24, 32, 48]) {
      const a = first.sample(x - 0.001, 44), b = first.sample(x + 0.001, 44);
      for (const key of ['variation', 'breakup', 'phase', 'wetWidth', 'shallowWidth'] as const) {
        expect(Math.abs(a[key] - b[key])).toBeLessThan(0.005);
      }
    }
  });

  it('snapshots without mutating world data and rejects nonfinite queries', () => {
    const world = mixedCoast(), before = structuredClone(world);
    const shore = createIslandShoreField(world), coast = createCoastField(world);
    const sample = shore.sample(15, 44);
    shore.sample(-200, 300);
    expect(world).toEqual(before);
    world.cells.fill(0);
    world.heights.fill(-1);
    expect(shore.sample(15, 44)).toEqual(sample);
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(() => shore.sample(bad, 0)).toThrow('finite');
      expect(() => shore.sample(0, bad)).toThrow('finite');
      expect(() => coast.sample(bad, 0)).toThrow('finite');
    }
  });
});
