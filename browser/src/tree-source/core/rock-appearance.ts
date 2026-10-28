import { seededRandom } from './random';
import { polygonContains as contains, type PixelPoint as Point } from './pixel-geometry';

export const ROCK_PREVIEW_SIZE = { width: 48, height: 40 } as const;
export const ROCK_SHAPES = ['Rounded boulder', 'Angular rock', 'Low slab'] as const;
export const ROCK_SIZES = ['Small', 'Medium', 'Large'] as const;
export const ROCK_FACINGS = ['Original', 'Mirrored'] as const;
export const ROCK_PALETTES = [
  { name: 'Granite', tones: ['', '#43464d', '#666d78', '#929da5', '#bec7c9'] },
  { name: 'Sandstone', tones: ['', '#635047', '#92745c', '#bd9e75', '#ddc69a'] },
  { name: 'Slate', tones: ['', '#38454a', '#526d73', '#7b9698', '#abc0b9'] },
] as const;

export interface RockAppearance {
  version: 1;
  seed: number;
  shape: number;
  palette: number;
  size: number;
  facing: number;
}

export function rockSeed(value: string): number {
  if (!/^\d{1,10}$/.test(value) || Number(value) > 4294967295) {
    throw new RangeError('Rock seed must be a whole number from 0 to 4294967295.');
  }
  return Number(value);
}

export function generateRock(seed: number): RockAppearance {
  rockSeed(String(seed));
  const choice = (salt: number, count: number): number => Math.floor(seededRandom(seed ^ salt)() * count);
  return {
    version: 1, seed,
    shape: choice(0x72a1, ROCK_SHAPES.length),
    palette: choice(0x72a2, ROCK_PALETTES.length),
    size: choice(0x72a3, ROCK_SIZES.length),
    facing: choice(0x72a4, ROCK_FACINGS.length),
  };
}

interface RockShape {
  outline: readonly Point[];
  crown: readonly Point[];
  side: readonly Point[];
  ledge: readonly Point[];
}

const SHAPES: readonly RockShape[] = [
  {
    outline: [[7, 30], [8, 24], [11, 19], [15, 16], [23, 14], [31, 16], [36, 21], [39, 28], [37, 33], [29, 35], [15, 35], [9, 33]],
    crown: [[9, 25], [12, 20], [16, 17], [23, 15], [30, 17], [33, 22], [28, 24], [18, 23], [14, 26]],
    side: [[30, 17], [35, 22], [38, 28], [36, 32], [29, 34], [27, 29], [28, 24], [33, 22]],
    ledge: [[13, 21], [17, 18], [23, 17], [26, 18], [20, 19], [17, 22]],
  },
  {
    outline: [[9, 31], [12, 20], [18, 9], [26, 5], [30, 14], [35, 19], [38, 31], [33, 35], [16, 35]],
    crown: [[13, 21], [19, 10], [25, 6], [28, 15], [24, 21], [18, 25]],
    side: [[26, 6], [30, 15], [34, 20], [37, 31], [32, 34], [24, 30], [24, 21], [28, 15]],
    ledge: [[17, 17], [20, 11], [24, 9], [22, 14], [20, 16]],
  },
  {
    outline: [[4, 29], [9, 24], [21, 21], [32, 22], [41, 27], [43, 31], [37, 35], [13, 35], [5, 33]],
    crown: [[5, 29], [10, 25], [21, 22], [32, 23], [40, 27], [34, 30], [20, 29], [12, 31]],
    side: [[40, 27], [42, 31], [36, 34], [24, 34], [20, 29], [34, 30]],
    ledge: [[10, 27], [21, 24], [30, 25], [27, 26], [18, 26], [13, 28]],
  },
];

export function rockPixels(appearance: RockAppearance): number[][] {
  rockSeed(String(appearance.seed));
  if (appearance.version !== 1) throw new RangeError('Unsupported rock recipe version.');
  for (const [value, count] of [[appearance.shape, ROCK_SHAPES.length], [appearance.palette, ROCK_PALETTES.length],
    [appearance.size, ROCK_SIZES.length], [appearance.facing, ROCK_FACINGS.length]]) {
    if (!Number.isInteger(value) || value < 0 || value >= count) throw new RangeError('Invalid rock recipe parameter.');
  }
  const { width, height } = ROCK_PREVIEW_SIZE;
  const scale = [0.55, 0.78, 1][appearance.size];
  const shape = SHAPES[appearance.shape];
  const pixels = Array.from({ length: height }, () => Array<number>(width).fill(0));
  const random = seededRandom(appearance.seed ^ 0x72b0);
  const seam = 27 + Math.floor(random() * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sourceX = 24 + (x + 0.5 - 24) / scale;
    const sx = appearance.facing ? width - sourceX : sourceX;
    const sy = 35 + (y + 0.5 - 35) / scale;
    if (!contains(shape.outline, sx, sy)) continue;
    let tone = 3;
    if (contains(shape.crown, sx, sy)) tone = 4;
    if (contains(shape.side, sx, sy)) tone = appearance.facing ? 3 : 2;
    if (contains(shape.ledge, sx, sy)) tone = 4;
    if (sy > seam && sy < seam + 1 && sx > 13 && sx < 23) tone = 2;
    if (sy > 32.5) tone = 2;
    pixels[y][x] = tone;
  }
  // Keep the contour narrow; use the underside, not a floating shadow, to anchor the stone.
  const mask = pixels.map(row => row.map(Boolean));
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    if (!mask[y][x]) continue;
    if (!mask[y + 1][x] || (!mask[y][x + 1] && !mask[y - 1][x])) pixels[y][x] = 1;
    else if (!mask[y - 1][x] && pixels[y][x] !== 4) pixels[y][x] = 3;
  }
  return pixels;
}

export function drawRockPreview(context: CanvasRenderingContext2D, appearance: RockAppearance): void {
  const pixels = rockPixels(appearance);
  const { width, height } = ROCK_PREVIEW_SIZE;
  context.clearRect(0, 0, width, height);
  pixels.forEach((row, y) => row.forEach((tone, x) => {
    if (!tone) return;
    context.fillStyle = ROCK_PALETTES[appearance.palette].tones[tone];
    context.fillRect(x, y, 1, 1);
  }));
}
