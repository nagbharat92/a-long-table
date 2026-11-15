import type { SurfaceColor } from './island-surface';

export const WATER_FOAM_COLOR: SurfaceColor = [248, 249, 245];

/** Foam covers the finished water, not the bottom before transmission. */
export function compositeWaterFoam(water: SurfaceColor, foam: number, litFoam: SurfaceColor = WATER_FOAM_COLOR): SurfaceColor {
  if (!Number.isFinite(foam)) throw new RangeError('Water foam coverage must be finite.');
  const coverage = Math.max(0, Math.min(1, foam));
  return [
    water[0] + (litFoam[0] - water[0]) * coverage,
    water[1] + (litFoam[1] - water[1]) * coverage,
    water[2] + (litFoam[2] - water[2]) * coverage,
  ];
}
