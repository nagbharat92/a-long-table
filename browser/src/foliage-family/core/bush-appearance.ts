import type { BushPhase } from './contracts';
import type { BerryFruit } from './bush-crop';
import { polygonContains } from './pixel-geometry';
import { LOBE_OUTLINE } from './tree-assets';
export const BUSH_PALETTES = [
  { name: 'Woodland', ink: '#4b5c4d', leaf: '#4b705b', light: '#719363', bud: '#a0b49a' },
  { name: 'Sage', ink: '#626e62', leaf: '#739486', light: '#9bb49a', bud: '#b8c9ae' },
  { name: 'Blue spruce', ink: '#414f59', leaf: '#304d59', light: '#4f7377', bud: '#91aaa8' },
  { name: 'Autumn', ink: '#625c4c', leaf: '#82785f', light: '#a69a77', bud: '#c4b995' },
] as const;
export const BERRY_PALETTES = [
  { name: 'Rose', fruit: '#b56e7c', light: '#d9a0a4' },
  { name: 'Blueberry', fruit: '#69719a', light: '#abb7d1' },
  { name: 'Golden', fruit: '#b4894f', light: '#dabb80' },
  { name: 'Blackberry', fruit: '#6e5c78', light: '#a697ad' },
] as const;
export const BERRY_LAYOUTS = [
  { name: 'Classic', points: [[-4, -5], [0, -7], [3, -4]] },
  { name: 'Crown', points: [[-3, -7], [1, -8], [3, -4]] },
  { name: 'Low branches', points: [[-4, -4], [0, -5], [4, -4]] },
  { name: 'Diagonal', points: [[-3, -4], [0, -6], [3, -7]] },
] as const;

export interface BushAppearance {
  version: 3;
  seed: number;
  shape: number;
  foliage: number;
  berries: number;
  layout: number;
  count: number;
  maturity: number;
}

export const CROP_MATURITIES = ['Young', 'Mixed', 'Ripe'] as const;

function bushHash(seed: number, salt: number): number {
  let value = (seed ^ salt) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
}

function berryNoise(seed: number, x: number, y: number): number {
  const left = Math.floor(x);
  const top = Math.floor(y);
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
  const value = (dx: number, dy: number): number =>
    bushHash(seed, Math.imul(left + dx, 374761393) ^ Math.imul(top + dy, 668265263)) / 4294967295;
  return mix(mix(value(0, 0), value(1, 0), smooth(x - left)),
    mix(value(0, 1), value(1, 1), smooth(x - left)), smooth(y - top));
}

export function bushSeed(value: string): number {
  if (!/^\d{1,10}$/.test(value) || Number(value) > 4294967295) {
    throw new RangeError('Bush seed must be a whole number from 0 to 4294967295.');
  }
  return Number(value);
}

export function generateBush(seed: number): BushAppearance {
  bushSeed(String(seed));
  // Independent streams keep future parameters from reshuffling existing choices.
  const choice = (salt: number, count: number): number => bushHash(seed, salt) % count;
  return {
    version: 3, seed,
    shape: choice(0x60f06, BUSH_SHAPES.length),
    foliage: choice(0x10f01, BUSH_PALETTES.length),
    berries: choice(0x20f02, BERRY_PALETTES.length),
    layout: choice(0x30f03, BERRY_LAYOUTS.length),
    count: 3 + choice(0x40f04, 10),
    maturity: choice(0x50f05, CROP_MATURITIES.length),
  };
}

export const BUSH_PREVIEW_SIZE = { width: 40, height: 48 } as const;

type WoodPixel = readonly [x: number, y: number, width: number, height: number, tone: number];
type Crown = readonly [x: number, y: number, radiusX: number, radiusY: number];
interface BushShape {
  name: string;
  crowns: readonly Crown[];
  wood: readonly WoodPixel[];
}

export const BUSH_SHAPES: readonly BushShape[] = [
  {
    name: 'Upright shrub',
    crowns: [[19, 10, 8, 8], [12, 17, 7, 9], [27, 18, 8, 8], [17, 26, 9, 10], [27, 27, 7, 8]],
    wood: [
      [17, 34, 6, 8, 0], [18, 37, 3, 5, 1], [16, 40, 3, 3, 1],
      [16, 41, 3, 2, 1], [21, 40, 3, 3, 1],
      [17, 41, 1, 2, 2], [21, 40, 1, 2, 2],
    ],
  },
  {
    name: 'Spreading bush',
    crowns: [[9, 28, 8, 7], [18, 24, 9, 8], [29, 27, 8, 7], [19, 33, 12, 7]],
    wood: [
      [17, 36, 5, 7, 0], [18, 38, 2, 5, 1], [15, 41, 3, 2, 0],
      [22, 41, 3, 2, 0], [18, 39, 1, 3, 2],
    ],
  },
  {
    name: 'Forked tree',
    crowns: [[13, 12, 7, 9], [26, 10, 7, 8], [12, 22, 8, 8], [27, 23, 8, 8], [20, 29, 10, 7]],
    wood: [
      [17, 25, 6, 17, 0], [18, 27, 3, 14, 1], [18, 31, 1, 7, 2],
      [13, 27, 6, 4, 0], [10, 23, 5, 5, 0],
      [22, 22, 4, 10, 0], [25, 20, 3, 5, 0],
      [22, 25, 2, 6, 1], [17, 40, 5, 3, 0], [16, 41, 3, 2, 0],
      [22, 41, 3, 2, 0], [18, 40, 2, 3, 1], [22, 41, 2, 2, 1],
    ],
  },
];

const leafCache = new Map<string, readonly string[]>();

function bushLeaves(appearance: BushAppearance): readonly string[] {
  const shape = BUSH_SHAPES[appearance.shape];
  if (!shape) throw new RangeError('Unknown bush shape.');
  const key = `${appearance.seed}:${appearance.shape}`;
  const cached = leafCache.get(key);
  if (cached) return cached;
  const rows = Array.from({ length: BUSH_PREVIEW_SIZE.height }, () => Array<string>(BUSH_PREVIEW_SIZE.width).fill(' '));
  shape.crowns.forEach(([cx, cy, rx, ry], mass) => {
    const outline = LOBE_OUTLINE.map(([x, y], point) => {
      const radius = 0.92 + bushHash(appearance.seed, mass * 37 + point + 1) / 4294967295 * 0.16;
      return [cx + x * rx * radius, cy + y * ry * radius] as const;
    });
    for (let y = Math.max(0, Math.floor(cy - ry - 2)); y < Math.min(BUSH_PREVIEW_SIZE.height, cy + ry + 2); y++) {
      for (let x = Math.max(0, Math.floor(cx - rx - 2)); x < Math.min(BUSH_PREVIEW_SIZE.width, cx + rx + 2); x++) {
        if (!polygonContains(outline, x + 0.5, y + 0.5)) continue;
        const shadeEdge = cy + ry * 0.45 - (x - cx) * 0.22 + Math.sin((x - cx) / rx * 2.8) * ry * 0.12;
        rows[y][x] = y > shadeEdge ? 's' : 'm';
      }
    }
  });
  const leaves = rows.map(row => row.join(''));
  if (leafCache.size >= 32) leafCache.delete(leafCache.keys().next().value!);
  leafCache.set(key, leaves);
  return leaves;
}

export function bushLeafAt(appearance: BushAppearance, x: number, y: number): string | undefined {
  return bushLeaves(appearance)[y]?.[x]?.trim();
}

export function berryPositions(appearance: BushAppearance): { x: number; y: number; maturity: number }[] {
  if (!Number.isInteger(appearance.count) || appearance.count < 3 || appearance.count > 12) {
    throw new RangeError('Berry count must be a whole number from 3 to 12.');
  }
  const shape = BUSH_SHAPES[appearance.shape];
  if (!shape) throw new RangeError('Unknown bush shape.');
  if (!BERRY_LAYOUTS[appearance.layout]) throw new RangeError('Unknown berry placement.');
  const leaves = bushLeaves(appearance);
  const candidates: { x: number; y: number; score: number; maturity: number }[] = [];
  for (let y = 0; y < BUSH_PREVIEW_SIZE.height - 3; y++) {
    for (let x = 1; x < BUSH_PREVIEW_SIZE.width - 3; x++) {
      // The whole fruit footprint must stay inside the authored leaf silhouette.
      if (![[0, 3], [-1, 5], [0, 4], [0, 4]].every(([left, width], dy) => {
        const start = x + left;
        const row = leaves[y + dy]?.slice(start, start + width);
        return start >= 0 && row?.length === width && !row.includes(' ');
      })) continue;
      const field = berryNoise(appearance.seed, x * 0.13, y * 0.13) * 2 - 1;
      const bias = appearance.layout === 1 ? (22 - y) / 35
        : appearance.layout === 2 ? (y - 14) / 35
        : appearance.layout === 3 ? 0.4 - Math.abs(y + x * 0.8 - 36) / 25 : 0;
      candidates.push({ x, y, score: field + bias, maturity: berryNoise(appearance.seed, (x + 170) * 0.21, (y - 93) * 0.21) });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
  const positions: typeof candidates = [];
  for (const candidate of candidates) {
    if (positions.every(point => Math.hypot(candidate.x - point.x, candidate.y - point.y) >= 5)) positions.push(candidate);
    if (positions.length === appearance.count) break;
  }
  if (positions.length !== appearance.count) throw new Error('Could not place the requested berry crop.');
  return positions.map(({ x, y, maturity }) => ({ x, y, maturity }));
}

export function drawBushPreview(context: CanvasRenderingContext2D, phase: BushPhase, appearance: BushAppearance, fruits?: readonly BerryFruit[]): void {
  const foliage = BUSH_PALETTES[appearance.foliage];
  const berry = BERRY_PALETTES[appearance.berries];
  const layout = BERRY_LAYOUTS[appearance.layout];
  const shape = BUSH_SHAPES[appearance.shape];
  if (!foliage || !berry || !layout || !shape) throw new RangeError('Unknown bush appearance option.');
  context.save();
  context.clearRect(0, 0, BUSH_PREVIEW_SIZE.width, BUSH_PREVIEW_SIZE.height);
  context.imageSmoothingEnabled = false;
  const pixel = (x: number, y: number, width: number, height: number, color: string): void => {
    context.fillStyle = color;
    context.fillRect(x, y, width, height);
  };
  for (const [x, y, width, height, tone] of shape.wood) {
    pixel(x, y, width, height, ['#635b4b', '#92816a', '#ad9f88'][tone]);
  }
  for (const [y, row] of bushLeaves(appearance).entries()) {
    for (const [x, value] of [...row].entries()) {
      if (value === ' ') continue;
      pixel(x, y, 1, 1, value === 's' ? foliage.leaf : foliage.light);
    }
  }
  const crop = fruits ?? berryPositions(appearance).map(point => ({ ...point, stage: phase === 'ripe' ? 'ripe' : phase === 'growing' ? 'bud' : 'picked' }));
  for (const fruit of crop) {
    const px = fruit.x;
    const py = fruit.y;
    if (fruit.stage === 'picked') continue;
    if (fruit.stage === 'bud') {
      pixel(px, py + 1, 2, 1, foliage.bud);
    } else {
      pixel(px, py + 1, 4, 3, foliage.ink);
      const color = fruit.stage === 'green' ? foliage.bud : fruit.stage === 'turning' ? berry.light : berry.fruit;
      pixel(px, py, 3, 3, color);
      pixel(px - 1, py + 1, 1, 1, color);
      pixel(px, py, 1, 1, fruit.stage === 'green' ? foliage.light : berry.light);
      if (fruit.stage === 'turning') pixel(px + 1, py + 2, 2, 1, berry.fruit);
      if (fruit.stage === 'sweet') pixel(px + 1, py + 1, 2, 1, berry.light);
    }
  }
  context.restore();
}

export function drawBush(context: CanvasRenderingContext2D, phase: BushPhase, appearance?: BushAppearance): void {
  const foliage = BUSH_PALETTES[appearance?.foliage ?? 0];
  const berry = BERRY_PALETTES[appearance?.berries ?? 0];
  const layout = BERRY_LAYOUTS[appearance?.layout ?? 0];
  if (!foliage || !berry || !layout) throw new RangeError('Unknown bush appearance option.');
  context.save();
  context.clearRect(0, 0, 16, 16);
  context.imageSmoothingEnabled = false;
  context.translate(8, 12);
  const rect = (x: number, y: number, width: number, height: number, color: string): void => {
    context.fillStyle = color;
    context.fillRect(x, y, width, height);
  };
  rect(-1, -3, 2, 4, foliage.ink);
  context.fillStyle = foliage.ink;
  context.beginPath();
  const contour = [
    [-6, -2], [-7, -4], [-7, -6], [-5, -6], [-5, -9], [-2, -9],
    [-2, -11], [2, -11], [2, -9], [5, -9], [5, -7], [7, -7],
    [7, -3], [5, -3], [5, -1], [-3, -1], [-3, -2],
  ];
  contour.forEach(([x, y], index) => index === 0 ? context.moveTo(x, y) : context.lineTo(x, y));
  context.closePath();
  context.fill();
  rect(-5, -6, 10, 3, foliage.leaf);
  rect(-3, -8, 6, 5, foliage.leaf);
  rect(-1, -9, 3, 3, foliage.leaf);
  rect(3, -6, 3, 2, foliage.leaf);
  if (phase !== 'depleted') {
    rect(-3, -8, 3, 2, foliage.light);
    rect(0, -9, 2, 2, foliage.light);
    rect(2, -6, 3, 1, foliage.light);
  }
  if (phase === 'ripe') {
    for (const [x, y] of layout.points) {
      rect(x, y + 1, 2, 2, foliage.ink);
      rect(x, y, 2, 2, berry.fruit);
      rect(x, y, 1, 1, berry.light);
    }
  } else if (phase === 'growing') {
    rect(-3, -5, 1, 1, foliage.bud);
    rect(2, -4, 1, 1, foliage.bud);
  }
  context.restore();
}
