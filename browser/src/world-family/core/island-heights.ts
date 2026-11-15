import type { World } from './contracts';

export const ISLAND_HEIGHT_PALETTE = [0, 8, 16, 24, 32] as const;
export const ISLAND_MAX_CLIFF_RISE = 16;
export const ISLAND_LEVEL_HEIGHTS = [0, 20, 48] as const;

export function islandLevelHeights(world: World): readonly number[] {
  return world.elevationHeights ?? ISLAND_LEVEL_HEIGHTS;
}

export function islandHeightAtLevel(world: World, level: number): number {
  const heights = islandLevelHeights(world);
  if (!Number.isInteger(level) || level < 0 || level >= heights.length || !Number.isFinite(heights[level])) {
    throw new Error(`Island elevation ${level} has no valid surface height.`);
  }
  return heights[level];
}

export function validateIslandHeights(world: World): void {
  if (!world.elevationHeights) return;
  const heights = world.elevationHeights;
  if (!heights.length || heights[0] !== 0 || heights.length > ISLAND_HEIGHT_PALETTE.length
    || heights.some((height, i) => !ISLAND_HEIGHT_PALETTE.some(value => value === height)
      || (i > 0 && height <= heights[i - 1]))) {
    throw new Error('V2 terrace heights must start at zero and increase in multiples of eight through 32.');
  }
}
