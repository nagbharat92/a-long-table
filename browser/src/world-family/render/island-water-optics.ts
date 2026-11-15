import { ISLAND_WATER_HEIGHT } from '../core/island-water-level';

// Breaking coastal water is denser optically than the undisturbed shallows.
export const WAVE_COLUMN_EXTINCTION = 8;

/** Preserve flat-water clarity; include viewing distance and turbulent wave-column extinction. */
export function waterBedOpticalDepth(surfaceHeight: number, groundHeight: number, viewZ: number): number {
  if (![surfaceHeight, groundHeight, viewZ].every(Number.isFinite) || viewZ <= 0 || viewZ > 1) {
    throw new RangeError('Water optics require finite heights and a view Z between zero and one.');
  }
  const depth = Math.max(0, surfaceHeight - groundHeight);
  const added = Math.min(depth, Math.max(0, surfaceHeight - ISLAND_WATER_HEIGHT));
  return depth + added * (1 / viewZ - 1 + WAVE_COLUMN_EXTINCTION);
}

export const WATER_OPTICS_GLSL = `
float waterBedOpticalDepth(float surfaceHeight, float groundHeight, float viewZ) {
  float depth=max(0.0,surfaceHeight-groundHeight);
  float added=min(depth,max(0.0,surfaceHeight-(${ISLAND_WATER_HEIGHT.toFixed(2)})));
  return depth+added*(1.0/viewZ-1.0+${WAVE_COLUMN_EXTINCTION.toFixed(1)});
}
`;
