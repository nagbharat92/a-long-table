import FastNoiseLite from 'fastnoise-lite';

const RADIUS = 20;

/** Smooth the classification field, never the rendered sand/grass colours. */
export function roundedBeachCoverage(width: number, height: number, ground: Uint8Array): Float32Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
    || width * height > 2048 * 2048 || ground.length !== width * height || ground.some(value => value > 1)) {
    throw new RangeError('Beach mask requires a bounded binary pixel grid.');
  }
  const horizontal = new Float32Array(ground.length), result = new Float32Array(ground.length);
  const total = (RADIUS + 1) ** 2;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let dx = -RADIUS; dx <= RADIUS; dx++) {
      const nx = x + dx;
      if (nx >= 0 && nx < width) sum += ground[y * width + nx] * (RADIUS + 1 - Math.abs(dx));
    }
    horizontal[y * width + x] = sum / total;
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let dy = -RADIUS; dy <= RADIUS; dy++) {
      const ny = y + dy;
      if (ny >= 0 && ny < height) sum += horizontal[ny * width + x] * (RADIUS + 1 - Math.abs(dy));
    }
    result[y * width + x] = sum / total;
  }
  return result;
}

export function createCurvedBeachMask(
  width: number, height: number, ground: Uint8Array, seed: number, flat?: Uint8Array,
) {
  const coverage = roundedBeachCoverage(width, height, ground);
  const clearance = flat ? roundedBeachCoverage(width, height, flat) : undefined;
  const noise = new FastNoiseLite(seed ^ 0x714b925);
  noise.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2S);
  noise.SetFrequency(1);
  return (x: number, y: number, strength: number): boolean => {
    if (![x, y, strength].every(Number.isFinite) || x < 0 || y < 0 || x >= width || y >= height
      || strength < 0 || strength > 1) {
      throw new RangeError('Beach seam requires finite coordinates and strength in [0, 1].');
    }
    const px = Math.max(0, Math.min(width - 1, x + noise.GetNoise(x / 64 + 37, y / 64 - 91) * 16 * strength));
    const py = Math.max(0, Math.min(height - 1, y + noise.GetNoise(x / 64 - 113, y / 64 + 53) * 16 * strength));
    const ix = Math.floor(px), iy = Math.floor(py), tx = px - ix, ty = py - iy;
    const right = Math.min(ix + 1, width - 1), bottom = Math.min(iy + 1, height - 1);
    const value = (coverage[iy * width + ix] * (1 - tx) + coverage[iy * width + right] * tx) * (1 - ty)
      + (coverage[bottom * width + ix] * (1 - tx) + coverage[bottom * width + right] * tx) * ty;
    return value > 0.5 && (!clearance || clearance[Math.floor(y) * width + Math.floor(x)] > 0.95);
  };
}
