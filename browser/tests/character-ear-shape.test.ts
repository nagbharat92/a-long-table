import { describe, expect, it } from 'vitest';
import { CHARACTER_EAR_SHAPES, reshapeRabbitEars } from '../src/core/character-ear-shape';
import {
  CHARACTER_COLOR_PALETTES, CHARACTER_EAR_MARKINGS, generateAppearance, renderAppearance,
} from '../src/core/character-appearance';
import { CHARACTER_EXPRESSIONS } from '../src/core/character-expression';
import { CHARACTER_ACCESSORIES } from '../src/core/character-accessory';
import { RIG_HEIGHT, RIG_WIDTH } from '../src/core/character-rig';

function fixture(): Uint8ClampedArray {
  const rows = [
    '.....##....##.....', '....#oo#..#oo#....', '....#oo#..#oo#....',
    '....#oo#..#oo#....', '....#oo#..#oo#....', '....#oo#..#oo#....',
    '...##ss####ss##...', '..#oooooooooooo#..', '.#oooooooooooooo#.',
    '.#oooooooooooooo#.', '#oooooooooooooooo#', '#oooooooooooooooo#',
    '#oooooooooooooooo#', '#o#oooooooo#ooooo#', '#o#oooooooo#ooooo#',
    '#ooooo#oooooooooo#', '.#ooo#o#oooooooo#.', '..#oooooooooooo#..',
    '...###ssssss###...',
  ];
  const result = new Uint8ClampedArray(RIG_WIDTH * RIG_HEIGHT * 4);
  for (let y = 0; y < RIG_HEIGHT; y++) {
    for (let x = 0; x < RIG_WIDTH; x++) {
      const cell = rows[y]?.[x] ?? 'o';
      if (cell === '.') continue;
      result.set(cell === '#' ? [0, 0, 0, 255] : cell === 's' ? [202, 205, 225, 255] : [247, 249, 249, 255],
        (y * RIG_WIDTH + x) * 4);
    }
  }
  return result;
}

function pixel(pixels: Uint8ClampedArray, x: number, y: number): number[] {
  const index = (y * RIG_WIDTH + x) * 4;
  return [...pixels.slice(index, index + 4)];
}

describe('authored ear shapes', () => {
  it('creates four distinct silhouettes, preserving everything below the ear roots and the source', () => {
    const source = fixture(), original = source.slice();
    const silhouettes = new Set<string>();
    for (const { type } of CHARACTER_EAR_SHAPES) {
      const output = reshapeRabbitEars(source, type);
      silhouettes.add(String(output.filter((_, index) => index % 4 === 3)));
      expect(output.slice(6 * RIG_WIDTH * 4)).toEqual(source.slice(6 * RIG_WIDTH * 4));
      expect(reshapeRabbitEars(source, type)).toEqual(output);
      if (type === 'upright') expect(output).toEqual(source);
      for (let y = 0; y < 6; y++) {
        for (let x = 0; x < RIG_WIDTH / 2; x++) {
          if (type !== 'one-floppy') expect(pixel(output, x, y)).toEqual(pixel(output, RIG_WIDTH - 1 - x, y));
          else expect(pixel(output, x, y)).toEqual(pixel(source, x, y));
        }
      }
    }
    expect(silhouettes.size).toBe(4);
    expect(source).toEqual(original);
  });

  it('carries tips, inner stripes, single-ear color and shading around the authored folds', () => {
    const source = fixture();
    const appearance = generateAppearance(42);
    appearance.parameters.expression.type = 'neutral';
    appearance.parameters.accessory.type = 'none';
    appearance.parameters.ears = { type: 'tips', shape: 'both-floppy', color: '#aa6677', colorMode: 'custom' };
    const tips = renderAppearance(source, appearance);
    expect(pixel(tips, 1, 4)).toEqual([170, 102, 119, 255]);
    expect(pixel(tips, 16, 4)).toEqual([170, 102, 119, 255]);
    expect(pixel(tips, 5, 5)).not.toEqual([170, 102, 119, 255]);
    appearance.parameters.ears.type = 'inner';
    const inner = renderAppearance(source, appearance);
    expect(pixel(inner, 3, 2)).toEqual([170, 102, 119, 255]);
    expect(pixel(inner, 2, 2)).not.toEqual([170, 102, 119, 255]);
    appearance.parameters.ears.type = 'single';
    source.set([202, 205, 225, 255], (4 * RIG_WIDTH + 6) * 4);
    const single = renderAppearance(source, appearance);
    expect(pixel(single, 6, 1)).toEqual([129, 78, 90, 255]);
    expect(pixel(single, 11, 1)).not.toEqual([129, 78, 90, 255]);
  });

  it('works with every palette, marking, expression and accessory without changing the head or body', () => {
    const source = fixture();
    const appearance = generateAppearance(42);
    for (const color of CHARACTER_COLOR_PALETTES) {
      appearance.parameters.color = color;
      for (const { type: marking } of CHARACTER_EAR_MARKINGS) {
        appearance.parameters.ears.type = marking;
        for (const { type: expression } of CHARACTER_EXPRESSIONS) {
          appearance.parameters.expression.type = expression;
          for (const { type: accessory } of CHARACTER_ACCESSORIES) {
            appearance.parameters.accessory.type = accessory;
            appearance.parameters.ears.shape = 'upright';
            const upright = renderAppearance(source, appearance);
            for (const { type: shape } of CHARACTER_EAR_SHAPES) {
              appearance.parameters.ears.shape = shape;
              const output = renderAppearance(source, appearance);
              expect(output.slice(6 * RIG_WIDTH * 4)).toEqual(upright.slice(6 * RIG_WIDTH * 4));
            }
          }
        }
      }
    }
  });

  it('generates all shapes reproducibly without changing earlier parameter streams', () => {
    const shapes = new Set<string>();
    for (let seed = 0; seed < 1000; seed++) {
      const appearance = generateAppearance(seed);
      expect(appearance).toEqual(generateAppearance(seed));
      expect(appearance.parameters.ears.shape).toBeDefined();
      shapes.add(appearance.parameters.ears.shape!);
      expect(appearance.parameters.pattern.type).toBe('solid');
    }
    expect(shapes).toEqual(new Set(CHARACTER_EAR_SHAPES.map(option => option.type)));
    expect(generateAppearance(42).parameters).toMatchObject({
      color: { coat: '#f8d5bf', shade: '#d9b19f' },
      ears: { type: 'both', color: '#88756e', shape: 'both-floppy' },
    });
  });

  it('keeps recipes without a shape upright and rejects malformed shapes explicitly', () => {
    const source = fixture();
    const appearance = generateAppearance(42);
    appearance.parameters.ears.shape = 'upright';
    const upright = renderAppearance(source, appearance);
    delete appearance.parameters.ears.shape;
    expect(renderAppearance(source, appearance)).toEqual(upright);
    Object.assign(appearance.parameters.ears, { shape: 'unknown' });
    expect(() => renderAppearance(source, appearance)).toThrow('Unknown ear shape');
    expect(() => reshapeRabbitEars(new Uint8ClampedArray(4), 'bent')).toThrow('18 by 29');
  });
});
