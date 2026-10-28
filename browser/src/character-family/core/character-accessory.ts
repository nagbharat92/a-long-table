import { RIG_HEIGHT, RIG_WIDTH } from './character-rig';

export const CHARACTER_ACCESSORIES = [
  { type: 'none', name: 'None', description: 'Uncovered neck and chest.' },
  { type: 'collar', name: 'Collar', description: 'Wide color band with an oversized diamond-shaped brass tag.' },
  { type: 'bandana', name: 'Bandana', description: 'Full triangular bib with a folded edge and a bold side tie.' },
] as const;

export type CharacterAccessoryType = typeof CHARACTER_ACCESSORIES[number]['type'];

export interface CharacterAccessory {
  type: CharacterAccessoryType;
  color: string;
  colorMode: 'coat' | 'custom';
}

function channels(color: string): number[] {
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Accessory colors must use six-digit hex values.');
  return [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
}

// Each material has a separate silhouette; spaces expose the coat beneath it.
// B: material, H: rolled/lit edge, S: fold/edge shadow, D: hardware rim, G: brass, L: brass glint.
const LEGACY_STAMPS = {
  collar: {
    x: 5, y: 19,
    rows: [
      'SHHHHHHS',
      'SBBDSBBS',
      '   LG   ',
      '  LGGD  ',
      '   DD   ',
    ],
  },
  bandana: {
    x: 5, y: 19,
    rows: [
      ' HHHHHHS ',
      ' SBBBBSS ',
      '  BBBS BS',
      '  SBS   S',
      '   S     ',
    ],
  },
} as const;

const STAMPS = {
  collar: {
    x: 5, y: 19,
    rows: [
      'SHHHHHHHS',
      'SBBBBBBBS',
      ' SBBDBBS ',
      '    L    ',
      '   LGD   ',
      '  LGGGD  ',
      '   DGD   ',
    ],
  },
  bandana: {
    x: 5, y: 19,
    rows: [
      'SHHHHHHS ',
      'SBBBBBBSH',
      ' SBBBBSHB',
      ' SBBBS BS',
      '  SBBS  S',
      '   SS    ',
      '    S    ',
    ],
  },
} as const;

export function renderAccessory(
  source: Uint8ClampedArray, result: Uint8ClampedArray, accessory: CharacterAccessory,
  revision: 1 | 2 = 2,
): void {
  if (source.length !== RIG_WIDTH * RIG_HEIGHT * 4 || result.length !== source.length) {
    throw new Error('Accessories require the original 18 by 29 rabbit.');
  }
  if (!CHARACTER_ACCESSORIES.some(option => option.type === accessory.type)) throw new Error('Unknown character accessory.');
  if (accessory.colorMode !== 'coat' && accessory.colorMode !== 'custom') throw new Error('Unknown accessory color mode.');
  const base = channels(accessory.color);
  if (accessory.type === 'none') return;
  const palette: Record<string, number[]> = {
    B: base,
    H: base.map(value => Math.round(value + (255 - value) * (revision === 1 ? 0.3 : 0.18))),
    S: base.map(value => Math.round(value * 0.65)),
    D: [109, 76, 36],
    G: [211, 166, 79],
    L: [248, 220, 147],
  };
  const stamp = (revision === 1 ? LEGACY_STAMPS : STAMPS)[accessory.type];
  for (const [dy, row] of stamp.rows.entries()) {
    for (const [dx, role] of [...row].entries()) {
      if (role === ' ') continue;
      const i = ((stamp.y + dy) * RIG_WIDTH + stamp.x + dx) * 4;
      // Neckwear sits inside the original contour, never repainting outline or limbs.
      if (!source[i + 3] || (source[i] === 0 && source[i + 1] === 0 && source[i + 2] === 0)) continue;
      result.set(palette[role], i);
    }
  }
}
