import FastNoiseLite from 'fastnoise-lite';
import type { World } from '../core/contracts';
import { seededRandom } from '../core/random';
import { terrainAt } from '../core/world';

export interface IslandShoreSample {
  /** World units: negative on land, positive in water. */
  distance: number;
  /** Unsigned distance to an actual low, non-ramp sandy coastline; Infinity if absent. */
  beachDistance: number;
  /** Unsigned distance to the remaining coastline; Infinity if absent. */
  cliffDistance: number;
  beachWeight: number;
  kind: 'beach' | 'cliff' | 'inland' | 'open-water';
  variation: number;
  breakup: number;
  /** Cycle offset shared by every point on a connected beach. */
  phase: number;
  wetWidth: number;
  shallowWidth: number;
}

export interface IslandShoreField {
  distance(x: number, y: number): number;
  sample(x: number, y: number): IslandShoreSample;
}

function assertCoordinates(x: number, y: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new RangeError('Shore queries require finite world coordinates.');
  }
}

/**
 * Snapshot of the existing one-world-unit chamfer field, including its half-pixel
 * boundary interpolation and radial extension beyond the 64-unit padded map.
 * Diagonal distances are approximate; straight cell edges are exact.
 */
export function createCoastField(world: World): { sample(x: number, y: number): number } {
  const padding = 64;
  const width = world.width * world.tileSize + padding * 2;
  const height = world.height * world.tileSize + padding * 2;
  const mask = new Uint8Array(width * height);
  let hasLand = false;
  for (let y = padding; y < height - padding; y++) {
    for (let x = padding; x < width - padding; x++) {
      const cell = Math.floor((y - padding) / world.tileSize) * world.width
        + Math.floor((x - padding) / world.tileSize);
      mask[y * width + x] = world.cells[cell] ? 1 : 0;
      hasLand ||= !!world.cells[cell];
    }
  }
  function distance(target: number): Float32Array {
    const values = Float32Array.from(mask, value => value === target ? 0 : width + height);
    for (const step of [1, -1]) {
      const neighbors = [[-step, 0], [0, -step], [-step, -step], [step, -step]];
      for (let y = step > 0 ? 0 : height - 1; y >= 0 && y < height; y += step) {
        for (let x = step > 0 ? 0 : width - 1; x >= 0 && x < width; x += step) {
          const i = y * width + x;
          for (const [dx, dy] of neighbors) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            values[i] = Math.min(values[i], values[ny * width + nx] + (dx && dy ? Math.SQRT2 : 1));
          }
        }
      }
    }
    return values;
  }
  const landDistance = distance(1), waterDistance = distance(0);
  const signed = Float32Array.from(mask, (value, i) => value ? 0.5 - waterDistance[i] : landDistance[i] - 0.5);
  return {
    sample(x, y) {
      assertCoordinates(x, y);
      if (!hasLand) return Infinity;
      const px = x + padding - 0.5, py = y + padding - 0.5;
      const cx = Math.max(0, Math.min(width - 1.001, px));
      const cy = Math.max(0, Math.min(height - 1.001, py));
      const left = Math.floor(cx), top = Math.floor(cy);
      const tx = cx - left, ty = cy - top;
      return (signed[top * width + left] * (1 - tx) + signed[top * width + left + 1] * tx) * (1 - ty)
        + (signed[(top + 1) * width + left] * (1 - tx) + signed[(top + 1) * width + left + 1] * tx) * ty
        + Math.hypot(px - cx, py - cy);
    },
  };
}

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface CoastEdge extends Bounds {
  phase: number;
}

interface CoastNode extends Bounds {
  edges?: CoastEdge[];
  children?: [CoastNode, CoastNode];
}

function staggerBeaches(edges: CoastEdge[], seed: number): void {
  const joints = new Map<string, CoastEdge[]>();
  const endpoints = (edge: CoastEdge) => [`${edge.left}:${edge.top}`, `${edge.right}:${edge.bottom}`];
  for (const edge of edges) for (const key of endpoints(edge)) {
    const joined = joints.get(key);
    if (joined) joined.push(edge);
    else joints.set(key, [edge]);
  }
  let phase = seededRandom(seed ^ 0x71a39f)();
  for (const edge of edges) edge.phase = -1;
  for (const edge of edges) {
    if (edge.phase >= 0) continue;
    const group = [edge];
    edge.phase = phase;
    for (let i = 0; i < group.length; i++) for (const key of endpoints(group[i])) {
      for (const neighbor of joints.get(key)!) {
        if (neighbor.phase >= 0) continue;
        neighbor.phase = phase;
        group.push(neighbor);
      }
    }
    // A golden-ratio step spreads arrivals without a repeated coastwise order.
    phase = (phase + (Math.sqrt(5) - 1) / 2) % 1;
  }
}

function buildTree(edges: CoastEdge[]): CoastNode | undefined {
  if (!edges.length) return undefined;
  const bounds = edges.reduce((result, edge) => ({
    left: Math.min(result.left, edge.left), top: Math.min(result.top, edge.top),
    right: Math.max(result.right, edge.right), bottom: Math.max(result.bottom, edge.bottom),
  }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
  if (edges.length <= 8) return { ...bounds, edges };
  const horizontal = bounds.right - bounds.left >= bounds.bottom - bounds.top;
  edges.sort((a, b) => horizontal ? a.left + a.right - b.left - b.right : a.top + a.bottom - b.top - b.bottom);
  const middle = Math.floor(edges.length / 2);
  return { ...bounds, children: [buildTree(edges.slice(0, middle))!, buildTree(edges.slice(middle))!] };
}

function boundsDistance(bounds: Bounds, x: number, y: number): number {
  return Math.hypot(Math.max(bounds.left - x, 0, x - bounds.right),
    Math.max(bounds.top - y, 0, y - bounds.bottom));
}

function nearest(node: CoastNode | undefined, x: number, y: number, best?: CoastEdge): CoastEdge | undefined {
  let distance = best ? boundsDistance(best, x, y) : Infinity;
  if (!node || boundsDistance(node, x, y) >= distance) return best;
  if (node.edges) {
    for (const edge of node.edges) {
      const candidate = boundsDistance(edge, x, y);
      if (candidate < distance) {
        best = edge;
        distance = candidate;
      }
    }
  } else if (node.children) {
    const [a, b] = node.children;
    const first = boundsDistance(a, x, y) <= boundsDistance(b, x, y) ? a : b;
    best = nearest(first, x, y, best);
    best = nearest(first === a ? b : a, x, y, best);
  }
  return best;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };

function noise(seed: number, scale: number): FastNoiseLite {
  const field = new FastNoiseLite(seed & 0x7fffffff);
  field.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2S);
  field.SetFractalType(FastNoiseLite.FractalType.None);
  field.SetFrequency(1 / scale);
  return field;
}

/**
 * Immutable world-space shoreline snapshot. Class distances use exact Euclidean
 * distance to axis-aligned exposed cell edges, accelerated by static bounds trees.
 * Widths are art-directed proximity bands, not bathymetry. Recreate after world edits.
 */
export function createIslandShoreField(world: World): IslandShoreField {
  const coast = createCoastField(world);
  const beaches: CoastEdge[] = [], cliffs: CoastEdge[] = [];
  const size = world.tileSize;
  const land = (x: number, y: number) => x >= 0 && y >= 0 && x < world.width && y < world.height
    && !!world.cells[y * world.width + x];
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      if (!land(x, y)) continue;
      const index = y * world.width + x;
      const beach = terrainAt(world, { x, y }) === 'sand'
        && (world.elevations?.[index] ?? 0) === 0 && (world.rampIds?.[index] ?? -1) < 0;
      const edges = beach ? beaches : cliffs;
      const left = x * size, top = y * size, right = left + size, bottom = top + size;
      if (!land(x - 1, y)) edges.push({ left, top, right: left, bottom, phase: 0 });
      if (!land(x + 1, y)) edges.push({ left: right, top, right, bottom, phase: 0 });
      if (!land(x, y - 1)) edges.push({ left, top, right, bottom: top, phase: 0 });
      if (!land(x, y + 1)) edges.push({ left, top: bottom, right, bottom, phase: 0 });
    }
  }
  staggerBeaches(beaches, world.seed);
  const beachTree = buildTree(beaches), cliffTree = buildTree(cliffs);
  const broad = noise(world.seed ^ 0x4ab731, 25);
  const broken = noise(world.seed ^ 0x1d7bc3, 8);
  return {
    distance: (x, y) => coast.sample(x, y),
    sample(x, y) {
      assertCoordinates(x, y);
      const distance = coast.sample(x, y);
      const beach = nearest(beachTree, x, y), cliff = nearest(cliffTree, x, y);
      const beachDistance = beach ? boundsDistance(beach, x, y) : Infinity;
      const cliffDistance = cliff ? boundsDistance(cliff, x, y) : Infinity;
      // Avoid Infinity subtraction for missing classes, including empty worlds.
      const beachWeight = !beachTree ? 0 : !cliffTree ? 1 : beachDistance === cliffDistance ? 0.5
        : smooth(0.5 + (cliffDistance - beachDistance) / 12);
      // Keep noise arithmetic bounded for arbitrarily distant finite queries.
      // This wrap lies far beyond the map; there are no per-tile discontinuities.
      const nx = x % 1048576, ny = y % 1048576;
      const variation = Math.max(-1, Math.min(1, broad.GetNoise(nx, ny)));
      const breakup = Math.max(-1, Math.min(1, broken.GetNoise(nx, ny)));
      const phase = beach?.phase ?? 0;
      return {
        distance, beachDistance, cliffDistance, beachWeight,
        kind: distance < -16 ? 'inland' : distance > 20 ? 'open-water'
          : beachDistance < cliffDistance ? 'beach' : 'cliff',
        variation, breakup, phase,
        wetWidth: 2.2 + variation * 0.7,
        shallowWidth: (4 + variation) * (1 - beachWeight) + (12 + variation * 3) * beachWeight,
      };
    },
  };
}
