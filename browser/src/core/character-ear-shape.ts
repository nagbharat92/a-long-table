import { RIG_HEIGHT, RIG_WIDTH } from './character-rig';

export const CHARACTER_EAR_SHAPES = [
  { type: 'upright', name: 'Upright' },
  { type: 'bent', name: 'Softly bent' },
  { type: 'one-floppy', name: 'One floppy' },
  { type: 'both-floppy', name: 'Both floppy' },
] as const;

export type CharacterEarShape = typeof CHARACTER_EAR_SHAPES[number]['type'];

// Lowercase is the outer fill column, uppercase the inner. A-E run tip to root.
const EAR_DRAWINGS = {
  upright: [
    '.....##..',
    '....#aA#.',
    '....#bB#.',
    '....#cC#.',
    '....#dD#.',
    '....#eE#.',
  ],
  bent: [
    '...##....',
    '..#aA#...',
    '...#bB#..',
    '....#cC#.',
    '....#dD#.',
    '....#eE#.',
  ],
  floppy: [
    '...####..',
    '..#cCdD#.',
    '.#bB#eE#.',
    '#bB##eE#.',
    '#aA##eE#.',
    '.##.#eE#.',
  ],
} as const;

export function reshapeRabbitEars(source: Uint8ClampedArray, shape: CharacterEarShape = 'upright'): Uint8ClampedArray {
  if (source.length !== RIG_WIDTH * RIG_HEIGHT * 4) throw new Error('Ear shapes require the original 18 by 29 rabbit.');
  if (!CHARACTER_EAR_SHAPES.some(option => option.type === shape)) throw new Error('Unknown ear shape.');
  const result = source.slice();
  if (shape === 'upright') return result;
  result.fill(0, 0, 6 * RIG_WIDTH * 4);
  for (const side of ['left', 'right'] as const) {
    const drawing = shape === 'bent' ? EAR_DRAWINGS.bent
      : shape === 'one-floppy' && side === 'left' ? EAR_DRAWINGS.upright : EAR_DRAWINGS.floppy;
    for (const [y, row] of drawing.entries()) {
      for (let x = 0; x < row.length; x++) {
        const cell = row[x];
        if (cell === '.') continue;
        const target = (y * RIG_WIDTH + (side === 'left' ? x : RIG_WIDTH - 1 - x)) * 4;
        if (cell === '#') {
          result.set([0, 0, 0, 255], target);
          continue;
        }
        const sourceY = cell.toLowerCase().charCodeAt(0) - 96;
        const inner = cell === cell.toUpperCase();
        const sourceX = side === 'left' ? (inner ? 6 : 5) : (inner ? 11 : 12);
        const index = (sourceY * RIG_WIDTH + sourceX) * 4;
        result.set(source.subarray(index, index + 4), target);
      }
    }
  }
  return result;
}
