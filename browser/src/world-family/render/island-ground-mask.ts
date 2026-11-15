import FastNoiseLite from 'fastnoise-lite';
import type { LandTriangle, LandVertex } from '../core/landform-study';
import { openMeshEdges } from '../core/mesh-boundaries';
import { surfaceNormal } from './surface-projection';

const BUCKET_SIZE = 16;
const MAX_WIDTH = 16;
const HEIGHT_TOLERANCE = 0.5;
const SHOULDER_WIDTH = 12;

/** Bounded inland distance to the final sand mask; never changes beach coverage. */
export function createGroundBeachClearance(width: number, height: number, sand: Uint8Array) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
    || width * height > 2048 * 2048 || sand.length !== width * height || sand.some(value => value > 1)) {
    throw new RangeError('Ground beach clearance requires a bounded binary pixel grid.');
  }
  const distances = Float32Array.from(sand, value => value ? 0 : MAX_WIDTH + SHOULDER_WIDTH);
  const diagonal = Math.SQRT2;
  for (const direction of [1, -1]) {
    for (let y = direction > 0 ? 0 : height - 1; y >= 0 && y < height; y += direction) {
      for (let x = direction > 0 ? 0 : width - 1; x >= 0 && x < width; x += direction) {
        const index = y * width + x;
        const nx = x - direction, ny = y - direction;
        if (nx >= 0 && nx < width) distances[index] = Math.min(distances[index], distances[y * width + nx] + 1);
        if (ny < 0 || ny >= height) continue;
        distances[index] = Math.min(distances[index], distances[ny * width + x] + 1);
        for (const dx of [-1, 1]) {
          if (x + dx >= 0 && x + dx < width) {
            distances[index] = Math.min(distances[index], distances[ny * width + x + dx] + diagonal);
          }
        }
      }
    }
  }
  return (point: LandVertex): number => {
    if (![point.x, point.y, point.z].every(Number.isFinite)) {
      throw new RangeError('Ground beach clearance coordinates must be finite.');
    }
    const x = Math.max(0, Math.min(width - 1, Math.floor(point.x)));
    const y = Math.max(0, Math.min(height - 1, Math.floor(point.y)));
    return Math.abs(point.z) <= HEIGHT_TOLERANCE ? distances[y * width + x] : MAX_WIDTH + SHOULDER_WIDTH;
  };
}

/** A single broad, curved skirt at lower terrain junctions. */
export function createIslandGroundMask(
  triangles: readonly LandTriangle[], seed: number, beachClearance?: (point: LandVertex) => number,
) {
  const noise = new FastNoiseLite(seed ^ 0x68b4d925);
  noise.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2S);
  noise.SetFrequency(1);
  const walls = triangles.filter(triangle => triangle.plane !== 'top' && !triangle.submerged
    && triangle.layer !== 'beaches' && (triangle.level > 0 || triangle.ascentId !== undefined));
  const edges = walls.flatMap(triangle => {
    const normal = surfaceNormal(triangle);
    if (Math.abs(normal.z) > 1e-7) return [];
    return triangle.vertices.flatMap((from, i, vertices) => {
      const to = vertices[(i + 1) % vertices.length];
      return Math.hypot(to.x - from.x, to.y - from.y) > 1e-7 ? [{ from, to, normal }] : [];
    });
  });
  const feet = openMeshEdges(edges).filter(({ from, to, edge }) =>
    (to.x - from.x) * -edge.normal.y + (to.y - from.y) * edge.normal.x > 1e-7);
  const buckets = new Map<string, typeof feet>();
  for (const foot of feet) {
    const reach = MAX_WIDTH + SHOULDER_WIDTH;
    const minX = Math.floor((Math.min(foot.from.x, foot.to.x) - reach) / BUCKET_SIZE);
    const maxX = Math.floor((Math.max(foot.from.x, foot.to.x) + reach) / BUCKET_SIZE);
    const minY = Math.floor((Math.min(foot.from.y, foot.to.y) - reach) / BUCKET_SIZE);
    const maxY = Math.floor((Math.max(foot.from.y, foot.to.y) + reach) / BUCKET_SIZE);
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const key = `${x},${y}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(foot);
      else buckets.set(key, [foot]);
    }
  }
  function junction(point: LandVertex): { distance: number; width: number } {
    if (![point.x, point.y, point.z].every(Number.isFinite)) {
      throw new RangeError('Ground mask coordinates must be finite.');
    }
    const candidates = buckets.get(`${Math.floor(point.x / BUCKET_SIZE)},${Math.floor(point.y / BUCKET_SIZE)}`);
    if (!candidates) return { distance: Infinity, width: 0 };
    const x = Math.floor(point.x) + 0.5, y = Math.floor(point.y) + 0.5;
    const width = Math.max(3, Math.min(MAX_WIDTH, 9
      + noise.GetNoise(x / 64, y / 64) * 8
      + noise.GetNoise(x / 32 + 37, y / 32 - 91) * 2));
    let nearest = Infinity;
    for (const foot of candidates) {
      const { from, to, edge } = foot;
      const dx = to.x - from.x, dy = to.y - from.y;
      const t = Math.max(0, Math.min(1, ((x - from.x) * dx + (y - from.y) * dy) / (dx * dx + dy * dy)));
      const px = from.x + dx * t, py = from.y + dy * t;
      const z = from.z + (to.z - from.z) * t;
      const distance = Math.hypot(x - px, y - py);
      if (Math.abs(point.z - z) <= HEIGHT_TOLERANCE
        && (x - px) * edge.normal.x + (y - py) * edge.normal.y >= -1e-7) {
        nearest = Math.min(nearest, distance);
      }
    }
    return { distance: nearest, width };
  }
  function composition(point: LandVertex, surfaceId: number) {
    if (!Number.isInteger(surfaceId) || surfaceId < 0) throw new RangeError('Ground mask surface ID must be a nonnegative integer.');
    const { distance, width } = junction(point);
    const x = Math.floor(point.x) + 0.5, y = Math.floor(point.y) + 0.5;
    const variation = noise.GetNoise(x / 96 + surfaceId * 137 + 311, y / 96 - surfaceId * 89 - 173);
    const clearance = beachClearance?.(point) ?? MAX_WIDTH + SHOULDER_WIDTH;
    if (!Number.isFinite(clearance) || clearance < 0) throw new RangeError('Ground beach clearance must be finite and nonnegative.');
    const coastWeight = Math.max(0, Math.min(1, (clearance - 3) / 9));
    const coast = coastWeight * coastWeight * (3 - 2 * coastWeight);
    const reach = width * Math.max(0.65, Math.min(1.25, 1 + variation * 0.5));
    const seam = coast > 0 && distance <= Math.min(MAX_WIDTH, reach) * coast;
    // The base green grows with the same wall field, joining its lobes instead of being cut by them.
    const support = Math.max(0, 1 - distance / (width + SHOULDER_WIDTH));
    return { seam, variation: variation + support * 1.2 };
  }
  function tone(point: LandVertex, surfaceId = 0): 0 | 1 {
    return composition(point, surfaceId).seam ? 1 : 0;
  }
  return {
    tone,
    sample: (point: LandVertex, surfaceId = 0): boolean => tone(point, surfaceId) > 0,
    shade(point: LandVertex, surfaceId: number): 120 | 245 | 255 {
      const { seam, variation } = composition(point, surfaceId);
      return seam ? 120 : variation < 0 ? 245 : 255;
    },
  };
}
