import { describe, expect, it } from 'vitest';
import { compositeWaterFoam, WATER_FOAM_COLOR } from './render/island-water-foam';
import type { SurfaceColor } from './render/island-surface';

describe('diffuse white foam composition', () => {
  it('covers finished water and seabed colors with a dense neutral-white interior', () => {
    const bottoms: SurfaceColor[] = [[45, 100, 113], [20, 80, 180], [180, 155, 90]];
    for (const bottom of bottoms) {
      expect(compositeWaterFoam(bottom, 1)).toEqual(WATER_FOAM_COLOR);
      const core = compositeWaterFoam(bottom, 0.98);
      expect(Math.min(...core)).toBeGreaterThan(240);
      expect(Math.max(...core) - Math.min(...core)).toBeLessThan(8);
      expect(compositeWaterFoam(bottom, 0)).toEqual(bottom);
    }
  });

  it('keeps dissolved edges translucent, and follows supplied lighting without emission', () => {
    const water: SurfaceColor = [45, 100, 113];
    const edge = compositeWaterFoam(water, 0.2);
    expect(edge[0]).toBeGreaterThan(water[0]);
    expect(edge[0]).toBeLessThan(100);
    expect(compositeWaterFoam([0, 0, 0], 1, [0, 0, 0])).toEqual([0, 0, 0]);
    expect(compositeWaterFoam(water, 1, [96, 100, 98])).toEqual([96, 100, 98]);
  });

  it('bounds coverage and rejects nonfinite masks', () => {
    expect(compositeWaterFoam([0, 0, 0], 2)).toEqual(WATER_FOAM_COLOR);
    expect(compositeWaterFoam([0, 0, 0], -1)).toEqual([0, 0, 0]);
    for (const value of [NaN, Infinity, -Infinity])
      expect(() => compositeWaterFoam([0, 0, 0], value)).toThrow('finite');
  });
});
