import FastNoiseLite from 'fastnoise-lite';
import type { Point, World } from './contracts';
import type { IslandAscent } from './island-ascents';
import type { IslandBeachShelf } from './island-beach-shelf';
import type { IslandSurfacePolygon } from './island-columns';
import { islandHeightAtLevel } from './island-heights';
import type { IslandTerraceEdges } from './island-terrace-edges';
import { seededRandom } from './random';
import { steppedLandformSurfaces } from './stepped-landform';
import { terrainAt } from './world';

export interface IslandUplandShoulder {
  mass: number;
  parentLevel: number;
  height: number;
  cells: number[];
  parentCells: number[];
}

export interface IslandUplandShoulders {
  patches: IslandUplandShoulder[];
  byCell: ReadonlyMap<number, IslandSurfacePolygon>;
}

const DIRECTIONS = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;

/** One local supporting mass, not a series of contour terraces or detached blocks. */
export function createIslandUplandShoulders(
  world: World, ascents: readonly IslandAscent[], beach: IslandBeachShelf, edges: IslandTerraceEdges,
): IslandUplandShoulders {
  const { width, height, tileSize: size, elevations } = world;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
    || !elevations || elevations.length !== width * height || world.cells.length !== elevations.length
    || !Number.isInteger(size) || size <= 0 || !Number.isFinite(world.seed)) {
    throw new RangeError('Upland shoulders require a valid land/elevation grid, finite seed and positive integer cell size.');
  }
  const patches: IslandUplandShoulder[] = [], byCell = new Map<number, IslandSurfacePolygon>();
  const result = { patches, byCell };
  // The internal chamfer comparison remains independent of this orthogonal shape pass.
  if (edges.enabled) return result;
  const indexAt = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height ? y * width + x : -1;
  const neighbors = (index: number) => DIRECTIONS.map(([dx, dy]) => indexAt(index % width + dx, Math.floor(index / width) + dy))
    .filter(next => next >= 0);
  const masses = new Int32Array(elevations.length).fill(-1);
  const parents: number[][] = [];
  for (let first = 0; first < masses.length; first++) {
    if (!world.cells[first] || !elevations[first] || masses[first] >= 0) continue;
    const mass = parents.length, cells = [first];
    masses[first] = mass;
    for (let cursor = 0; cursor < cells.length; cursor++) for (const next of neighbors(cells[cursor])) {
      if (!world.cells[next] || !elevations[next] || masses[next] >= 0) continue;
      masses[next] = mass;
      cells.push(next);
    }
    parents.push(cells);
  }
  const clear = new Uint8Array(elevations.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x;
    if (!world.cells[index] || elevations[index]) continue;
    if (ascents.some(({ bounds }) => (x + 1) * size > bounds.x - size * 2
      && x * size < bounds.x + bounds.width + size * 2
      && (y + 1) * size > bounds.y - size * 2 && y * size < bounds.y + bounds.height + size * 2)) continue;
    let safe = true;
    for (let dy = -2; dy <= 2 && safe; dy++) for (let dx = -2; dx <= 2; dx++) {
      const next = indexAt(x + dx, y + dy);
      if (next < 0 || !world.cells[next] || beach.landSurfaces.has(next)
        || terrainAt(world, { x: x + dx, y: y + dy }) === 'sand') { safe = false; break; }
    }
    if (safe) clear[index] = 1;
  }
  const random = seededRandom(world.seed ^ 0x4a37c19);
  const noise = new FastNoiseLite((world.seed ^ 0x63ac97) & 0x7fffffff);
  noise.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2S);
  noise.SetFrequency(1 / 28);
  for (const [mass, parentCells] of parents.entries()) {
    if (parentCells.length < 64) continue;
    const parentLevel = Math.min(...parentCells.map(index => elevations[index]));
    const parentHeight = islandHeightAtLevel(world, parentLevel);
    const shoulderHeight = Math.max(2, Math.round(parentHeight * 0.35 / 2) * 2);
    if (shoulderHeight >= parentHeight) continue;
    const boundary: { index: number; dx: number; dy: number; score: number }[] = [];
    for (const index of parentCells) {
      if (elevations[index] !== parentLevel) continue;
      for (const [dx, dy] of DIRECTIONS) {
        const next = indexAt(index % width + dx, Math.floor(index / width) + dy);
        if (next >= 0 && clear[next]) boundary.push({ index, dx, dy, score: random() });
      }
    }
    boundary.sort((a, b) => b.score - a.score);
    let accepted: number[] | undefined;
    for (const anchor of boundary.slice(0, 24)) {
      const ax = anchor.index % width + 0.5 + anchor.dx * 0.5;
      const ay = Math.floor(anchor.index / width) + 0.5 + anchor.dy * 0.5;
      const alongRadius = Math.min(11, Math.max(6, Math.sqrt(parentCells.length) * 0.55));
      const outRadius = Math.min(7, Math.max(4, Math.sqrt(parentCells.length) * 0.3));
      const candidate = new Set<number>();
      for (let y = Math.max(0, Math.floor(ay - 12)); y <= Math.min(height - 1, Math.ceil(ay + 12)); y++) {
        for (let x = Math.max(0, Math.floor(ax - 12)); x <= Math.min(width - 1, Math.ceil(ax + 12)); x++) {
          const index = y * width + x;
          if (!clear[index] || byCell.has(index)) continue;
          const dx = x + 0.5 - ax, dy = y + 0.5 - ay;
          const outward = dx * anchor.dx + dy * anchor.dy;
          const along = -dx * anchor.dy + dy * anchor.dx;
          if (outward < 0 || (outward - 1) ** 2 / outRadius ** 2 + along ** 2 / alongRadius ** 2
            > 1 + noise.GetNoise((x + 0.5) * size, (y + 0.5) * size) * 0.2) continue;
          let otherMass = false;
          for (let oy = -1; oy <= 1 && !otherMass; oy++) for (let ox = -1; ox <= 1; ox++) {
            const next = indexAt(x + ox, y + oy);
            if (next >= 0 && ((masses[next] >= 0 && masses[next] !== mass) || byCell.has(next))) { otherMass = true; break; }
          }
          if (!otherMass) candidate.add(index);
        }
      }
      const first = indexAt(anchor.index % width + anchor.dx, Math.floor(anchor.index / width) + anchor.dy);
      if (!candidate.has(first)) continue;
      const connected = [first], seen = new Set(connected);
      for (let cursor = 0; cursor < connected.length; cursor++) for (const next of neighbors(connected[cursor])) {
        if (!candidate.has(next) || seen.has(next)) continue;
        seen.add(next); connected.push(next);
      }
      if (connected.length < 16 || connected.length > parentCells.length * 0.4) continue;
      // Do not introduce diagonal-only volume contacts with the parent or lower ground.
      const occupied = (index: number) => index >= 0 && (masses[index] === mass || seen.has(index));
      const contact = parentCells.reduce((sum, index) => sum + neighbors(index).filter(next => seen.has(next)).length, 0);
      const perimeter = parentCells.reduce((sum, index) => sum + 4 - neighbors(index).filter(next => masses[next] === mass).length, 0);
      if (contact < 4 || contact > perimeter * 0.35) continue;
      let saddle = false;
      for (const index of connected) {
        const x = index % width, y = Math.floor(index / width);
        for (const [ox, oy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
          const corners = [[0, 0], [1, 0], [1, 1], [0, 1]]
            .map(([dx, dy]) => indexAt(x + ox + dx, y + oy + dy));
          const bits = corners.reduce((mask, next, i) => mask | (occupied(next) ? 1 << i : 0), 0);
          if (bits === 5 || bits === 10) { saddle = true; break; }
        }
        if (saddle) break;
      }
      if (!saddle) { accepted = connected; break; }
    }
    if (!accepted) continue;
    const surfaces = steppedLandformSurfaces(
      accepted.map(index => ({ x: index % width, y: Math.floor(index / width), level: 0 })), size, [shoulderHeight],
    );
    for (const [i, surface] of surfaces.entries()) byCell.set(accepted[i], { ...surface, level: parentLevel, layer: 'uplands' });
    patches.push({ mass, parentLevel, height: shoulderHeight, cells: accepted, parentCells });
  }
  return result;
}

export function islandShoulderHeightAt(world: World, shoulders: IslandUplandShoulders, cell: Point, point: Point): number | undefined {
  if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y) || cell.x < 0 || cell.y < 0
    || cell.x >= world.width || cell.y >= world.height || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RangeError('Upland shoulder queries require a valid cell and finite point.');
  }
  if (point.x < cell.x * world.tileSize - 1e-7 || point.x > (cell.x + 1) * world.tileSize + 1e-7
    || point.y < cell.y * world.tileSize - 1e-7 || point.y > (cell.y + 1) * world.tileSize + 1e-7) {
    throw new RangeError('Upland shoulder query point must lie in its cell.');
  }
  return shoulders.byCell.get(cell.y * world.width + cell.x)?.vertices[0].z;
}
