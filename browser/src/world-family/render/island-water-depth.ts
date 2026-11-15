import { ISLAND_WATER_HEIGHT } from '../core/island-water-level';
import type { LandTriangle } from '../core/landform-study';
import { rasterLandform, type LandPalette } from './landform-study';
import { WATER_MAX_DEPTH } from './island-water-color';
import type { IslandCoastalSlope } from './island-coastal-slope';

export interface IslandWaterDepth {
  /** Actual top-face depth and bounded continuation for optical queries. */
  sample(x: number, y: number): number;
  /** Whole-island foundation depth when present, independent of finite shelf silhouettes. */
  bodyDepth(x: number, y: number): number;
  /** Bottom contrast feathered at finite silhouettes and internal underwater steps. */
  bedVisibility(x: number, y: number): number;
}

const CONTINUATION = 32;
const MAX_SAMPLES = 2048 * 2048;
const BED_FEATHER = 5;
const BED_STEP_FEATHER = 2.5;
const BODY_RADIUS = 3;

/** Vertical depth, independent of the viewing camera. Only missing seabed is extended. */
export function createIslandWaterDepth(
  triangles: readonly LandTriangle[], coastalSlope?: IslandCoastalSlope,
): IslandWaterDepth {
  const tops = triangles.filter(triangle => triangle.plane === 'top');
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  let maxLevel = 0;
  for (const triangle of tops) {
    maxLevel = Math.max(maxLevel, triangle.level);
    for (const point of triangle.vertices) {
      if (![point.x, point.y, point.z].every(Number.isFinite)) {
        throw new RangeError('Water depth requires finite terrain geometry.');
      }
      left = Math.min(left, point.x); right = Math.max(right, point.x);
      top = Math.min(top, point.y); bottom = Math.max(bottom, point.y);
    }
  }
  const finitePoint = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError('Water depth coordinates must be finite.');
  };
  if (!tops.length) return {
    sample(x, y) { finitePoint(x, y); return WATER_MAX_DEPTH; },
    bodyDepth: coastalSlope?.sample ?? ((x, y) => { finitePoint(x, y); return WATER_MAX_DEPTH; }),
    bedVisibility(x, y) { finitePoint(x, y); return 0; },
  };
  left = Math.floor(left) - CONTINUATION;
  top = Math.floor(top) - CONTINUATION;
  const width = Math.ceil(right) + CONTINUATION - left;
  const height = Math.ceil(bottom) + CONTINUATION - top;
  if (width * height > MAX_SAMPLES) throw new RangeError('Water depth exceeds the 4,194,304-sample budget.');
  const color = [0, 0, 0] as const;
  const palette: LandPalette = {
    water: color, top: color, light: color, middle: color, dark: color,
    levels: new Array<readonly number[]>(maxLevel + 1).fill(color),
  };
  const raster = rasterLandform('plan', palette, [], {
    triangles: tops, viewport: { width, height, origin: { x: -left, y: -top } },
  });
  const count = width * height;
  const values = new Float32Array(count).fill(WATER_MAX_DEPTH);
  const distances = new Float32Array(count).fill(Infinity);
  const nearest = new Int32Array(count).fill(-1);
  const dry = new Uint8Array(count);
  const edges = new Float32Array(count).fill(BED_FEATHER + 0.5);
  const steps = new Float32Array(count).fill(BED_STEP_FEATHER + 0.5);
  for (let i = 0; i < count; i++) {
    const z = raster.depth[i];
    if (z === -Infinity) { edges[i] = 0; continue; }
    if (z > ISLAND_WATER_HEIGHT + 1e-7) {
      dry[i] = 1;
      values[i] = edges[i] = steps[i] = 0;
    } else {
      values[i] = Math.min(WATER_MAX_DEPTH, Math.max(0, ISLAND_WATER_HEIGHT - z));
      distances[i] = 0;
      nearest[i] = i;
      // The padded field contains every wet cell's neighbours; dry contacts stay clear.
      for (const offset of [-1, 1, -width, width]) {
        const neighbor = raster.depth[i + offset];
        if (neighbor !== -Infinity && neighbor <= ISLAND_WATER_HEIGHT + 1e-7
          && Math.abs(z - neighbor) >= 0.5) steps[i] = 0.5;
      }
    }
  }
  // Continue the bed outside its finite footprint, never across dry ground or over real tops.
  for (const step of [1, -1]) {
    for (let y = step > 0 ? 0 : height - 1; y >= 0 && y < height; y += step) {
      for (let x = step > 0 ? 0 : width - 1; x >= 0 && x < width; x += step) {
        const i = y * width + x;
        if (dry[i]) continue;
        for (const [dx, dy] of [[-step, 0], [0, -step], [-step, -step], [step, -step]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const neighbor = ny * width + nx;
          const stride = dx && dy ? Math.SQRT2 : 1;
          if (distances[i] === 0) {
            if (!dry[neighbor]) {
              edges[i] = Math.min(edges[i], edges[neighbor] + stride);
              steps[i] = Math.min(steps[i], steps[neighbor] + stride);
            }
          } else {
            const distance = distances[neighbor] + stride;
            if (nearest[neighbor] >= 0 && distance < distances[i] && distance <= CONTINUATION) {
              distances[i] = distance;
              nearest[i] = nearest[neighbor];
            }
          }
        }
      }
    }
  }
  for (let i = 0; i < count; i++) {
    if (nearest[i] >= 0 && distances[i] > 0) {
      values[i] = Math.min(WATER_MAX_DEPTH, values[nearest[i]] + distances[i] * 0.5);
    }
    const t = Math.max(0, Math.min(1, (edges[i] - 0.5) / BED_FEATHER));
    const step = Math.max(0, Math.min(1, (steps[i] - 0.5) / BED_STEP_FEATHER));
    edges[i] = Math.min(t * t * (3 - 2 * t), step * step * (3 - 2 * step));
  }
  const body = new Float32Array(coastalSlope ? 0 : count);
  if (!coastalSlope) {
    const horizontal = new Float32Array(count);
    const diameter = BODY_RADIUS * 2 + 1;
    for (let y = 0; y < height; y++) {
      let sum = 0;
      const value = (x: number) => values[y * width + Math.max(0, Math.min(width - 1, x))];
      for (let x = -BODY_RADIUS; x <= BODY_RADIUS; x++) sum += value(x);
      for (let x = 0; x < width; x++) {
        horizontal[y * width + x] = Math.max(0, Math.min(WATER_MAX_DEPTH, sum / diameter));
        sum += value(x + BODY_RADIUS + 1) - value(x - BODY_RADIUS);
      }
    }
    for (let x = 0; x < width; x++) {
      let sum = 0;
      const value = (y: number) => horizontal[Math.max(0, Math.min(height - 1, y)) * width + x];
      for (let y = -BODY_RADIUS; y <= BODY_RADIUS; y++) sum += value(y);
      for (let y = 0; y < height; y++) {
        body[y * width + x] = Math.max(0, Math.min(WATER_MAX_DEPTH, sum / diameter));
        sum += value(y + BODY_RADIUS + 1) - value(y - BODY_RADIUS);
      }
    }
  }
  function sample(field: Float32Array, outside: number, x: number, y: number): number {
    finitePoint(x, y);
    const px = x - left - 0.5, py = y - top - 0.5;
    if (px < 0 || py < 0 || px >= width - 1 || py >= height - 1) return outside;
    const ix = Math.floor(px), iy = Math.floor(py), tx = px - ix, ty = py - iy;
    const i = iy * width + ix;
    return (field[i] * (1 - tx) + field[i + 1] * tx) * (1 - ty)
      + (field[i + width] * (1 - tx) + field[i + width + 1] * tx) * ty;
  }
  return {
    sample: (x, y) => sample(values, WATER_MAX_DEPTH, x, y),
    bodyDepth: coastalSlope?.sample ?? ((x, y) => sample(body, WATER_MAX_DEPTH, x, y)),
    bedVisibility: (x, y) => sample(edges, 0, x, y),
  };
}
