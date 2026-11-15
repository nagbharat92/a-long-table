import FastNoiseLite from 'fastnoise-lite';
import type { World } from './contracts';
import { islandCoastInfluence, type IslandCoastProfile } from './island-coast-profile';
import { ISLAND_WATER_HEIGHT } from './island-water-level';
import { createSteppedLandform, type SteppedLandform } from './stepped-landform';
import type { IslandShoreField } from '../render/island-shore-field';

export const ISLAND_SEABED_CELL_SIZE = 2;
export const ISLAND_SEABED_HEIGHTS: readonly number[] = Object.freeze(
  [0, 0.75, 2, 3.5, 4.75].map(depth => ISLAND_WATER_HEIGHT - depth),
);
const SHELF_WIDTH = 16;
const FRAGMENT_REACH = 18;
const FLOOR = ISLAND_WATER_HEIGHT - 7;

function noise(seed: number, scale: number): FastNoiseLite {
  const field = new FastNoiseLite(seed & 0x7fffffff);
  field.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2S);
  field.SetFractalType(FastNoiseLite.FractalType.None);
  field.SetFrequency(1 / scale);
  return field;
}

export function createIslandSeabed(world: World, shore: IslandShoreField, coast?: IslandCoastProfile): SteppedLandform {
  if (!Number.isFinite(world.seed) || world.tileSize % ISLAND_SEABED_CELL_SIZE
    || (coast && (!Number.isFinite(coast.shelfWidth) || coast.shelfWidth <= 0))) {
    throw new RangeError('Seabeds require a finite seed, aligned terrain cells and a positive coastal shelf width.');
  }
  const size = ISLAND_SEABED_CELL_SIZE;
  const extent = Math.ceil((Math.max(SHELF_WIDTH, coast?.shelfWidth ?? SHELF_WIDTH) * 1.2 + FRAGMENT_REACH + size) / size);
  const broad = noise(world.seed ^ 0x6a2b91, 44);
  const edge = noise(world.seed ^ 0x37c8ab, 14);
  const fragments = noise(world.seed ^ 0x73bc19, 9);
  const land = (x: number, y: number) => {
    const cx = Math.floor(x / world.tileSize), cy = Math.floor(y / world.tileSize);
    return cx >= 0 && cy >= 0 && cx < world.width && cy < world.height && !!world.cells[cy * world.width + cx];
  };
  const formation = createSteppedLandform({
    bounds: {
      x: -extent, y: -extent,
      width: world.width * world.tileSize / size + extent * 2,
      height: world.height * world.tileSize / size + extent * 2,
    },
    cellSize: size, heights: ISLAND_SEABED_HEIGHTS, floor: FLOOR,
    minFragmentCells: 4, maxFragmentCells: 48,
    sample(x, y) {
      if (land(x, y)) return undefined;
      const sample = shore.sample(x, y);
      const distance = sample.beachDistance;
      if (!Number.isFinite(distance) || distance >= sample.cliffDistance) return undefined;
      const influence = coast ? islandCoastInfluence(coast, x, y) : 0;
      const baseWidth = SHELF_WIDTH + ((coast?.shelfWidth ?? SHELF_WIDTH) - SHELF_WIDTH) * influence;
      const shape = broad.GetNoise(x, y), detail = edge.GetNoise(x, y);
      const endTaper = Math.min(1, 0.4 + (sample.cliffDistance - distance) / 16);
      const reach = Math.max(size, baseWidth * (0.82 + shape * 0.3) * endTaper + detail * 3);
      const anchored = [[-size, 0], [size, 0], [0, -size], [0, size]].some(([dx, dy]) => land(x + dx, y + dy));
      if (anchored || distance <= size * Math.SQRT1_2 + 1e-7) return { level: 0, anchored };
      if (distance <= reach) {
        const progress = distance / reach + detail * 0.06;
        return { level: progress < 0.24 ? 1 : progress < 0.58 ? 2 : 3, anchored: false };
      }
      if (distance <= reach + 6 && detail > 0.18) return { level: 4, anchored: false };
      // Separate coherent clusters, with a quiet gap and increasing rejection offshore.
      const offshore = distance - reach;
      if (offshore > 5 && offshore < FRAGMENT_REACH
        && fragments.GetNoise(x, y) > 0.38 + offshore / FRAGMENT_REACH * 0.2
        && shape > -0.25) return { level: 4, anchored: false };
      return undefined;
    },
  });
  formation.triangles = formation.triangles.map(triangle => ({ ...triangle, level: 0, submerged: true }));
  return formation;
}
