import FastNoiseLite from 'fastnoise-lite';
import type { World } from '../core/contracts';

export interface GroundInfluences {
  /** Per-cell values in [0, 1], supplied by actual canopy or disturbance systems. */
  canopy?: Float32Array;
  disturbance?: Float32Array;
}

export interface GroundSample {
  turf: number;
  meadow: number;
  moss: number;
  earth: number;
  moisture: number;
  shelter: number;
  coast: number;
  detail: number;
  grain: number;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (low: number, high: number, value: number) => {
  const t = clamp((value - low) / (high - low));
  return t * t * (3 - 2 * t);
};

function distances(world: World, source: (i: number) => boolean, sameLevel: boolean): Float32Array {
  const result = new Float32Array(world.heights.length).fill(world.width + world.height);
  const queue: number[] = [];
  for (let i = 0; i < result.length; i++) {
    if (!source(i)) continue;
    result[i] = 0;
    queue.push(i);
  }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const i = queue[cursor];
    const x = i % world.width;
    const y = Math.floor(i / world.width);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue;
      const n = ny * world.width + nx;
      if (sameLevel && (world.heights[n] <= world.seaLevel || world.cliffCells?.[n]
        || (world.elevations?.[i] ?? 0) !== (world.elevations?.[n] ?? 0))) continue;
      if (result[n] <= result[i] + 1) continue;
      result[n] = result[i] + 1;
      queue.push(n);
    }
  }
  return result;
}

export function createIslandGroundField(world: World, influences: GroundInfluences = {}) {
  for (const name of ['canopy', 'disturbance'] as const) {
    const values = influences[name];
    if (!values) continue;
    if (values.length !== world.heights.length || values.some(value => !Number.isFinite(value) || value < 0 || value > 1)) {
      throw new Error(`Ground ${name} must contain one finite value in [0, 1] per world cell.`);
    }
  }
  const noise = new FastNoiseLite(world.seed ^ 0x5e21bc79);
  noise.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2S);
  noise.SetFrequency(1);
  const broadNoise = new FastNoiseLite(world.seed ^ 0x72a39b51);
  broadNoise.SetNoiseType(FastNoiseLite.NoiseType.Perlin);
  broadNoise.SetFrequency(1);
  const n = (x: number, y: number, scale: number, offset: number) =>
    (scale >= 40 ? broadNoise : noise).GetNoise(
      (x * 0.8 - y * 0.6) / scale + offset, (x * 0.6 + y * 0.8) / scale - offset * 0.73);
  const shore = distances(world, i => world.heights[i] <= world.seaLevel, false);
  const wear = distances(world, i => (world.rampIds?.[i] ?? -1) >= 0, true);
  const shelter = new Float32Array(world.heights.length);
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const i = y * world.width + x;
      const level = world.elevations?.[i] ?? 0;
      // Higher ground on the upper-left side shelters the foot, not the terrace rim.
      for (let distance = 1; distance <= 6; distance++) {
        for (const [dx, dy] of [[-1, 0], [0, -1], [-1, -1]]) {
          const nx = x + dx * distance;
          const ny = y + dy * distance;
          if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue;
          const neighbor = ny * world.width + nx;
          if (world.heights[neighbor] > world.seaLevel && (world.elevations?.[neighbor] ?? 0) > level) {
            shelter[i] = Math.max(shelter[i], (1 - distance / 7) * 0.8);
          }
        }
      }
      shelter[i] = 1 - (1 - shelter[i]) * (1 - (influences.canopy?.[i] ?? 0));
    }
  }
  const interpolate = (values: Float32Array, x: number, y: number) => {
    const cx = Math.max(0, Math.min(world.width - 1, x / world.tileSize - 0.5));
    const cy = Math.max(0, Math.min(world.height - 1, y / world.tileSize - 0.5));
    const left = Math.floor(cx);
    const top = Math.floor(cy);
    const right = Math.min(world.width - 1, left + 1);
    const bottom = Math.min(world.height - 1, top + 1);
    const tx = cx - left;
    const ty = cy - top;
    const a = values[top * world.width + left] * (1 - tx) + values[top * world.width + right] * tx;
    const b = values[bottom * world.width + left] * (1 - tx) + values[bottom * world.width + right] * tx;
    return a * (1 - ty) + b * ty;
  };
  return {
    sample(x: number, y: number): GroundSample {
      const warpX = n(x, y, 95, 13) * 12;
      const warpY = n(x, y, 95, 47) * 12;
      const u = x + warpX;
      const v = y + warpY;
      const broad = n(u, v, 125, 83) * 0.75 + n(u, v, 250, 359) * 0.25;
      const growth = n(u, v, 43, 127);
      const breakup = n(u + growth * 9, v - growth * 7, 15, 173);
      const grain = n(u, v, 4.5, 257);
      const shade = interpolate(shelter, x, y);
      const coast = 1 - smooth(2, 13, interpolate(shore, x, y));
      const disturbance = Math.max(1 - smooth(0, 5, interpolate(wear, x, y)),
        influences.disturbance ? interpolate(influences.disturbance, x, y) : 0);
      // This is an art-directed moisture proxy, not a hydrology simulation.
      const moisture = clamp(0.47 + broad * 0.32 + n(u, v, 67, 211) * 0.18 + shade * 0.3 - coast * 0.25);
      const edge = growth * 0.08 + breakup * 0.025 + grain * 0.003;
      const moss = smooth(0.44, 0.82, moisture + edge) * (1 - coast * 0.85) * (1 - disturbance * 0.9);
      const meadow = smooth(0.39, 0.72, 0.51 - broad * 0.26 + edge)
        * (1 - shade * 0.65) * (1 - disturbance * 0.65);
      const earth = smooth(0.55, 0.86, disturbance * 0.7 + coast * 0.24
        + n(u, v, 31, 307) * 0.19 + breakup * 0.05) * 0.65;
      const turf = 0.55;
      const total = turf + meadow + moss + earth;
      return {
        turf: turf / total, meadow: meadow / total, moss: moss / total, earth: earth / total,
        moisture, shelter: shade, coast, detail: growth * 0.65 + breakup * 0.35, grain,
      };
    },
  };
}
