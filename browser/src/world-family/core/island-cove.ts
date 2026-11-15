import type { Point, World } from './contracts';
import type { IslandAscent } from './island-ascents';

export const COVE_STUDY_SEED = 153025;

export interface IslandCove {
  center: Point;
  radius: Point;
  rotation: number;
  gradeWidth: number;
  shelfWidth: number;
  shelfDepth: number;
  focus: Point;
  shoreMask?: { origin: Point; spacing: number; width: number; height: number; weights: Float32Array };
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };

function coordinates(cove: IslandCove, point: Point): { distance: number; angle: number } {
  const dx = point.x - cove.center.x, dy = point.y - cove.center.y;
  const cosine = Math.cos(cove.rotation), sine = Math.sin(cove.rotation);
  const x = (dx * cosine + dy * sine) / cove.radius.x;
  const y = (-dx * sine + dy * cosine) / cove.radius.y;
  const angle = Math.atan2(y, x);
  const outline = 1 + 0.035 * Math.cos(angle * 3 + 0.6);
  return { distance: (Math.hypot(x, y) - outline) * Math.min(cove.radius.x, cove.radius.y), angle };
}

/** Local art direction, not a wave-exposure simulation. The ends remain rocky. */
export function islandCoveInfluence(cove: IslandCove, x: number, y: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError('Cove queries require finite coordinates.');
  const { distance, angle } = coordinates(cove, { x, y });
  const influence = smooth((angle + 2.45) / 0.65) * smooth((0.7 - angle) / 0.65)
    * (1 - smooth((distance - 24) / 12));
  if (!influence || !cove.shoreMask) return influence;
  const mask = cove.shoreMask;
  const gx = (x - mask.origin.x) / mask.spacing, gy = (y - mask.origin.y) / mask.spacing;
  if (gx < 0 || gy < 0 || gx >= mask.width - 1 || gy >= mask.height - 1) return 0;
  const ix = Math.floor(gx), iy = Math.floor(gy), tx = gx - ix, ty = gy - iy;
  const i = iy * mask.width + ix;
  return influence * ((mask.weights[i] * (1 - tx) + mask.weights[i + 1] * tx) * (1 - ty)
    + (mask.weights[i + mask.width] * (1 - tx) + mask.weights[i + mask.width + 1] * tx) * ty);
}

export function createIslandCove(source: World, ascents: readonly IslandAscent[]): { world: World; cove: IslandCove } {
  if (source.seed !== COVE_STUDY_SEED || source.width !== 128 || source.height !== 96 || source.tileSize !== 4
    || !source.elevations || !source.rampIds || !source.cliffCells) {
    throw new Error('The cove prototype requires the generated V2 study island, seed 153025.');
  }
  const cove: IslandCove = {
    center: { x: 260, y: 128 }, radius: { x: 56, y: 40 }, rotation: -0.12,
    gradeWidth: 24, shelfWidth: 52, shelfDepth: 2,
    focus: { x: 324, y: 108 },
  };
  const world: World = {
    ...source, cells: source.cells.slice(), heights: source.heights.slice(),
    elevations: source.elevations.slice(), rampIds: source.rampIds.slice(), cliffCells: source.cliffCells.slice(),
    generatorVersion: `${source.generatorVersion}-cove-study-v1`,
  };
  const size = world.tileSize;
  const reserved = (x: number, y: number) => ascents.some(({ bounds }) =>
    (x + 1) * size > bounds.x - size * 2 && x * size < bounds.x + bounds.width + size * 2
    && (y + 1) * size > bounds.y - size * 2 && y * size < bounds.y + bounds.height + size * 2);
  const nearHighland = (x: number, y: number) => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < world.width && ny < world.height
        && source.cells[ny * world.width + nx] && source.elevations![ny * world.width + nx] > 0) return true;
    }
    return false;
  };
  let carved = 0, beach = 0;
  for (let y = 16; y < 46; y++) {
    for (let x = 45; x < 90; x++) {
      const index = y * world.width + x;
      const point = { x: (x + 0.5) * size, y: (y + 0.5) * size };
      const { distance } = coordinates(cove, point);
      if (distance < 0 && source.cells[index]) {
        if (source.elevations[index] > 0 || source.rampIds[index] >= 0 || reserved(x, y)) {
          throw new Error('Cove excavation overlaps protected terrain or an ascent.');
        }
        world.cells[index] = 0;
        world.heights[index] = -0.1;
        world.cliffCells![index] = 0;
        carved++;
      } else if (source.cells[index] && !source.elevations[index] && source.rampIds[index] < 0
        && !reserved(x, y) && !nearHighland(x, y)
        && distance < 28 * islandCoveInfluence(cove, point.x, point.y)) {
        world.heights[index] = 0.06;
        beach++;
      }
    }
  }
  if (!carved || !beach) throw new Error('Cove study did not create its expected excavation and beach.');
  const first = world.cells.findIndex(Boolean), visited = new Set([first]), queue = [first];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const index = queue[cursor], x = index % world.width, y = Math.floor(index / world.width);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx, ny = y + dy, next = ny * world.width + nx;
      if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height || !world.cells[next] || visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  if (visited.size !== world.cells.reduce((sum, cell) => sum + cell, 0)) {
    throw new Error('Cove excavation disconnected the island.');
  }
  return { world, cove };
}
