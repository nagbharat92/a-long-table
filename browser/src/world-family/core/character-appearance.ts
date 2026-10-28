import { RIG_HEIGHT, RIG_WIDTH, type CharacterSpecies } from './character-rig';
import { renderAccessory, type CharacterAccessory } from './character-accessory';
import { CHARACTER_EAR_SHAPES, reshapeRabbitEars, type CharacterEarShape } from './character-ear-shape';
import {
  CHARACTER_EXPRESSIONS, expressionSource, renderExpression, type CharacterExpression,
} from './character-expression';

export interface CharacterColors {
  coat: string;
  shade: string;
}

export const CHARACTER_PATTERNS = [
  { type: 'solid', name: 'Solid' },
] as const;

// Retired patterns remain renderable for previously downloaded recipes.
const LEGACY_PATTERNS = ['cheeks', 'face', 'body', 'mixed', 'two-tone'] as const;
export type CharacterPatternType = typeof CHARACTER_PATTERNS[number]['type'] | typeof LEGACY_PATTERNS[number];

function isCharacterPattern(type: CharacterPatternType): boolean {
  return CHARACTER_PATTERNS.some(option => option.type === type) || LEGACY_PATTERNS.some(option => option === type);
}

export interface CharacterPattern {
  type: CharacterPatternType;
  color: string;
  colorMode?: 'coat' | 'custom';
  seed: number;
}

export const CHARACTER_EAR_MARKINGS = [
  { type: 'plain', name: 'Plain' },
  { type: 'tips', name: 'Tips' },
  { type: 'single', name: 'One marked ear' },
  { type: 'both', name: 'Both marked' },
  { type: 'inner', name: 'Inner ears' },
] as const;

export type CharacterEarType = typeof CHARACTER_EAR_MARKINGS[number]['type'];

export interface CharacterEars {
  type: CharacterEarType;
  shape?: CharacterEarShape;
  color: string;
  colorMode: 'coat' | 'custom';
}

export const CHARACTER_COLOR_PALETTES = [
  { name: 'Snow', coat: '#f7f9f9', shade: '#d3d6e5' },
  { name: 'Cream', coat: '#f6ecd8', shade: '#ddcbb0' },
  { name: 'Biscuit', coat: '#edd5b8', shade: '#ceb394' },
  { name: 'Peach', coat: '#f5d2bc', shade: '#d8b09e' },
  { name: 'Rose', coat: '#f1d0dc', shade: '#d4aebf' },
  { name: 'Lavender', coat: '#dfd6f1', shade: '#bfb0d8' },
  { name: 'Sky', coat: '#d0e5f3', shade: '#abc7dc' },
  { name: 'Mint', coat: '#d4ebdf', shade: '#aed0be' },
] as const satisfies readonly (CharacterColors & { name: string })[];

export interface CharacterAppearance {
  version: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  species?: CharacterSpecies;
  seed: number;
  parameters: { color: CharacterColors; pattern: CharacterPattern; ears?: CharacterEars; expression?: CharacterExpression; accessory?: CharacterAccessory };
}

export interface GeneratedCharacterAppearance extends CharacterAppearance {
  parameters: { color: CharacterColors; pattern: CharacterPattern; ears: CharacterEars; expression: CharacterExpression; accessory: CharacterAccessory };
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

function hex(channels: number[]): string {
  return `#${channels.map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

export function generateAppearance(seed: number): GeneratedCharacterAppearance {
  appearanceSeed(String(seed));
  // Each parameter gets its own stream, so later parameters cannot change existing colors.
  const random = randomParameter(seed, 'color:soft-v2');
  const palette = CHARACTER_COLOR_PALETTES[Math.floor(random() * CHARACTER_COLOR_PALETTES.length)];
  const coatOffset = Math.floor(random() * 9) - 4;
  const shadeOffset = Math.floor(random() * 7) - 3;
  const color = {
    coat: hex(rgb(palette.coat).map(value => value + coatOffset)),
    shade: hex(rgb(palette.shade).map(value => value + shadeOffset)),
  };
  const pattern = generatePattern(seed, color);
  return {
    version: 8, seed,
    parameters: {
      color, pattern, ears: generateEars(seed, color, pattern), expression: generateExpression(seed),
      accessory: generateAccessory(seed, color, pattern),
    },
  };
}

export function linkedAccessoryColor(colors: CharacterColors, revision: 1 | 2 = 2): string {
  const coat = rgb(colors.coat);
  const accents = revision === 1
    ? ['#b75b4b', '#55756a', '#49777b', '#536d9b', '#587866', '#a47737', '#b7654d', '#99617b']
    : ['#eb493b', '#3865de', '#008f88', '#4e55d9', '#008d76', '#ed7626', '#e96328', '#d63878'];
  let closest = 0, distance = Infinity;
  for (const [index, palette] of CHARACTER_COLOR_PALETTES.entries()) {
    const candidate = rgb(palette.coat).reduce((sum, value, channel) => sum + (value - coat[channel]) ** 2, 0);
    if (candidate < distance) { closest = index; distance = candidate; }
  }
  return accents[closest];
}

export function generateAccessory(seed: number, colors: CharacterColors, pattern: CharacterPattern): CharacterAccessory {
  appearanceSeed(String(seed));
  if (!isCharacterPattern(pattern.type)) throw new Error('Unknown character pattern.');
  const choices = ['none', 'collar', 'bandana'] as const;
  const type = pattern.type === 'solid'
    ? choices[Math.floor(randomParameter(seed, 'accessory:v1')() * choices.length)] : 'none';
  return { type, color: linkedAccessoryColor(colors), colorMode: 'coat' };
}

export function generateExpression(seed: number): CharacterExpression {
  appearanceSeed(String(seed));
  const type = CHARACTER_EXPRESSIONS[Math.floor(randomParameter(seed, 'expression:v1')() * CHARACTER_EXPRESSIONS.length)].type;
  return { type };
}

export function generatePattern(seed: number, colors: CharacterColors): CharacterPattern {
  appearanceSeed(String(seed));
  const random = randomParameter(seed, 'pattern:cheeks-v2');
  const type = CHARACTER_PATTERNS[Math.floor(random() * CHARACTER_PATTERNS.length)].type;
  return { type, color: linkedPatternColor(colors, type), colorMode: 'coat', seed: Math.floor(random() * 0x100000000) };
}

export function generateEars(seed: number, colors: CharacterColors, pattern: CharacterPattern): CharacterEars {
  appearanceSeed(String(seed));
  // Busy coats leave the ears mostly clear; simple coats can carry a larger accent.
  const choices: Record<CharacterPatternType, readonly CharacterEarType[]> = {
    solid: ['plain', 'tips', 'single', 'both', 'inner'],
    cheeks: ['plain', 'tips', 'single', 'both', 'inner'],
    face: ['plain', 'tips', 'single', 'inner'],
    body: ['plain', 'tips', 'single', 'both', 'inner'],
    mixed: ['plain', 'tips', 'inner'],
    'two-tone': ['plain', 'tips', 'inner'],
  };
  const options = choices[pattern.type];
  if (!options) throw new Error('Unknown character pattern.');
  const type = options[Math.floor(randomParameter(seed, 'ears:v1')() * options.length)];
  const shape = CHARACTER_EAR_SHAPES[Math.floor(randomParameter(seed, 'ear-shape:v1')() * CHARACTER_EAR_SHAPES.length)].type;
  return { type, shape, color: linkedEarColor(colors, type), colorMode: 'coat' };
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
  return hex(patch);
}

export function linkedEarColor(colors: CharacterColors, type: CharacterEarType): string {
  if (type !== 'inner') return linkedPatchColor(colors);
  const rose = [207, 139, 157];
  return hex(rgb(colors.coat).map((value, index) => Math.round(value * 0.35 + rose[index] * 0.65)));
}

export function linkedPatternColor(colors: CharacterColors, type: CharacterPatternType): string {
  if (type !== 'cheeks' && type !== 'solid') return linkedPatchColor(colors);
  const rose = [232, 137, 153];
  return hex(rgb(colors.coat).map((value, index) => Math.round(value * 0.25 + rose[index] * 0.75)));
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
  if (pattern.type === 'cheeks') return 'Two small cheek circles.';
  if (pattern.type === 'two-tone') return 'Muzzle + belly';
  const [face, body] = MARKING_LAYOUTS[pattern.seed % MARKING_LAYOUTS.length].name.split(' / ');
  return pattern.type === 'face' ? face : pattern.type === 'body' ? body : `${face} / ${body}`;
}

export function balancedEarSide(pattern: CharacterPattern): 'left' | 'right' {
  const layout = MARKING_LAYOUTS[pattern.seed % MARKING_LAYOUTS.length];
  if (pattern.type === 'face' || pattern.type === 'mixed') return layout.face[0].x < RIG_WIDTH / 2 ? 'right' : 'left';
  if (pattern.type === 'body') return layout.body[0].x < RIG_WIDTH / 2 ? 'right' : 'left';
  return 'left';
}

export function earLayoutName(ears: CharacterEars, pattern: CharacterPattern): string {
  switch (ears.type) {
    case 'plain': return 'Coat color, no ear markings.';
    case 'tips': return 'Matching tips, same depth.';
    case 'both': return 'Matching full-ear markings.';
    case 'inner': return 'Inset stripes with coat visible at each end.';
    case 'single': {
      const side = balancedEarSide(pattern) === 'left' ? 'Left' : 'Right';
      if (pattern.type === 'face' || pattern.type === 'mixed') return `${side} ear balances the face marking.`;
      if (pattern.type === 'body') return `${side} ear balances the main body patch.`;
      return 'Left ear accent on a balanced coat.';
    }
  }
}

function renderEarMarkings(
  source: Uint8ClampedArray, result: Uint8ClampedArray, ears: CharacterEars,
  colors: CharacterColors, pattern: CharacterPattern,
): void {
  if (!CHARACTER_EAR_MARKINGS.some(option => option.type === ears.type)) throw new Error('Unknown ear marking.');
  if (ears.colorMode !== 'coat' && ears.colorMode !== 'custom') throw new Error('Unknown ear color mode.');
  const accent = rgb(ears.colorMode === 'coat' ? linkedEarColor(colors, ears.type) : ears.color);
  if (ears.type === 'plain') return;
  const side = balancedEarSide(pattern);
  // The actual sprite has two fill columns per ear, between its black outlines.
  for (const ear of [{ side: 'left', x: 5 }, { side: 'right', x: 11 }] as const) {
    if (ears.type === 'single' && ear.side !== side) continue;
    for (let y = 1; y <= 5; y++) {
      for (let x = ear.x; x <= ear.x + 1; x++) {
        if (ears.type === 'tips' && y > 2) continue;
        if (ears.type === 'inner' && (y < 2 || y > 4 || x !== ear.x + (ear.side === 'left' ? 1 : 0))) continue;
        const i = (y * RIG_WIDTH + x) * 4;
        if (!source[i + 3] || (source[i] === 0 && source[i + 1] === 0 && source[i + 2] === 0)) continue;
        const shade = (source[i] + source[i + 1] + source[i + 2]) / 3 > 225 ? 1 : 0.76;
        result.set(accent.map(channel => Math.round(channel * shade)), i);
      }
    }
  }
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

export function renderAppearance(original: Uint8ClampedArray, appearance: CharacterAppearance): Uint8ClampedArray {
  const expression = appearance.version >= 5 ? appearance.parameters.expression : undefined;
  if (appearance.version >= 5 && !expression) throw new Error('Version 5 and newer character recipes require an expression.');
  const source = expression ? expressionSource(original, expression) : original;
  const result = recolorRabbit(source, appearance.parameters.color);
  const finish = (): Uint8ClampedArray => {
    if (expression) renderExpression(source, result, expression, appearance.version === 5 ? 1 : 2);
    if (appearance.version >= 7) {
      const accessory = appearance.parameters.accessory;
      if (!accessory) throw new Error('Version 7 and newer character recipes require accessory settings.');
      renderAccessory(source, result, {
        ...accessory,
        color: accessory.colorMode === 'coat'
          ? linkedAccessoryColor(appearance.parameters.color, appearance.version === 7 ? 1 : 2) : accessory.color,
      }, appearance.version === 7 ? 1 : 2);
    }
    const shape = appearance.version >= 4 ? appearance.parameters.ears?.shape : undefined;
    return reshapeRabbitEars(result, shape);
  };
  const pattern = appearance.parameters.pattern;
  if (!isCharacterPattern(pattern.type)) throw new Error('Unknown character pattern.');
  appearanceSeed(String(pattern.seed));
  const patch = rgb(pattern.colorMode === 'coat' ? linkedPatternColor(appearance.parameters.color, pattern.type) : pattern.color);
  if (appearance.version >= 4) {
    const ears = appearance.parameters.ears;
    if (!ears) throw new Error('Version 4 and newer character recipes require ear settings.');
    renderEarMarkings(source, result, ears, appearance.parameters.color, pattern);
  }
  if (pattern.type === 'solid') return finish();
  if (pattern.type === 'cheeks') {
    for (const center of [3, 12]) {
      for (const [dx, dy] of [[0, -1], [-1, 0], [0, 0], [1, 0], [0, 1]]) {
        const i = ((16 + dy) * RIG_WIDTH + center + dx) * 4;
        if (!source[i + 3] || (source[i] === 0 && source[i + 1] === 0 && source[i + 2] === 0)) continue;
        result.set(patch, i);
      }
    }
    return finish();
  }
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
      const clearMuzzle = appearance.version !== 2 &&
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
  return finish();
}
