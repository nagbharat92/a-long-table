import FastNoiseLite from 'fastnoise-lite';
import type { Point, World } from './contracts';
import type { IslandAscent } from './island-ascents';
import type { IslandSurfacePolygon } from './island-columns';
import type { LandTriangle } from './landform-study';
import { ISLAND_WATER_HEIGHT } from './island-water-level';
import { terrainAt } from './world';
import { createIslandShoreField } from '../render/island-shore-field';
import { islandCoastInfluence, type IslandCoastProfile } from './island-coast-profile';
import type { IslandCoastBudget } from './island-coast-budget';
import { createIslandSeabed } from './island-seabed';
import { resolveSteppedLandformContacts, steppedLandformSurfaces, type SteppedLandform, type SteppedLandformSample } from './stepped-landform';

export interface IslandBeachShelf {
  /** Complete replacement cell tops; tread boundaries have explicit vertical risers. */
  landSurfaces: ReadonlyMap<number, readonly IslandSurfacePolygon[]>;
  underwaterTriangles: LandTriangle[];
  seabed: SteppedLandform;
}

const SPACING = 2;
const INNER_WIDTH = 12;
const SUPPORT_BUFFER = 2;
const EPSILON = 1e-7;
export const ISLAND_BEACH_HEIGHTS: readonly number[] = Object.freeze([0, -0.5, -1.25, -2, ISLAND_WATER_HEIGHT]);
const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

function validateWorld(world: World): void {
  if (!Number.isInteger(world.width) || world.width <= 0
    || !Number.isInteger(world.height) || world.height <= 0
    || !Number.isInteger(world.tileSize) || world.tileSize <= 0 || world.tileSize % SPACING
    || !Number.isFinite(world.seaLevel)
    || world.cells.length !== world.width * world.height
    || world.heights.length !== world.cells.length
    || (world.elevations && world.elevations.length !== world.cells.length)
    || (world.rampIds && world.rampIds.length !== world.cells.length)
    || world.heights.some(height => !Number.isFinite(height))) {
    throw new RangeError('Beach geometry requires a valid world and tiles divisible by two world units.');
  }
}

/** Pure snapshot: no source terrain, cell outline, levels or ascent geometry is changed. */
export function createIslandBeachShelf(
  world: World, ascents: readonly IslandAscent[], cove?: IslandCoastProfile, budget?: IslandCoastBudget,
): IslandBeachShelf {
  validateWorld(world);
  if (cove && (!Number.isFinite(cove.gradeWidth) || cove.gradeWidth <= 0)) {
    throw new RangeError('Beach terraces require a positive, finite coastal width.');
  }
  if (budget && (budget.dryCells.length !== world.cells.length || budget.dryCells.some(value => value > 1))) {
    throw new RangeError('Coastal dry reservations must match the world and contain only zero/one flags.');
  }
  const beachCells = cove && 'kind' in cove ? cove.beachCells : undefined;
  if (beachCells && (beachCells.length !== world.cells.length || beachCells.some(value => value > 1))) {
    throw new RangeError('Coastal beach ownership must match the world and contain only zero/one flags.');
  }
  for (const { bounds } of ascents) {
    if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
      || bounds.width <= 0 || bounds.height <= 0) {
      throw new RangeError('Beach geometry requires finite, positive ascent bounds.');
    }
  }
  const size = world.tileSize;
  const eligible = new Uint8Array(world.cells.length);
  const land = (x: number, y: number) => x >= 0 && y >= 0 && x < world.width && y < world.height
    && !!world.cells[y * world.width + x];
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const index = y * world.width + x;
      if (budget?.dryCells[index] || !land(x, y) || (world.elevations?.[index] ?? 0) !== 0
        || (world.rampIds?.[index] ?? -1) >= 0 || terrainAt(world, { x, y }) !== 'sand') continue;
      const reserved = ascents.some(({ bounds }) =>
        (x + 1) * size > bounds.x - SUPPORT_BUFFER
        && x * size < bounds.x + bounds.width + SUPPORT_BUFFER
        && (y + 1) * size > bounds.y - SUPPORT_BUFFER
        && y * size < bounds.y + bounds.height + SUPPORT_BUFFER);
      if (!reserved) eligible[index] = 1;
    }
  }
  const shore = createIslandShoreField(world);
  const influence = (x: number, y: number) => cove ? islandCoastInfluence(cove, x, y) : 0;
  const gradeWidth = (x: number, y: number) => INNER_WIDTH + ((cove?.gradeWidth ?? INNER_WIDTH) - INNER_WIDTH) * influence(x, y);
  const noise = new FastNoiseLite(world.seed ^ 0x52ba71);
  noise.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2S);
  noise.SetFrequency(1);
  function groundClearance(x: number, y: number): number {
    const width = size * 2;
    let distance = width;
    for (let cy = Math.floor((y - width) / size); cy <= Math.floor((y + width) / size); cy++) {
      for (let cx = Math.floor((x - width) / size); cx <= Math.floor((x + width) / size); cx++) {
        if (!land(cx, cy) || eligible[cy * world.width + cx]) continue;
        distance = Math.min(distance, Math.hypot(
          Math.max(cx * size - x, 0, x - (cx + 1) * size),
          Math.max(cy * size - y, 0, y - (cy + 1) * size),
        ));
      }
    }
    return smooth((distance - SPACING / 2) / (width - SPACING / 2));
  }
  function beachLevel(x: number, y: number): number {
    const sample = shore.sample(x, y);
    const clearance = groundClearance(x, y);
    const width = Math.max(INNER_WIDTH, gradeWidth(x, y)) * (1 + noise.GetNoise(x / 36, y / 36) * 0.24);
    const progress = sample.beachDistance / width;
    const broken = progress + noise.GetNoise(x / 14 + 91, y / 14 - 73) * 0.09
      * Math.sin(Math.PI * Math.min(1, progress));
    const z = ISLAND_WATER_HEIGHT * (1 - smooth(broken)) * sample.beachWeight * clearance;
    if (sample.beachDistance <= SPACING * Math.SQRT1_2 + EPSILON && clearance === 1
      && sample.beachDistance < sample.cliffDistance) return ISLAND_BEACH_HEIGHTS.length - 1;
    return ISLAND_BEACH_HEIGHTS.reduce((best, height, level) =>
      Math.abs(height - z) < Math.abs(ISLAND_BEACH_HEIGHTS[best] - z) ? level : best, 0);
  }
  const gridWidth = world.width * size / SPACING, gridHeight = world.height * size / SPACING;
  const levels: (SteppedLandformSample | undefined)[] = new Array(gridWidth * gridHeight);
  for (let y = 0; y < gridHeight; y++) for (let x = 0; x < gridWidth; x++) {
    const cx = Math.floor(x * SPACING / size), cy = Math.floor(y * SPACING / size);
    if (!land(cx, cy)) continue;
    const px = (x + 0.5) * SPACING, py = (y + 0.5) * SPACING;
    const protectedGround = !eligible[cy * world.width + cx] || groundClearance(px, py) === 0;
    levels[y * gridWidth + x] = {
      level: protectedGround ? 0 : beachLevel(px, py), anchored: protectedGround,
    };
  }
  resolveSteppedLandformContacts(levels, gridWidth, gridHeight, ISLAND_BEACH_HEIGHTS.length, true);
  const landSurfaces = new Map<number, IslandSurfacePolygon[]>();
  for (let cy = 0; cy < world.height; cy++) {
    for (let cx = 0; cx < world.width; cx++) {
      const index = cy * world.width + cx;
      if (!eligible[index]) continue;
      const cells: { x: number; y: number; level: number }[] = [];
      for (let y = cy * size; y < (cy + 1) * size; y += SPACING) {
        for (let x = cx * size; x < (cx + 1) * size; x += SPACING) {
          cells.push({ x: x / SPACING, y: y / SPACING, level: levels[y / SPACING * gridWidth + x / SPACING]!.level });
        }
      }
      if (cells.some(cell => cell.level > 0) || beachCells?.[index]) {
        landSurfaces.set(index, steppedLandformSurfaces(cells, SPACING, ISLAND_BEACH_HEIGHTS)
          .map(surface => ({ ...surface, level: 0, layer: 'beaches' })));
      }
    }
  }
  const seabed = createIslandSeabed(world, shore, cove);
  return { landSurfaces, underwaterTriangles: seabed.triangles, seabed };
}

/** Exact flat treads, choosing the upper incident tread on a vertical-riser boundary. */
export function islandBeachHeightAt(
  world: World, shelf: IslandBeachShelf, cell: Point, point: Point,
): number | undefined {
  if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y)
    || cell.x < 0 || cell.y < 0 || cell.x >= world.width || cell.y >= world.height
    || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RangeError('Beach queries require a valid cell and finite world coordinates.');
  }
  const surfaces = shelf.landSurfaces.get(cell.y * world.width + cell.x);
  if (!surfaces) return undefined;
  const left = cell.x * world.tileSize, top = cell.y * world.tileSize;
  if (point.x < left - EPSILON || point.y < top - EPSILON
    || point.x > left + world.tileSize + EPSILON || point.y > top + world.tileSize + EPSILON) {
    throw new RangeError('Beach query point must lie in its cell.');
  }
  const x = Math.max(left, Math.min(left + world.tileSize, point.x));
  const y = Math.max(top, Math.min(top + world.tileSize, point.y));
  const xs = [cell.x], ys = [cell.y];
  if (Math.abs(x - left) <= EPSILON && cell.x > 0) xs.push(cell.x - 1);
  if (Math.abs(x - left - world.tileSize) <= EPSILON && cell.x + 1 < world.width) xs.push(cell.x + 1);
  if (Math.abs(y - top) <= EPSILON && cell.y > 0) ys.push(cell.y - 1);
  if (Math.abs(y - top - world.tileSize) <= EPSILON && cell.y + 1 < world.height) ys.push(cell.y + 1);
  let height = -Infinity;
  for (const cy of ys) for (const cx of xs) {
    for (const { vertices } of shelf.landSurfaces.get(cy * world.width + cx) ?? []) {
      const [a, b, , d] = vertices;
      if (x >= a.x - EPSILON && x <= b.x + EPSILON && y >= a.y - EPSILON && y <= d.y + EPSILON) {
        height = Math.max(height, a.z);
      }
    }
  }
  if (!Number.isFinite(height)) throw new Error('Beach cell treads do not cover their query point.');
  return height;
}
