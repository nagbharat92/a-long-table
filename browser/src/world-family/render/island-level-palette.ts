import type { World } from '../core/contracts';
import { islandLevelHeights } from '../core/island-heights';

export function islandLevelPalette(world: World, base: readonly number[], summit: readonly number[]): number[][] {
  return islandLevelHeights(world).map(height => {
    const t = height / 48;
    return [0, 1, 2].map(channel => Math.round(base[channel] * (1 - t) + summit[channel] * t));
  });
}
