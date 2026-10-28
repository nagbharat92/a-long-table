import { RIG_HEIGHT, RIG_WIDTH } from './character-rig';

export interface CharacterColors {
  coat: string;
  shade: string;
}

export const CHARACTER_PATTERNS = [
  { type: 'solid', name: 'Solid' },
  { type: 'face', name: 'Face patches' },
  { type: 'body', name: 'Body patches' },
  { type: 'mixed', name: 'Face + body' },
  { type: 'two-tone', name: 'Two-tone' },
] as const;

export type CharacterPatternType = typeof CHARACTER_PATTERNS[number]['type'];

export interface CharacterPattern {
  type: CharacterPatternType;
  color: string;
  colorMode?: 'coat' | 'custom';
  seed: number;
}

export const CHARACTER_COLOR_PALETTES = [
  { name: 'Snow', coat: '#f7f9f9', shade: '#cacde1' },
  { name: 'Cream', coat: '#f2e6cd', shade: '#c7ae8b' },
  { name: 'Biscuit', coat: '#dcb58a', shade: '#aa7b59' },
  { name: 'Cocoa', coat: '#a77b65', shade: '#755348' },
  { name: 'Ash', coat: '#b8bec8', shade: '#858a9b' },
  { name: 'Charcoal', coat: '#737780', shade: '#4d505d' },
  { name: 'Peach', coat: '#efbd9e', shade: '#c48c78' },
  { name: 'Rose', coat: '#e8b3c2', shade: '#bc819c' },
  { name: 'Lavender', coat: '#c4b5e5', shade: '#9482bc' },
  { name: 'Sky', coat: '#aecde7', shade: '#7b9fbe' },
  { name: 'Mint', coat: '#b6dfcf', shade: '#80b3a5' },
  { name: 'Sage', coat: '#becba6', shade: '#8c9f79' },
] as const satisfies readonly (CharacterColors & { name: string })[];

export interface CharacterAppearance {
  version: 2 | 3;
  seed: number;
  parameters: { color: CharacterColors; pattern: CharacterPattern };
}

export const APPEARANCE_BATCH_SIZE = 12;

export function appearanceSeed(value: string): number {
  if (!/^\d{1,10}$/.test(value) || Number(value) > 0xffffffff) {
    throw new RangeError('Character seed must be a whole number from 0 to 4294967295.');
  }
  return Number(value);
}

function randomParameter(seed: number, key: string): () => number {
  let state = seed;
  for (const char of key) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hsl(hue: number, saturation: number, lightness: number): string {
  const a = saturation * Math.min(lightness, 1 - lightness);
  const channel = (offset: number): string => {
    const k = (offset + hue / 30) % 12;
    return Math.round(255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
      .toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

export function generateAppearance(seed: number): CharacterAppearance {
  appearanceSeed(String(seed));
  // Each parameter gets its own stream, so later parameters cannot change existing colors.
  const random = randomParameter(seed, 'color:v1');
  const hue = Math.floor(random() * 360);
  const saturation = 0.18 + random() * 0.42;
  const lightness = 0.48 + random() * 0.43;
  const color = {
    coat: hsl(hue, saturation, lightness),
    shade: hsl((hue + 12) % 360, saturation * 0.85, lightness - 0.16),
  };
  return {
    version: 3, seed,
    parameters: { color, pattern: generatePattern(seed, color) },
  };
}

export function generatePattern(seed: number, colors: CharacterColors): CharacterPattern {
  appearanceSeed(String(seed));
  const random = randomParameter(seed, 'pattern:v1');
  const type = CHARACTER_PATTERNS[Math.floor(random() * CHARACTER_PATTERNS.length)].type;
  return { type, color: linkedPatchColor(colors), colorMode: 'coat', seed: Math.floor(random() * 0x100000000) };
}

export function generateAppearanceBatch(seed: number): CharacterAppearance[] {
  appearanceSeed(String(seed));
  const batch: CharacterAppearance[] = [];
  const seen = new Set<string>();
  for (let attempt = 0; batch.length < APPEARANCE_BATCH_SIZE && attempt < 1024; attempt++) {
    const appearance = generateAppearance((seed + Math.imul(attempt, 0x9e3779b1)) >>> 0);
    const key = appearance.parameters.color.coat;
    if (seen.has(key)) continue;
    seen.add(key);
    batch.push(appearance);
  }
  if (batch.length !== APPEARANCE_BATCH_SIZE) throw new Error('Could not generate 12 distinct coats. Try a different color seed.');
  return batch;
}

function rgb(hex: string): number[] {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error('Character colors must use six-digit hex values.');
  return [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16));
}

function luminance(channels: number[]): number {
  const linear = channels.map(value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

export function linkedPatchColor(colors: CharacterColors): string {
  const coat = rgb(colors.coat);
  const bases = [luminance(coat), luminance(rgb(colors.shade))];
  const separation = (channels: number[]): number => {
    const lights = [luminance(channels), luminance(channels.map(value => Math.round(value * 0.76)))];
    return Math.min(...lights.flatMap(light =>
      bases.map(base => (Math.max(base, light) + 0.05) / (Math.min(base, light) + 0.05))));
  };
  const dark = [24, 20, 28], light = [255, 249, 239];
  const target = separation(dark) > separation(light) ? dark : light;
  let patch = target;
  for (let step = 1; step <= 20; step++) {
    patch = coat.map((value, index) => Math.round(value + (target[index] - value) * step / 20));
    if (separation(patch) >= 2) break;
  }
  return `#${patch.map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

interface Spot { x: number; y: number; rx: number; ry: number }
interface MarkingLayout { name: string; face: readonly Spot[]; body: readonly Spot[] }

// Coordinates are authored on the 18 x 29 sprite, not jittered at render time.
const MARKING_LAYOUTS: readonly MarkingLayout[] = [
  { name: 'Left eye / right flank',
    face: [{ x: 3, y: 12, rx: 2.5, ry: 3 }],
    body: [{ x: 11, y: 21, rx: 1.5, ry: 2 }, { x: 6, y: 24, rx: 1, ry: 1 }] },
  { name: 'Right eye / left flank',
    face: [{ x: 12, y: 12, rx: 2.5, ry: 3 }],
    body: [{ x: 6, y: 21, rx: 1.5, ry: 2 }, { x: 11, y: 24, rx: 1, ry: 1 }] },
  { name: 'Left cheek / right hip',
    face: [{ x: 3, y: 14, rx: 2, ry: 2 }],
    body: [{ x: 11, y: 24, rx: 1.5, ry: 1.5 }, { x: 6, y: 20, rx: 1, ry: 1 }] },
  { name: 'Right cheek / left hip',
    face: [{ x: 14, y: 14, rx: 2, ry: 2 }],
    body: [{ x: 6, y: 24, rx: 1.5, ry: 1.5 }, { x: 11, y: 20, rx: 1, ry: 1 }] },
];

export function patternLayoutName(pattern: CharacterPattern): string {
  if (pattern.type === 'solid') return 'Unmarked coat';
  if (pattern.type === 'two-tone') return 'Muzzle + belly';
  const [face, body] = MARKING_LAYOUTS[pattern.seed % MARKING_LAYOUTS.length].name.split(' / ');
  return pattern.type === 'face' ? face : pattern.type === 'body' ? body : `${face} / ${body}`;
}

export function recolorRabbit(source: Uint8ClampedArray, colors: CharacterColors): Uint8ClampedArray {
  if (source.length !== RIG_WIDTH * RIG_HEIGHT * 4) throw new Error('Color exploration requires the original 18 by 29 rabbit.');
  const coat = rgb(colors.coat), shade = rgb(colors.shade);
  const result = source.slice();
  for (let i = 0; i < source.length; i += 4) {
    if (source[i + 3] === 0 || (source[i] === 0 && source[i + 1] === 0 && source[i + 2] === 0)) continue;
    const color = (source[i] + source[i + 1] + source[i + 2]) / 3 > 225 ? coat : shade;
    result.set(color, i);
  }
  return result;
}

export function renderAppearance(source: Uint8ClampedArray, appearance: CharacterAppearance): Uint8ClampedArray {
  const result = recolorRabbit(source, appearance.parameters.color);
  const pattern = appearance.parameters.pattern;
  if (!CHARACTER_PATTERNS.some(option => option.type === pattern.type)) throw new Error('Unknown character pattern.');
  appearanceSeed(String(pattern.seed));
  const patch = rgb(pattern.colorMode === 'coat' ? linkedPatchColor(appearance.parameters.color) : pattern.color);
  if (pattern.type === 'solid') return result;
  const random = randomParameter(pattern.seed, 'patch-placement:v1');
  const left = random() < 0.5;
  const face = {
    x: (left ? 4 : 13) + random() * 1.5 - 0.75,
    y: 11 + random() * 3, rx: 2.5 + random(), ry: 2.5 + random(),
  };
  const body = [
    { x: 6 + random() * 2, y: 20 + random() * 2, rx: 2 + random(), ry: 1.5 + random() },
    { x: 10 + random() * 2, y: 23 + random(), rx: 1.5 + random(), ry: 1.5 + random() },
  ];
  const layout = MARKING_LAYOUTS[pattern.seed % MARKING_LAYOUTS.length];
  const faceSpots = appearance.version === 2 ? [face] : layout.face;
  const bodySpots = appearance.version === 2 ? body : layout.body;
  const inside = (x: number, y: number, spot: typeof face): boolean =>
    ((x - spot.x) / spot.rx) ** 2 + ((y - spot.y) / spot.ry) ** 2 <= 1;
  for (let y = 7; y <= 25; y++) {
    for (let x = 0; x < RIG_WIDTH; x++) {
      const i = (y * RIG_WIDTH + x) * 4;
      if (!source[i + 3] || (source[i] === 0 && source[i + 1] === 0 && source[i + 2] === 0)) continue;
      const onFace = y <= 17;
      const onBody = y >= 19 && x >= 5 && x <= 12;
      const clearMuzzle = appearance.version === 3 &&
        ((x >= 7 && x <= 10 && y >= 13 && y <= 16) || (x >= 5 && x <= 7 && y >= 15 && y <= 16));
      const marked = pattern.type === 'two-tone'
        ? (onFace && inside(x, y, { x: 7.5, y: 15.5, rx: 4.3, ry: 2.3 })) ||
          (onBody && inside(x, y, { x: 9, y: 22.5, rx: 3.2, ry: 3.3 }))
        : ((pattern.type === 'face' || pattern.type === 'mixed') && onFace && !clearMuzzle && faceSpots.some(spot => inside(x, y, spot))) ||
          ((pattern.type === 'body' || pattern.type === 'mixed') && onBody && bodySpots.some(spot => inside(x, y, spot)));
      if (!marked) continue;
      const shade = (source[i] + source[i + 1] + source[i + 2]) / 3 > 225 ? 1 : 0.76;
      result.set(patch.map(channel => Math.round(channel * shade)), i);
    }
  }
  return result;
}
