import type { BushPhase } from './contracts';
import type { BerryFruit } from './bush-crop';
import { FOLIAGE_PALETTES } from './foliage-palettes';

export const BUSH_PALETTES = FOLIAGE_PALETTES;
export const BERRY_PALETTES = [
  { name: 'Rose', fruit: '#c84962', light: '#f0a18a' },
  { name: 'Blueberry', fruit: '#555b9d', light: '#a4b5e3' },
  { name: 'Golden', fruit: '#bd742c', light: '#f4cf77' },
  { name: 'Blackberry', fruit: '#624475', light: '#bb8cba' },
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

// Authored leaf masses, rather than noise, keep every palette's silhouette readable.
const PREVIEW_FOLIAGE = [
  '                ii',
  '          ii   immi',
  '         immi immlmi',
  '       iimlmimmmllmi ii',
  '      imllmlmmmllmmimlmi',
  '      imlllmmimmmmimllmi',
  '     imllmmissmmimmmllmmi',
  '    iimmmmisssmmmimmmmlmi',
  '   immlmmisssimllmmimmmii',
  '   imllmmisssmmlllmmissmi',
  '  imllmmmissmmllmlmmissmmi',
  '  immmimmmissmmmmmmisssmmi',
  '   immissmmiissmmmisssmmi',
  '  iimissssmmiiissssimmmii',
  ' immlmisssmmmmmiiimmlmmmi',
  ' imllmmissmllmmssmllmlmmmi',
  'imllmlmismlllmmssmllmmmlmi',
  'imlmmmissmllmmisssmmmmmlmmi',
  ' immmisssmmmmmiiisssmmmmmi',
  'iimmissssimmmissssimmmiimii',
  'immmisssssiisssssimmlmmssmmi',
  'immlmmisssssssssimllmmmssmmi',
  'imllmmmiiisssssimllmmmisssmi',
  ' immmmmmmiissssimmmmmiissmi',
  'iimmmmmssmiissssimmmissssmii',
  'immmmsssssmisssssiiissssmmi',
  ' immmissssmmiissssssssmmmi',
  '  immmiisssmmmisssssimmmmi',
  ' iimmmmiisssmmiisssimmmi',
  '  immmmmissssmmiisssmmi',
  '   iimmmiissssmisssmmi',
  '    immmmiisssiissmii',
  '      iimmmiissssmii',
  '        iimmmssmii',
  '          iiiiii',
] as const;

// Layer the same authored leaf bundle into different crowns, with no random edge noise.
const LEAF_BUNDLE = [
  '      ii',
  '    iillii',
  '  iilllllmii',
  ' imllmllmlmmi',
  'imlllmlmmllmmi',
  'imllmmmmllmlmmi',
  ' immmllmmmmmmmi',
  'immmmlmmmmmmssi',
  'immmmmmmssmssmi',
  ' immmssmmssssmi',
  '  imsssmssssmi',
  '   iisssssii',
  '     iiiii',
] as const;

function leafCrown(bundles: readonly (readonly [number, number])[]): readonly string[] {
  const rows = Array.from({ length: BUSH_PREVIEW_SIZE.height }, () => Array<string>(BUSH_PREVIEW_SIZE.width).fill(' '));
  for (const [left, top] of bundles) {
    LEAF_BUNDLE.forEach((row, y) => [...row].forEach((value, x) => {
      if (value !== ' ') rows[top + y][left + x] = value;
    }));
  }
  return rows.map(row => row.join(''));
}

type WoodPixel = readonly [x: number, y: number, width: number, height: number, tone: number];
interface BushShape {
  name: string;
  leaves: readonly string[];
  left: number;
  top: number;
  wood: readonly WoodPixel[];
}

export const BUSH_SHAPES: readonly BushShape[] = [
  {
    name: 'Upright shrub', leaves: PREVIEW_FOLIAGE, left: 6, top: 2,
    wood: [
      [17, 34, 6, 8, 0], [18, 37, 3, 5, 1], [16, 40, 3, 3, 1],
      [14, 42, 4, 2, 1], [21, 40, 3, 4, 1], [24, 42, 2, 2, 1],
      [17, 41, 1, 2, 2], [21, 40, 1, 2, 2],
    ],
  },
  {
    name: 'Spreading bush',
    leaves: leafCrown([[3, 28], [13, 30], [23, 28], [1, 23], [22, 22], [8, 19], [17, 20]]),
    left: 0, top: -3,
    wood: [
      [16, 36, 7, 7, 0], [17, 38, 3, 5, 1], [13, 41, 5, 2, 0],
      [21, 41, 6, 2, 0], [17, 39, 1, 3, 2],
    ],
  },
  {
    name: 'Forked tree',
    leaves: leafCrown([[7, 17], [17, 16], [2, 13], [22, 10], [12, 11], [4, 6], [14, 3]]),
    left: 0, top: 0,
    wood: [
      [17, 25, 6, 17, 0], [18, 27, 3, 14, 1], [18, 31, 1, 7, 2],
      [13, 27, 6, 4, 0], [10, 23, 5, 5, 0],
      [22, 22, 4, 10, 0], [25, 20, 3, 5, 0],
      [22, 25, 2, 6, 1], [16, 40, 7, 3, 0], [14, 42, 4, 2, 0],
      [22, 41, 4, 3, 0], [17, 40, 3, 3, 1], [22, 41, 2, 2, 1],
    ],
  },
];

export function bushLeafAt(appearance: BushAppearance, x: number, y: number): string | undefined {
  const shape = BUSH_SHAPES[appearance.shape];
  if (!shape) throw new RangeError('Unknown bush shape.');
  return shape.leaves[y - shape.top]?.[x - shape.left]?.trim();
}

export function berryPositions(appearance: BushAppearance): { x: number; y: number; maturity: number }[] {
  if (!Number.isInteger(appearance.count) || appearance.count < 3 || appearance.count > 12) {
    throw new RangeError('Berry count must be a whole number from 3 to 12.');
  }
  const shape = BUSH_SHAPES[appearance.shape];
  if (!shape) throw new RangeError('Unknown bush shape.');
  if (!BERRY_LAYOUTS[appearance.layout]) throw new RangeError('Unknown berry placement.');
  const candidates: { x: number; y: number; score: number; maturity: number }[] = [];
  for (let y = 0; y < BUSH_PREVIEW_SIZE.height - 3; y++) {
    for (let x = 1; x < BUSH_PREVIEW_SIZE.width - 3; x++) {
      // The whole fruit footprint must stay inside the authored leaf silhouette.
      if (![[0, 3], [-1, 5], [0, 4], [0, 4]].every(([left, width], dy) => {
        const start = x + left - shape.left;
        const row = shape.leaves[y + dy - shape.top]?.slice(start, start + width);
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
  const colors: Record<string, string> = {
    i: foliage.ink,
    s: foliage.leaf,
    m: foliage.leaf,
    l: foliage.light,
  };
  // Mix a distinct cool middle shadow without adding another customization parameter.
  const shade = (hex: string, ink: string): string => {
    const channel = (offset: number): number => Math.round(
      parseInt(hex.slice(offset, offset + 2), 16) * 0.48 + parseInt(ink.slice(offset, offset + 2), 16) * 0.52,
    );
    return `rgb(${channel(1)}, ${channel(3)}, ${channel(5)})`;
  };
  colors.s = shade(foliage.leaf, foliage.ink);
  context.save();
  context.clearRect(0, 0, BUSH_PREVIEW_SIZE.width, BUSH_PREVIEW_SIZE.height);
  context.imageSmoothingEnabled = false;
  const pixel = (x: number, y: number, width: number, height: number, color: string): void => {
    context.fillStyle = color;
    context.fillRect(x, y, width, height);
  };
  for (const [x, y, width, height, tone] of shape.wood) {
    pixel(x, y, width, height, ['#743e32', '#a35b36', '#c17a43'][tone]);
  }
  for (const [y, row] of shape.leaves.entries()) {
    for (const [x, value] of [...row].entries()) {
      if (value !== ' ') pixel(x + shape.left, y + shape.top, 1, 1, colors[value]);
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
