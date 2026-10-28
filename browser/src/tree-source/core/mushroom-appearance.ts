import { seededRandom } from './random';
import { polygonContains, type PixelPoint } from './pixel-geometry';

export const MUSHROOM_PREVIEW_SIZE = { width: 48, height: 40 } as const;
export const MUSHROOM_SHAPES = ['Button cap', 'Broad flat cap', 'Tall bell cap', 'Fly agaric'] as const;
export const MUSHROOM_SIZES = ['Small', 'Medium', 'Large'] as const;
export const MUSHROOM_FACINGS = ['Original', 'Mirrored'] as const;
export const MUSHROOM_STEMS = ['Short', 'Regular', 'Long'] as const;
export const MUSHROOM_PALETTES = [
  { name: 'Chestnut', cap: ['#614437', '#8e5e43', '#b98660', '#dec09a'] },
  { name: 'Amber', cap: ['#83502d', '#bd7b39', '#e3ad60', '#f4d396'] },
  { name: 'Red', cap: ['#842c32', '#c83e38', '#ed6550', '#f7a16b'] },
  { name: 'Plum', cap: ['#594454', '#865d78', '#af8295', '#ddbbc0'] },
] as const;

export interface MushroomAppearance {
  version: 1;
  seed: number;
  shape: number;
  palette: number;
  size: number;
  facing: number;
  stem: number;
}

export function mushroomSeed(value: string): number {
  if (!/^\d{1,10}$/.test(value) || Number(value) > 4294967295) {
    throw new RangeError('Mushroom seed must be a whole number from 0 to 4294967295.');
  }
  return Number(value);
}

export function generateMushroom(seed: number): MushroomAppearance {
  mushroomSeed(String(seed));
  const choice = (salt: number, count: number): number => Math.floor(seededRandom(seed ^ salt)() * count);
  return {
    version: 1, seed,
    shape: choice(0x74a1, MUSHROOM_SHAPES.length),
    palette: choice(0x74a2, MUSHROOM_PALETTES.length),
    size: choice(0x74a3, MUSHROOM_SIZES.length),
    facing: choice(0x74a4, MUSHROOM_FACINGS.length),
    stem: choice(0x74a5, MUSHROOM_STEMS.length),
  };
}

interface MushroomCap {
  outline: readonly PixelPoint[];
  crown: readonly PixelPoint[];
  light: readonly PixelPoint[];
  underside: readonly PixelPoint[];
  rim: readonly PixelPoint[];
}

const CAPS: readonly MushroomCap[] = [
  {
    outline: [[11, 24], [12, 20], [14, 16], [18, 13], [23, 12], [28, 13], [32, 16], [35, 21], [36, 25], [33, 28], [27, 30], [19, 29], [13, 27]],
    crown: [[12, 23], [13, 19], [16, 15], [20, 13], [25, 13], [30, 15], [33, 19], [34, 24], [29, 26], [21, 26], [15, 25]],
    light: [[14, 20], [16, 16], [20, 14], [25, 14], [28, 16], [23, 16], [19, 18], [17, 21]],
    underside: [[12, 25], [20, 26], [28, 27], [36, 25], [33, 28], [27, 30], [19, 29], [13, 27]],
    rim: [[12, 24], [19, 25], [27, 25], [35, 23], [35, 25], [29, 27], [21, 27], [14, 26]],
  },
  {
    outline: [[5, 25], [9, 22], [13, 19], [19, 17], [25, 16], [31, 17], [36, 20], [39, 23], [43, 25], [40, 27], [33, 29], [24, 30], [15, 28], [9, 27]],
    crown: [[7, 24], [12, 21], [16, 19], [21, 18], [26, 17], [31, 18], [35, 20], [39, 24], [33, 25], [24, 26], [15, 25]],
    light: [[11, 23], [16, 20], [23, 18], [27, 18], [29, 19], [24, 19], [18, 21], [14, 23]],
    underside: [[5, 25], [16, 25], [24, 26], [34, 25], [43, 25], [40, 27], [33, 29], [24, 30], [15, 28], [9, 27]],
    rim: [[6, 24], [15, 25], [24, 26], [33, 25], [41, 24], [42, 25], [34, 27], [24, 28], [15, 27], [8, 26]],
  },
  {
    outline: [[13, 27], [16, 23], [18, 17], [20, 12], [23, 10], [26, 10], [29, 12], [31, 18], [32, 23], [36, 27], [34, 29], [29, 30], [23, 29], [18, 30], [14, 29]],
    crown: [[15, 26], [18, 21], [20, 15], [22, 12], [25, 11], [28, 13], [29, 18], [30, 23], [33, 27], [27, 27], [22, 26], [18, 28]],
    light: [[18, 23], [20, 17], [22, 13], [24, 12], [26, 13], [24, 16], [23, 21], [21, 25]],
    underside: [[13, 27], [20, 26], [25, 27], [30, 28], [36, 27], [34, 29], [29, 30], [23, 29], [18, 30], [14, 29]],
    rim: [[14, 27], [20, 26], [25, 27], [30, 28], [35, 27], [34, 28], [29, 29], [24, 28], [20, 27], [15, 29]],
  },
  {
    outline: [[7, 24], [8, 20], [11, 16], [15, 13], [20, 11], [26, 11], [32, 13], [37, 17], [40, 22], [41, 25], [37, 27], [29, 29], [19, 28], [11, 26]],
    crown: [[8, 23], [10, 19], [13, 16], [17, 13], [22, 12], [27, 12], [32, 14], [36, 17], [39, 23], [34, 25], [26, 26], [17, 25]],
    light: [[11, 20], [14, 16], [18, 14], [23, 13], [27, 14], [23, 15], [19, 17], [17, 20]],
    underside: [[7, 24], [17, 25], [25, 26], [34, 25], [41, 25], [37, 27], [29, 29], [19, 28], [11, 26]],
    rim: [[8, 23], [16, 24], [25, 25], [34, 24], [40, 24], [39, 25], [34, 26], [25, 27], [16, 26], [9, 25]],
  },
];

export function mushroomPixels(appearance: MushroomAppearance): number[][] {
  mushroomSeed(String(appearance.seed));
  if (appearance.version !== 1) throw new RangeError('Unsupported mushroom recipe version.');
  for (const [value, count] of [[appearance.shape, MUSHROOM_SHAPES.length], [appearance.palette, MUSHROOM_PALETTES.length],
    [appearance.size, MUSHROOM_SIZES.length], [appearance.facing, MUSHROOM_FACINGS.length], [appearance.stem, MUSHROOM_STEMS.length]]) {
    if (!Number.isInteger(value) || value < 0 || value >= count) throw new RangeError('Invalid mushroom recipe parameter.');
  }
  const { width, height } = MUSHROOM_PREVIEW_SIZE;
  const source = Array.from({ length: height }, () => Array<number>(width).fill(0));
  const polygon = (points: readonly PixelPoint[], tone: number, lift = 0): void => {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (polygonContains(points, x + 0.5, y + 0.5 + lift)) source[y][x] = tone;
    }
  };
  const lift = appearance.stem * 4;
  const cap = CAPS[appearance.shape];
  polygon([[22, 26 - lift], [27, 26 - lift], [26, 35], [22, 35]], 7);
  polygon([[22, 27 - lift], [26, 27 - lift], [25, 34], [22, 34]], 8);
  polygon([[22, 28 - lift], [24, 28 - lift], [24, 33], [22, 33]], 9);
  polygon(cap.outline, 2, lift);
  polygon(cap.underside, 6, lift);
  // Short radial gills stay inside the underside, rather than forming a dark bar.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (source[y][x] === 6 && (x + Math.abs(y + lift - 27)) % 5 === 0) source[y][x] = 7;
  }
  polygon(cap.crown, 3, lift);
  polygon(cap.light, 4, lift);
  polygon(cap.rim, 3, lift);
  const random = seededRandom(appearance.seed ^ 0x74b0);
  for (let spot = 0; spot < 3; spot++) {
    const x = 15 + Math.floor(random() * 15);
    const y = 14 + Math.floor(random() * 9) - lift;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 3; dx++) {
      if (y + dy >= 0 && y + dy < height && source[y + dy][x + dx] >= 3 && source[y + dy][x + dx] <= 4) {
        if (dy === 0 && dx < 2) source[y + dy][x + dx] = 4;
        else if (dy === 1 && dx === 0 && source[y + dy][x + dx] === 4) source[y + dy][x + dx] = 5;
      }
    }
  }
  const mask = source.map(row => row.map(Boolean));
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    if (!mask[y][x]) continue;
    if (!mask[y + 1][x] && source[y][x] < 6) source[y][x] = 2;
    else if (!mask[y][x + 1] && source[y][x] < 6) source[y][x] = 2;
  }
  if (appearance.shape === 3) {
    polygon([[22, 29 - lift], [27, 29 - lift], [29, 31 - lift], [26, 32 - lift], [21, 31 - lift], [20, 30 - lift]], 8);
    polygon([[21, 29 - lift], [27, 29 - lift], [28, 30 - lift], [23, 31 - lift], [20, 30 - lift]], 9);
    // Veil remnants follow the crown, with smaller flecks near its curved edges.
    for (const [cx, cy, breadth] of [[17, 15, 2], [25, 14, 3], [31, 17, 2], [12, 21, 2],
      [21, 20, 3], [29, 22, 3], [36, 23, 2], [18, 24, 2]] as const) {
      const x = cx + Math.floor(random() * 2);
      const y = cy - lift;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < breadth; dx++) {
        const tone = source[y + dy]?.[x + dx];
        if (tone === 3 || tone === 4 || tone === 5) source[y + dy][x + dx] = dy === 0 ? 10 : 11;
      }
    }
  }
  const scale = [0.55, 0.78, 1][appearance.size];
  return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => {
    const sx = Math.floor(24 + ((appearance.facing ? width - x - 0.5 : x + 0.5) - 24) / scale);
    const sy = Math.floor(35 + (y + 0.5 - 35) / scale);
    return sx >= 0 && sx < width && sy >= 0 && sy < height ? source[sy][sx] : 0;
  }));
}

export function drawMushroomPreview(context: CanvasRenderingContext2D, appearance: MushroomAppearance): void {
  const pixels = mushroomPixels(appearance);
  const tones = ['', '#4d3e3a', ...MUSHROOM_PALETTES[appearance.palette].cap, '#c7ae8b', '#ad9979', '#dcc9a1', '#f3e4bf', '#fff4df', '#ddcdaa'];
  context.clearRect(0, 0, MUSHROOM_PREVIEW_SIZE.width, MUSHROOM_PREVIEW_SIZE.height);
  pixels.forEach((row, y) => row.forEach((tone, x) => {
    if (!tone) return;
    context.fillStyle = tones[tone];
    context.fillRect(x, y, 1, 1);
  }));
}
