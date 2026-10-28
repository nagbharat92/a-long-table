import { describe, expect, it } from 'vitest';
import {
  CHARACTER_EXPRESSIONS, expressionSource, renderExpression, type CharacterExpressionType,
} from '../src/core/character-expression';
import {
  CHARACTER_COLOR_PALETTES, CHARACTER_EAR_MARKINGS, CHARACTER_PATTERNS,
  generateAppearance, generateEars, generateExpression, generatePattern, renderAppearance, type CharacterAppearance,
} from '../src/core/character-appearance';
import { RIG_HEIGHT, RIG_WIDTH } from '../src/core/character-rig';

function sourceFixture(): Uint8ClampedArray {
  const rows = [
    '.....##....##.....', '....#oo#..#oo#....', '....#oo#..#oo#....',
    '....#oo#..#oo#....', '....#oo#..#oo#....', '....#oo#..#oo#....',
    '...##ss####ss##...', '..#oooooooooooo#..', '.#oooooooooooooo#.',
    '.#oooooooooooooo#.', '#oooooooooooooooo#', '#oooooooooooooooo#',
    '#oooooooooooooooo#', '#o#oooooooo#ooooo#', '#o#oooooooo#ooooo#',
    '#ooooo#oooooooooo#', '.#ooo#o#oooooooo#.', '..#oooooooooooo#..',
    '...###ssssss###...',
  ];
  const source = new Uint8ClampedArray(RIG_WIDTH * RIG_HEIGHT * 4);
  for (let y = 0; y < RIG_HEIGHT; y++) {
    for (let x = 0; x < RIG_WIDTH; x++) {
      const pixel = rows[y]?.[x] ?? 'o';
      if (pixel !== '.') source.set(
        pixel === '#' ? [0, 0, 0, 255] : pixel === 's' ? [202, 205, 225, 255] : [247, 249, 249, 255],
        (y * RIG_WIDTH + x) * 4,
      );
    }
  }
  return source;
}

const eyePixels: Record<CharacterExpressionType, readonly number[]> = {
  neutral: [13 * 18 + 2, 14 * 18 + 2, 13 * 18 + 11, 14 * 18 + 11],
  happy: [
    12 * 18 + 3, 13 * 18 + 2, 13 * 18 + 3, 13 * 18 + 4, 14 * 18 + 2, 14 * 18 + 4,
    12 * 18 + 11, 13 * 18 + 10, 13 * 18 + 11, 13 * 18 + 12, 14 * 18 + 10, 14 * 18 + 12,
  ],
  sleepy: [
    12 * 18 + 2, 12 * 18 + 3, 12 * 18 + 4, 12 * 18 + 5, 13 * 18 + 4, 14 * 18 + 3, 14 * 18 + 4,
    12 * 18 + 10, 12 * 18 + 11, 12 * 18 + 12, 12 * 18 + 13, 13 * 18 + 12, 14 * 18 + 11, 14 * 18 + 12,
  ],
  curious: [
    9 * 18 + 3, 9 * 18 + 4, 11 * 18 + 3, 12 * 18 + 2, 12 * 18 + 4,
    13 * 18 + 2, 13 * 18 + 3, 13 * 18 + 4, 14 * 18 + 3,
    12 * 18 + 10, 12 * 18 + 11, 12 * 18 + 12, 13 * 18 + 11, 13 * 18 + 12, 14 * 18 + 11,
  ],
};

const eyeWhites: Record<CharacterExpressionType, readonly number[]> = {
  neutral: [], happy: [],
  sleepy: [13 * 18 + 3, 13 * 18 + 11],
  curious: [12 * 18 + 3, 13 * 18 + 10],
};

describe('authored character expressions', () => {
  it('generates whole, reproducible expressions without rerolling earlier parameter streams', () => {
    expect(generateAppearance(42).parameters).toMatchObject({
      color: { coat: '#f8d5bf', shade: '#d9b19f' },
      pattern: { type: 'solid', color: '#ec9ca3', colorMode: 'coat', seed: 3375925203 },
      ears: { type: 'both', color: '#88756e', colorMode: 'coat' },
    });
    const seen = new Set<CharacterExpressionType>();
    for (const seed of [0xffffffff, ...Array.from({ length: 1000 }, (_, index) => index)]) {
      const appearance = generateAppearance(seed);
      const { color, pattern, ears, expression } = appearance.parameters;
      expect(appearance.version).toBe(8);
      expect(pattern).toEqual(generatePattern(seed, color));
      expect(ears).toEqual(generateEars(seed, color, pattern));
      expect(expression).toEqual(generateExpression(seed));
      expect(generateExpression(seed)).toEqual(generateExpression(seed));
      seen.add(expression.type);
    }
    expect(seen).toEqual(new Set(CHARACTER_EXPRESSIONS.map(option => option.type)));
    expect(() => generateExpression(-1)).toThrow('Character seed must be');
  });

  it('renders exactly four registered faces without changing the nose, silhouette or source', () => {
    const source = sourceFixture();
    const original = source.slice();
    const appearance = generateAppearance(42);
    appearance.parameters.pattern.type = 'solid';
    appearance.parameters.expression.type = 'neutral';
    const neutral = renderAppearance(source, appearance);
    const images = new Set<string>();
    for (const { type } of CHARACTER_EXPRESSIONS) {
      appearance.parameters.expression.type = type;
      const result = renderAppearance(source, appearance);
      const allowed = new Set([...eyePixels.neutral, ...eyePixels[type], ...eyeWhites[type]]);
      for (let i = 0; i < source.length; i += 4) {
        expect(result[i + 3]).toBe(neutral[i + 3]);
        if (!allowed.has(i / 4)) expect(result.slice(i, i + 4)).toEqual(neutral.slice(i, i + 4));
      }
      for (const index of eyePixels[type]) {
        expect([...result.slice(index * 4, index * 4 + 4)]).toEqual([0, 0, 0, 255]);
        for (const neighbor of [index - 1, index + 1, index - RIG_WIDTH, index + RIG_WIDTH]) {
          if (!eyePixels.neutral.includes(neighbor)) {
            expect([...source.slice(neighbor * 4, neighbor * 4 + 3)]).not.toEqual([0, 0, 0]);
          }
        }
      }
      for (const index of eyeWhites[type]) {
        expect([...result.slice(index * 4, index * 4 + 4)]).toEqual([255, 249, 237, 255]);
      }
      if (type !== 'neutral') expect(eyePixels[type].length).toBeGreaterThanOrEqual(12);
      for (const index of eyePixels.neutral.filter(index => !eyePixels[type].includes(index) && !eyeWhites[type].includes(index))) {
        expect([...result.slice(index * 4, index * 4 + 3)]).toEqual([248, 213, 191]);
      }
      expect(renderAppearance(source, appearance)).toEqual(result);
      images.add(String(result));
    }
    expect(images.size).toBe(4);
    expect(source).toEqual(original);
  });

  it('restores patch-colored underpainting instead of leaving old eyes or coat-colored holes', () => {
    const source = sourceFixture();
    const appearance = generateAppearance(42);
    for (const palette of CHARACTER_COLOR_PALETTES) {
      appearance.parameters.color = palette;
      for (const { type: patternType } of CHARACTER_PATTERNS) {
        for (let seed = 0; seed < 4; seed++) {
          appearance.parameters.pattern = { type: patternType, color: '#ba7755', colorMode: 'custom', seed };
          for (const { type } of CHARACTER_EXPRESSIONS) {
            appearance.parameters.expression.type = type;
            const result = renderAppearance(source, appearance);
            const clean = expressionSource(source, { type: type === 'neutral' ? 'sleepy' : type });
            const underlay: CharacterAppearance = {
              version: 4, seed: appearance.seed,
              parameters: { color: palette, pattern: appearance.parameters.pattern, ears: appearance.parameters.ears },
            };
            const painted = renderAppearance(clean, underlay);
            for (const index of eyePixels.neutral.filter(index => !eyePixels[type].includes(index) && !eyeWhites[type].includes(index))) {
              expect(result.slice(index * 4, index * 4 + 4)).toEqual(painted.slice(index * 4, index * 4 + 4));
            }
          }
        }
      }
    }
  });

  it('keeps ears, body and all other parameter data unchanged when selecting expressions', () => {
    const source = sourceFixture();
    const appearance = generateAppearance(42);
    appearance.parameters.pattern.type = 'mixed';
    for (const { type: earType } of CHARACTER_EAR_MARKINGS) {
      appearance.parameters.ears.type = earType;
      appearance.parameters.expression.type = 'neutral';
      const before = renderAppearance(source, appearance);
      const parameters = structuredClone(appearance.parameters);
      for (const { type } of CHARACTER_EXPRESSIONS) {
        appearance.parameters.expression.type = type;
        const result = renderAppearance(source, appearance);
        expect(result.slice(0, 9 * RIG_WIDTH * 4)).toEqual(before.slice(0, 9 * RIG_WIDTH * 4));
        expect(result.slice(15 * RIG_WIDTH * 4)).toEqual(before.slice(15 * RIG_WIDTH * 4));
        expect(appearance.parameters.color).toEqual(parameters.color);
        expect(appearance.parameters.pattern).toEqual(parameters.pattern);
        expect(appearance.parameters.ears).toEqual(parameters.ears);
      }
    }
  });

  it('preserves older recipe faces and reports missing or invalid new expressions', () => {
    const source = sourceFixture();
    const appearance = generateAppearance(42);
    appearance.parameters.accessory.type = 'none';
    appearance.parameters.expression.type = 'neutral';
    const current = renderAppearance(source, appearance);
    const legacy: CharacterAppearance = {
      version: 4, seed: appearance.seed,
      parameters: { color: appearance.parameters.color, pattern: appearance.parameters.pattern, ears: appearance.parameters.ears },
    };
    expect(renderAppearance(source, legacy)).toEqual(current);
    legacy.version = 5;
    expect(() => renderAppearance(source, legacy)).toThrow('require an expression');
    Object.assign(appearance.parameters.expression, { type: 'unknown' });
    expect(() => renderAppearance(source, appearance)).toThrow('Unknown character expression');
    expect(() => expressionSource(new Uint8ClampedArray(4), { type: 'happy' })).toThrow('18 by 29');
    expect(() => renderExpression(source, new Uint8ClampedArray(4), { type: 'happy' })).toThrow('matching 18 by 29');
    const invalidSample = source.slice();
    invalidSample[(10 * RIG_WIDTH + 7) * 4 + 3] = 0;
    expect(() => expressionSource(invalidSample, { type: 'happy' })).toThrow('coat sample must be opaque');
  });

  it('retains the first expression drawings for version 5 recipes, rather than silently redesigning exports', () => {
    const source = sourceFixture();
    const appearance = generateAppearance(42);
    const legacyEyes: Record<CharacterExpressionType, readonly number[]> = {
      neutral: eyePixels.neutral,
      happy: [14 * 18 + 2, 13 * 18 + 3, 14 * 18 + 4, 14 * 18 + 10, 13 * 18 + 11, 14 * 18 + 12],
      sleepy: [14 * 18 + 2, 14 * 18 + 3, 14 * 18 + 10, 14 * 18 + 11],
      curious: [12 * 18 + 2, 13 * 18 + 2, 13 * 18 + 11, 14 * 18 + 11],
    };
    for (const { type } of CHARACTER_EXPRESSIONS) {
      appearance.parameters.expression.type = type;
      appearance.version = 6;
      const detailed = renderAppearance(source, appearance);
      appearance.version = 5;
      const legacy = renderAppearance(source, appearance);
      for (const index of legacyEyes[type]) {
        expect([...legacy.slice(index * 4, index * 4 + 3)]).toEqual([0, 0, 0]);
      }
      if (type === 'neutral') expect(legacy).toEqual(detailed);
      else expect(legacy).not.toEqual(detailed);
    }
  });
});
