import { seededRandom } from './random';
import { polygonContains, type PixelPoint } from './pixel-geometry';

export const WOOD_PREVIEW_SIZE = { width: 48, height: 40 } as const;
export const WOOD_SHAPES = ['Fallen log', 'Broken stump', 'Forked branch'] as const;
export const WOOD_SIZES = ['Small', 'Medium', 'Large'] as const;
export const WOOD_FACINGS = ['Original', 'Mirrored'] as const;
export const WOOD_PALETTES = [
  { name: 'Oak', tones: ['', '#443329', '#644735', '#8e6344', '#b48a5b', '#d2ad78', '#98734b'] },
  { name: 'Cedar', tones: ['', '#4d302c', '#75453a', '#a16b4b', '#c39166', '#dfb982', '#a17a53'] },
  { name: 'Weathered', tones: ['', '#44423b', '#626052', '#8b8772', '#aaa68c', '#c8bda0', '#8c8167'] },
] as const;

export interface WoodAppearance {
  version: 1;
  seed: number;
  shape: number;
  palette: number;
  size: number;
  facing: number;
}

export function woodSeed(value: string): number {
  if (!/^\d{1,10}$/.test(value) || Number(value) > 4294967295) {
    throw new RangeError('Wood seed must be a whole number from 0 to 4294967295.');
  }
  return Number(value);
}

export function generateWood(seed: number): WoodAppearance {
  woodSeed(String(seed));
  const choice = (salt: number, count: number): number => Math.floor(seededRandom(seed ^ salt)() * count);
  return {
    version: 1, seed,
    shape: choice(0x73a1, WOOD_SHAPES.length),
    palette: choice(0x73a2, WOOD_PALETTES.length),
    size: choice(0x73a3, WOOD_SIZES.length),
    facing: choice(0x73a4, WOOD_FACINGS.length),
  };
}

function woodSource(appearance: WoodAppearance): number[][] {
  const { width, height } = WOOD_PREVIEW_SIZE;
  const pixels = Array.from({ length: height }, () => Array<number>(width).fill(0));
  const polygon = (points: readonly PixelPoint[], tone: number): void => {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (polygonContains(points, x + 0.5, y + 0.5)) pixels[y][x] = tone;
    }
  };
  const ellipse = (cx: number, cy: number, rx: number, ry: number, tone: number): void => {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) pixels[y][x] = tone;
    }
  };
  const cut = (cx: number, cy: number, rx: number, ry: number): void => {
    ellipse(cx, cy, rx, ry, 1);
    ellipse(cx, cy, rx - 1, ry - 1, 5);
    if (rx > 4 && ry > 3) {
      ellipse(cx, cy, rx - 2, ry - 2, 6);
      ellipse(cx, cy, rx - 3, ry - 3, 5);
      ellipse(cx, cy, 1, 1.5, 6);
    }
  };
  const random = seededRandom(appearance.seed ^ 0x73b0);
  const grain = Math.floor(random() * 3);
  if (appearance.shape === 0) {
    polygon([[23, 18], [24, 11], [22, 8], [25, 7], [28, 12], [29, 17]], 2);
    polygon([[24, 11], [23, 8], [25, 8], [27, 12], [27, 17], [25, 18]], 4);
    polygon([[10, 18], [34, 13], [39, 16], [41, 23], [36, 28], [12, 35], [5, 31], [4, 24]], 2);
    polygon([[10, 19], [34, 14], [38, 17], [39, 21], [14, 28], [8, 26]], 3);
    polygon([[12, 19], [33, 15], [37, 17], [15, 23], [10, 22]], 4);
    polygon([[17, 26], [27, 23], [31, 23], [27, 25], [19, 28]], 1);
    polygon([[19, 30], [30, 27], [36, 26], [31, 29], [22, 32]], 3);
    polygon([[21 + grain, 20], [29 + grain, 18], [32, 18], [25, 21]], 2);
    cut(11, 26, 7, 8);
    polygon([[5, 29], [8, 30], [11, 29], [12, 30], [9, 32], [6, 31]], 6);
  } else if (appearance.shape === 1) {
    polygon([[8, 35], [11, 31], [15, 29], [16, 18], [14, 15], [18, 11], [29, 10], [34, 14], [32, 19], [33, 29], [38, 32], [40, 35], [29, 35], [25, 32], [19, 35]], 2);
    polygon([[16, 18], [24, 17], [23, 27], [20, 32], [13, 34], [17, 28]], 3);
    polygon([[17, 19], [20, 19], [19, 28], [15, 31], [18, 26]], 4);
    polygon([[25, 20], [29, 18], [28, 27], [32, 32], [30, 33], [25, 28]], 3);
    polygon([[28, 23 + grain], [30, 21], [30, 28], [35, 33], [32, 32], [28, 28]], 1);
    polygon([[21, 22], [23, 21], [22, 28], [20, 30]], 2);
    polygon([[14, 15], [18, 10], [22, 12], [26, 7], [30, 10], [34, 14], [30, 19], [20, 20]], 1);
    polygon([[16, 15], [19, 12], [22, 14], [26, 9], [29, 11], [32, 14], [29, 18], [21, 18]], 5);
    ellipse(24, 15, 5, 2.5, 6);
    ellipse(24, 15, 3.5, 1.5, 5);
    polygon([[27, 9], [29, 11], [29, 15], [27, 13]], 4);
    polygon([[23, 17], [25, 15], [27, 15], [26, 16], [25, 17], [25, 19]], 1);
  } else {
    polygon([[18, 28], [17, 23], [12, 17], [13, 14], [16, 15], [20, 20], [24, 25]], 2);
    polygon([[14, 16], [16, 17], [19, 22], [20, 26], [18, 25], [17, 21]], 4);
    polygon([[6, 32], [10, 28], [22, 24], [29, 16], [34, 10], [38, 11], [36, 16], [31, 21], [27, 26], [40, 26], [43, 29], [42, 32], [25, 31], [13, 34], [8, 35]], 2);
    polygon([[8, 31], [22, 26], [30, 18], [35, 12], [37, 12], [33, 19], [25, 29], [12, 33]], 3);
    polygon([[10, 30], [22, 25], [30, 17], [34, 12], [35, 13], [30, 20], [23, 27], [12, 32]], 4);
    polygon([[25, 27], [39, 27], [41, 29], [28, 29], [24, 30]], 3);
    polygon([[27, 27], [38, 27], [40, 28], [31, 28]], 4);
    polygon([[17 + grain, 29], [22 + grain, 27], [25, 27], [23, 29], [18, 31]], 1);
    cut(8, 31.5, 3, 3.5);
    cut(35.5, 12, 2.5, 2);
    cut(14, 16, 2, 2);
    cut(41, 29, 2, 2.5);
  }
  const mask = pixels.map(row => row.map(Boolean));
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    if (mask[y][x] && !mask[y + 1][x] && pixels[y][x] < 5) pixels[y][x] = 1;
  }
  return pixels;
}

export function woodPixels(appearance: WoodAppearance): number[][] {
  woodSeed(String(appearance.seed));
  if (appearance.version !== 1) throw new RangeError('Unsupported wood recipe version.');
  for (const [value, count] of [[appearance.shape, WOOD_SHAPES.length], [appearance.palette, WOOD_PALETTES.length],
    [appearance.size, WOOD_SIZES.length], [appearance.facing, WOOD_FACINGS.length]]) {
    if (!Number.isInteger(value) || value < 0 || value >= count) throw new RangeError('Invalid wood recipe parameter.');
  }
  const source = woodSource(appearance);
  const { width, height } = WOOD_PREVIEW_SIZE;
  const scale = [0.55, 0.78, 1][appearance.size];
  return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => {
    const sx = Math.floor(24 + ((appearance.facing ? width - x - 0.5 : x + 0.5) - 24) / scale);
    const sy = Math.floor(35 + (y + 0.5 - 35) / scale);
    return sx >= 0 && sx < width && sy >= 0 && sy < height ? source[sy][sx] : 0;
  }));
}

export function drawWoodPreview(context: CanvasRenderingContext2D, appearance: WoodAppearance): void {
  const pixels = woodPixels(appearance);
  const { width, height } = WOOD_PREVIEW_SIZE;
  context.clearRect(0, 0, width, height);
  pixels.forEach((row, y) => row.forEach((tone, x) => {
    if (!tone) return;
    context.fillStyle = WOOD_PALETTES[appearance.palette].tones[tone];
    context.fillRect(x, y, 1, 1);
  }));
}
