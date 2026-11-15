import FastNoiseLite from 'fastnoise-lite';
import type { World } from '../core/contracts';
import { islandCoastInfluence, type IslandCoastProfile } from '../core/island-coast-profile';
import type { IslandShoreField } from './island-shore-field';
import { WATER_MAX_DEPTH } from './island-water-settings';

export interface IslandCoastalSlope {
  sample(x: number, y: number): number;
}

/** Continuous submerged foundation; finite beach shelves remain separate optical geometry. */
export function createIslandCoastalSlope(
  world: World, shore: IslandShoreField, coast?: IslandCoastProfile,
): IslandCoastalSlope {
  if (!Number.isFinite(world.seed)) throw new RangeError('Coastal slopes require a finite seed.');
  if (![world.width, world.height, world.tileSize].every(value => Number.isInteger(value) && value > 0)) {
    throw new RangeError('Coastal slopes require positive integer world dimensions.');
  }
  const broad = new FastNoiseLite(world.seed ^ 0x29c7a1);
  broad.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2S);
  broad.SetFractalType(FastNoiseLite.FractalType.None);
  broad.SetFrequency(1 / 96);
  const padding = 128, spacing = 8;
  const width = Math.ceil((world.width * world.tileSize + padding * 2) / spacing) + 1;
  const height = Math.ceil((world.height * world.tileSize + padding * 2) / spacing) + 1;
  if (width * height > 2048 * 2048) throw new RangeError('Coastal slopes exceed the bounded field budget.');
  let reaches: Float32Array | undefined;
  function reachAt(x: number, y: number): number {
    if (!reaches) {
      reaches = new Float32Array(width * height);
      for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
        const px = column * spacing - padding, py = row * spacing - padding;
        const sample = shore.sample(px, py);
        const influence = coast ? islandCoastInfluence(coast, px, py) : 0;
        const variation = broad.GetNoise(px % 1048576, py % 1048576);
        reaches[row * width + column] = 100 + sample.beachWeight * 8 + influence * 4 + variation * 8;
      }
    }
    const gx = (x + padding) / spacing, gy = (y + padding) / spacing;
    const column = Math.floor(gx), row = Math.floor(gy), tx = gx - column, ty = gy - row;
    const i = row * width + column;
    return (reaches[i] * (1 - tx) + reaches[i + 1] * tx) * (1 - ty)
      + (reaches[i + width] * (1 - tx) + reaches[i + width + 1] * tx) * ty;
  }
  return {
    sample(x, y) {
      if (![x, y].every(Number.isFinite)) throw new RangeError('Coastal slope coordinates must be finite.');
      const distance = shore.distance(x, y);
      if (distance === Infinity) return WATER_MAX_DEPTH;
      if (!Number.isFinite(distance)) throw new RangeError('Coastal slopes require a finite coast distance or open water.');
      if (distance <= 0) return 0;
      if (distance >= 120) return WATER_MAX_DEPTH;
      const t = Math.max(0, Math.min(1, distance / reachAt(x, y)));
      // A shallow inner grade and long outer descent avoid stacking two steep eased colour ramps.
      return WATER_MAX_DEPTH * t * t;
    },
  };
}
