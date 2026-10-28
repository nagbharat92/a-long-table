import FastNoiseLite from 'fastnoise-lite';
import type { World } from '../core/contracts';

export const CONTOUR_WAVELENGTH = 28;
export const CONTOUR_DETAIL_SCALE = 3;
export const CONTOUR_STRENGTH = 0.13;
export const CONTOUR_THRESHOLD = 0.5;

export function islandContourField(world: World, values: Uint8Array, maxLevel: number): Uint8Array {
  const { tileSize: tile, width: columns, height: rows } = world;
  const width = columns * tile;
  const height = rows * tile;
  const levels = new Uint8Array(width * height);
  const fields = Array.from({ length: maxLevel }, (_, index) => {
    const field = new Float32Array(columns * rows);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        let total = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = Math.max(0, Math.min(columns - 1, x + dx));
            const ny = Math.max(0, Math.min(rows - 1, y + dy));
            if (values[ny * columns + nx] > index) {
              total += (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1);
            }
          }
        }
        field[y * columns + x] = total / 16;
      }
    }
    return field;
  });
  const noise = new FastNoiseLite(world.seed ^ 0x6ab591);
  noise.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2S);
  noise.SetFrequency(1 / CONTOUR_WAVELENGTH);
  const sample = (field: Float32Array, x: number, y: number) => {
    const gx = Math.max(0, Math.min(columns - 1, x / tile - 0.5));
    const gy = Math.max(0, Math.min(rows - 1, y / tile - 0.5));
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const nx = Math.min(columns - 1, ix + 1);
    const ny = Math.min(rows - 1, iy + 1);
    const u = gx - ix;
    const v = gy - iy;
    const row = (y: number) => field[y * columns + ix] * (1 - u) + field[y * columns + nx] * u;
    return row(iy) * (1 - v) + row(ny) * v;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const variation = (noise.GetNoise(x, y)
        + noise.GetNoise(x * CONTOUR_DETAIL_SCALE + 71, y * CONTOUR_DETAIL_SCALE - 43)) * CONTOUR_STRENGTH;
      for (let level = 1; level <= fields.length; level++) {
        if (sample(fields[level - 1], x + 0.5, y + 0.5) + variation >= CONTOUR_THRESHOLD) {
          levels[y * width + x] = level;
        }
      }
    }
  }
  return levels;
}
