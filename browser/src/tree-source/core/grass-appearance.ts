import { FOLIAGE_PALETTES } from './foliage-palettes';
import { seededRandom } from './random';

export const GRASS_PREVIEW_SIZE = { width: 48, height: 40 } as const;
export const GRASS_SHAPES = ['Compact tuft', 'Windswept tuft', 'Wild clump'] as const;
export const GRASS_SIZES = ['Small', 'Medium', 'Tall'] as const;
export const GRASS_DENSITIES = ['Sparse', 'Full', 'Lush'] as const;

export interface GrassAppearance {
  version: 1;
  seed: number;
  shape: number;
  foliage: number;
  size: number;
  density: number;
}

export function grassSeed(value: string): number {
  if (!/^\d{1,10}$/.test(value) || Number(value) > 4294967295) {
    throw new RangeError('Grass seed must be a whole number from 0 to 4294967295.');
  }
  return Number(value);
}

export function generateGrass(seed: number): GrassAppearance {
  grassSeed(String(seed));
  const choice = (salt: number, count: number): number => Math.floor(seededRandom(seed ^ salt)() * count);
  return {
    version: 1, seed,
    shape: choice(0x71a1, GRASS_SHAPES.length),
    foliage: choice(0x71a2, FOLIAGE_PALETTES.length),
    size: choice(0x71a3, GRASS_SIZES.length),
    density: choice(0x71a4, GRASS_DENSITIES.length),
  };
}

// Root offset, tip offset, height, blade width. Back blades are painted first.
type Blade = readonly [number, number, number, number];
const BLADES: readonly (readonly Blade[])[] = [
  [[-3, -9, 17, 3], [3, 5, 23, 3], [0, -2, 26, 4], [-5, -17, 12, 4],
    [5, 17, 15, 4], [-2, -11, 22, 4], [2, 10, 20, 4], [-4, -15, 9, 3],
    [4, 15, 10, 3], [0, 1, 15, 4]],
  [[-4, 2, 16, 3], [1, 15, 24, 3], [-2, 8, 27, 4], [-6, -8, 11, 3],
    [5, 20, 14, 4], [-3, 9, 21, 4], [3, 18, 19, 4], [-4, 2, 10, 3],
    [5, 20, 8, 3], [0, 12, 14, 4]],
  [[-6, -12, 24, 3], [5, 12, 29, 3], [-1, -3, 32, 4], [-8, -20, 13, 4],
    [8, 21, 18, 4], [-4, -14, 28, 4], [4, 15, 25, 4], [-7, -20, 9, 4],
    [7, 21, 11, 4], [0, 3, 22, 5]],
];

export function grassPixels(appearance: GrassAppearance): number[][] {
  grassSeed(String(appearance.seed));
  for (const [value, count] of [[appearance.shape, GRASS_SHAPES.length], [appearance.foliage, FOLIAGE_PALETTES.length],
    [appearance.size, GRASS_SIZES.length], [appearance.density, GRASS_DENSITIES.length]]) {
    if (!Number.isInteger(value) || value < 0 || value >= count) throw new RangeError('Invalid grass recipe parameter.');
  }
  const { width, height } = GRASS_PREVIEW_SIZE;
  const pixels = Array.from({ length: height }, () => Array<number>(width).fill(0));
  const random = seededRandom(appearance.seed ^ 0x71b0);
  const scale = [0.65, 0.85, 1][appearance.size];
  const count = [5, 7, 10][appearance.density];
  const base = 35;
  const put = (x: number, y: number, tone: number): void => {
    if (x >= 0 && x < width && y >= 0 && y < height) pixels[y][x] = tone;
  };
  BLADES[appearance.shape].slice(0, count).forEach(([root, tip, bladeHeight, bladeWidth], index) => {
    const length = Math.round((bladeHeight - random() * 3) * scale);
    const start = 24 + root * scale;
    const reach = 24 + (tip + random() * 2 - 1) * scale;
    const ground = base - (index % 3 === 0 ? 1 : 0);
    let previousLeft: number | undefined;
    let previousRight: number | undefined;
    for (let row = length; row >= 0; row--) {
      const t = row / length;
      const center = start + (reach - start) * t * t;
      const breadth = Math.max(1, Math.round(bladeWidth * 1.65 * scale * (0.65 + 0.6 * Math.sin(t * Math.PI)) * (1 - t * 0.9)));
      let left = Math.round(center - breadth / 2);
      let right = left + breadth - 1;
      // Bridge steep bends so the tip never becomes a detached pixel.
      if (previousLeft !== undefined && previousLeft > right + 1) right = previousLeft - 1;
      if (previousRight !== undefined && previousRight < left - 1) left = previousRight + 1;
      for (let column = 0; column <= right - left; column++) {
        const tone = t < 0.12 ? 1 : column === right - left && right - left > 1 ? 1
          : t > 0.82 || (column === 0 && index % 3 !== 0) ? 3 : 2;
        put(left + column, ground - row, tone);
      }
      previousLeft = left;
      previousRight = right;
    }
  });
  const spread = Math.round((appearance.shape === 2 ? 11 : 8) * scale);
  for (let x = 24 - spread; x <= 24 + spread; x++) {
    put(x, base - (Math.abs(x - 24) > spread - 2 ? 1 : 0), 1);
    if (Math.abs(x - 24) < spread - 2) put(x, base - 1, x % 4 === 0 ? 3 : 2);
  }
  return pixels;
}

export function drawGrassPreview(context: CanvasRenderingContext2D, appearance: GrassAppearance): void {
  const palette = FOLIAGE_PALETTES[appearance.foliage];
  const pixels = grassPixels(appearance);
  const tones = ['', palette.ink, palette.leaf, palette.light, palette.bud];
  context.clearRect(0, 0, GRASS_PREVIEW_SIZE.width, GRASS_PREVIEW_SIZE.height);
  pixels.forEach((row, y) => row.forEach((tone, x) => {
    if (!tone) return;
    context.fillStyle = tones[tone];
    context.fillRect(x, y, 1, 1);
  }));
}
