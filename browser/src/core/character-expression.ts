import { RABBIT_FACE, type FaceFeature } from './character-face';
import { RIG_HEIGHT, RIG_WIDTH } from './character-rig';
import type { Point } from './contracts';

export const CHARACTER_EXPRESSIONS = [
  { type: 'neutral', name: 'Neutral', description: 'Original open eyes.' },
  { type: 'happy', name: 'Happy', description: 'Full, lifted crescents with squeezed lids.' },
  { type: 'sleepy', name: 'Sleepy', description: 'Heavy lids, narrow openings, lowered pupils.' },
  { type: 'curious', name: 'Curious', description: 'One wide eye, one narrowed eye, a raised brow.' },
] as const;

export type CharacterExpressionType = typeof CHARACTER_EXPRESSIONS[number]['type'];
export interface CharacterExpression { type: CharacterExpressionType }

const LEGACY_EYE_DRAWINGS: Record<CharacterExpressionType, readonly (readonly Point[])[]> = {
  neutral: [[{ x: 0, y: 0 }, { x: 0, y: 1 }], [{ x: 0, y: 0 }, { x: 0, y: 1 }]],
  happy: [[{ x: 0, y: 1 }, { x: 1, y: 0 }, { x: 2, y: 1 }], [{ x: -1, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 1 }]],
  sleepy: [[{ x: 0, y: 1 }, { x: 1, y: 1 }], [{ x: -1, y: 1 }, { x: 0, y: 1 }]],
  curious: [[{ x: 0, y: -1 }, { x: 0, y: 0 }], [{ x: 0, y: 0 }, { x: 0, y: 1 }]],
};

interface ExpressionStamp { x: number; y: number; rows: readonly string[] }

// Dots retain the underlying coat/patch; w is the warm eye opening or catchlight.
const EXPRESSION_DRAWINGS: Record<CharacterExpressionType, readonly ExpressionStamp[]> = {
  neutral: [],
  happy: [
    { x: 2, y: 12, rows: ['.#.', '###', '#.#'] },
    { x: 10, y: 12, rows: ['.#.', '###', '#.#'] },
  ],
  sleepy: [
    { x: 2, y: 12, rows: ['####', '.w#.', '.##.'] },
    { x: 10, y: 12, rows: ['####', '.w#.', '.##.'] },
  ],
  curious: [
    { x: 2, y: 11, rows: ['.#.', '#w#', '###', '.#.'] },
    { x: 10, y: 12, rows: ['###', 'w##', '.#.'] },
    { x: 3, y: 9, rows: ['##'] },
  ],
};

function validateExpression(expression: CharacterExpression): void {
  if (!CHARACTER_EXPRESSIONS.some(option => option.type === expression.type)) throw new Error('Unknown character expression.');
}

export function expressionFeatures(expression: CharacterExpression): readonly FaceFeature[] {
  validateExpression(expression);
  if (expression.type === 'neutral') return RABBIT_FACE;
  const stamps = EXPRESSION_DRAWINGS[expression.type];
  return [
    ...(['left-eye', 'right-eye'] as const).map((id, index) => ({
      id, pivot: { x: stamps[index].x + 1.5, y: 13.5 },
      regions: stamps.filter((_, position) => position === index || (index === 0 && position === 2)).map(stamp => ({
        x: stamp.x, y: stamp.y, width: stamp.rows[0].length, height: stamp.rows.length,
      })),
    })),
    RABBIT_FACE[2],
  ];
}

export function renderExpressionBlink(result: Uint8ClampedArray, expression: CharacterExpression): void {
  validateExpression(expression);
  if (result.length !== RIG_WIDTH * RIG_HEIGHT * 4) throw new Error('Blink expressions require 18 by 29 artwork.');
  const features = expressionFeatures(expression);
  for (const feature of features.filter(feature => feature.id !== 'nose')) {
    const region = feature.regions[0];
    const y = expression.type === 'neutral' ? 14 : 13;
    for (let x = region.x; x < region.x + region.width; x++) {
      result.set([0, 0, 0, 255], (y * RIG_WIDTH + x) * 4);
    }
  }
  if (expression.type === 'curious') {
    for (const x of [3, 4]) result.set([0, 0, 0, 255], (9 * RIG_WIDTH + x) * 4);
  }
}

export function expressionSource(source: Uint8ClampedArray, expression: CharacterExpression): Uint8ClampedArray {
  validateExpression(expression);
  if (source.length !== RIG_WIDTH * RIG_HEIGHT * 4) throw new Error('Expressions require the original 18 by 29 rabbit.');
  if (expression.type === 'neutral') return source;
  const result = source.slice();
  const fill = source.slice((10 * RIG_WIDTH + 7) * 4, (10 * RIG_WIDTH + 7) * 4 + 3);
  // Remove only registered eye ink before coloring, so patches continue beneath new eyes.
  for (const feature of RABBIT_FACE.filter(feature => feature.id !== 'nose')) {
    for (const region of feature.regions) {
      for (let y = region.y; y < region.y + region.height; y++) {
        for (let x = region.x; x < region.x + region.width; x++) {
          const index = (y * RIG_WIDTH + x) * 4;
          if (source[index + 3] && source[index] === 0 && source[index + 1] === 0 && source[index + 2] === 0) {
            if (source[(10 * RIG_WIDTH + 7) * 4 + 3] !== 255) throw new Error('The expression coat sample must be opaque.');
            result.set(fill, index);
          }
        }
      }
    }
  }
  return result;
}

export function renderExpression(
  source: Uint8ClampedArray, result: Uint8ClampedArray, expression: CharacterExpression,
  revision: 1 | 2 = 2,
): Uint8ClampedArray {
  validateExpression(expression);
  if (source.length !== RIG_WIDTH * RIG_HEIGHT * 4 || result.length !== source.length) {
    throw new Error('Expressions require matching 18 by 29 rabbit artwork.');
  }
  if (expression.type === 'neutral') return result;
  if (revision === 2) {
    for (const stamp of EXPRESSION_DRAWINGS[expression.type]) {
      for (const [y, row] of stamp.rows.entries()) {
        for (let x = 0; x < row.length; x++) {
          if (row[x] === '.') continue;
          const offset = ((stamp.y + y) * RIG_WIDTH + stamp.x + x) * 4;
          if (source[offset + 3]) result.set(row[x] === 'w' ? [255, 249, 237] : [0, 0, 0], offset);
        }
      }
    }
    return result;
  }
  const eyes = RABBIT_FACE.filter(feature => feature.id !== 'nose');
  for (const [index, eye] of eyes.entries()) {
    const anchor = eye.regions[0];
    for (const point of LEGACY_EYE_DRAWINGS[expression.type][index]) {
      const offset = ((anchor.y + point.y) * RIG_WIDTH + anchor.x + point.x) * 4;
      if (source[offset + 3]) result.set([0, 0, 0], offset);
    }
  }
  return result;
}
