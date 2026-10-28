import { describe, expect, it } from 'vitest';
import {
  appearanceSeed, balancedEarSide, CHARACTER_COLOR_PALETTES, CHARACTER_EAR_MARKINGS, CHARACTER_PATTERNS,
  earLayoutName, generateAppearance, generateAppearanceBatch, generateEars, generatePattern,
  linkedEarColor, linkedPatchColor, linkedPatternColor, patternLayoutName, recolorRabbit, renderAppearance,
  type CharacterAppearance, type CharacterEarType,
} from '../src/core/character-appearance';
import { RIG_HEIGHT, RIG_WIDTH } from '../src/core/character-rig';

function neutralAppearance(seed: number) {
  const appearance = generateAppearance(seed);
  appearance.parameters.expression.type = 'neutral';
  appearance.parameters.accessory.type = 'none';
  appearance.parameters.ears.shape = 'upright';
  return appearance;
}

describe('character appearance generation', () => {
  it('reproduces versioned recipes from seeds, including both boundaries', () => {
    for (const seed of [0, 1, 42, 123456789, 0xffffffff]) {
      expect(generateAppearance(seed)).toEqual(generateAppearance(seed));
      expect(generateAppearance(seed)).toMatchObject({ version: 8, seed });
      expect(generateAppearance(seed).parameters.color.coat).toMatch(/^#[0-9a-f]{6}$/);
      expect(generateAppearance(seed).parameters.color.shade).toMatch(/^#[0-9a-f]{6}$/);
      expect(generateAppearance(seed).parameters.color.coat).not.toBe(generateAppearance(seed).parameters.color.shade);
    }
    expect(generateAppearance(42)).not.toEqual(generateAppearance(43));
  });

  it('generates twelve distinct coats reproducibly across a large seed sample', () => {
    for (const seed of [0xffffffff, ...Array.from({ length: 1000 }, (_, index) => index)]) {
      const batch = generateAppearanceBatch(seed);
      expect(batch).toHaveLength(12);
      expect(new Set(batch.map(item => item.parameters.color.coat)).size).toBe(12);
      expect(new Set(batch.map(item => item.seed)).size).toBe(12);
      expect(batch).toEqual(generateAppearanceBatch(seed));
    }
  });

  it('rejects invalid seeds rather than falling back to another character', () => {
    for (const value of ['', ' ', '-1', '1.5', 'Infinity', 'NaN', '4294967296', '1e3', '42abc']) {
      expect(() => appearanceSeed(value)).toThrow('Character seed must be');
    }
    for (const value of [-1, 1.5, Infinity, NaN, 0x100000000]) {
      expect(() => generateAppearance(value)).toThrow();
    }
    expect(appearanceSeed('0')).toBe(0);
    expect(appearanceSeed('4294967295')).toBe(0xffffffff);
  });

  it('changes only the two color roles, preserving ink, transparency and the source buffer', () => {
    const source = new Uint8ClampedArray(RIG_WIDTH * RIG_HEIGHT * 4);
    source.set([247, 249, 249, 255, 202, 205, 225, 255, 0, 0, 0, 255, 202, 205, 225, 0]);
    const before = source.slice();
    const result = recolorRabbit(source, { coat: '#e8b99a', shade: '#b57c69' });
    expect([...result.slice(0, 16)]).toEqual([
      232, 185, 154, 255, 181, 124, 105, 255, 0, 0, 0, 255, 202, 205, 225, 0,
    ]);
    expect(source).toEqual(before);
    for (let i = 3; i < source.length; i += 4) expect(result[i]).toBe(source[i]);
  });

  it('rejects invalid colors and mismatched source sizes', () => {
    expect(() => recolorRabbit(new Uint8ClampedArray(4), { coat: '#abcdef', shade: '#123456' })).toThrow('18 by 29');
    const source = new Uint8ClampedArray(RIG_WIDTH * RIG_HEIGHT * 4);
    expect(() => recolorRabbit(source, { coat: 'red', shade: '#123456' })).toThrow('six-digit hex');
    expect(() => recolorRabbit(source, { coat: '#abcdef', shade: '#123' })).toThrow('six-digit hex');
  });

  it('generates independent, reproducible patterns without changing the existing color stream', () => {
    const types = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      const appearance = generateAppearance(seed);
      expect(appearance.parameters.pattern).toEqual(generateAppearance(seed).parameters.pattern);
      types.add(appearance.parameters.pattern.type);
      const colors = structuredClone(appearance.parameters.color);
      appearance.parameters.pattern = { type: 'mixed', color: '#ffffff', seed: 999 };
      expect(appearance.parameters.color).toEqual(colors);
    }
    expect(types).toEqual(new Set(CHARACTER_PATTERNS.map(pattern => pattern.type)));
  });

  it('clips rounded patterns to the right regions and preserves ink, alpha and source pixels', () => {
    const source = new Uint8ClampedArray(RIG_WIDTH * RIG_HEIGHT * 4);
    for (let i = 0; i < source.length; i += 4) source.set([247, 249, 249, 255], i);
    source.set([0, 0, 0, 255], (12 * RIG_WIDTH + 4) * 4);
    source.set([247, 249, 249, 0], (11 * RIG_WIDTH + 4) * 4);
    const original = source.slice();
    const appearance = neutralAppearance(42);
    appearance.parameters.ears.type = 'plain';
    const base = recolorRabbit(source, appearance.parameters.color);
    for (const { type } of CHARACTER_PATTERNS) {
      appearance.parameters.pattern = { type, color: '#ffcc88', seed: 7 };
      const result = renderAppearance(source, appearance);
      let facePixels = 0, bodyPixels = 0;
      for (let i = 0; i < source.length; i += 4) {
        expect(result[i + 3]).toBe(source[i + 3]);
        if (!source[i + 3] || source[i] === 0) expect(result.slice(i, i + 4)).toEqual(source.slice(i, i + 4));
        if (result[i] === base[i]) continue;
        const x = (i / 4) % RIG_WIDTH, y = Math.floor(i / 4 / RIG_WIDTH);
        if (y <= 17) { facePixels++; expect(y).toBeGreaterThanOrEqual(7); }
        else {
          bodyPixels++;
          expect(y).toBeGreaterThanOrEqual(19);
          expect(y).toBeLessThanOrEqual(25);
          expect(x).toBeGreaterThanOrEqual(5);
          expect(x).toBeLessThanOrEqual(12);
        }
      }
      expect(facePixels).toBe(0);
      expect(bodyPixels).toBe(0);
      if (type === 'solid') expect(result).toEqual(base);
      expect(renderAppearance(source, appearance)).toEqual(result);
    }
    expect(source).toEqual(original);
  });

  it('patch placement changes independently from type, patch color and coat color', () => {
    const source = new Uint8ClampedArray(RIG_WIDTH * RIG_HEIGHT * 4);
    for (let i = 0; i < source.length; i += 4) source.set([247, 249, 249, 255], i);
    const appearance = neutralAppearance(42);
    appearance.parameters.ears.type = 'plain';
    appearance.parameters.pattern = { type: 'mixed', color: '#ffcc88', seed: 1 };
    const first = renderAppearance(source, appearance);
    appearance.parameters.pattern.seed = 2;
    expect(renderAppearance(source, appearance)).not.toEqual(first);
    const pattern = structuredClone(appearance.parameters.pattern);
    appearance.parameters.color = { coat: '#abcdef', shade: '#123456' };
    const recolored = renderAppearance(source, appearance);
    expect(appearance.parameters.pattern).toEqual(pattern);
    for (let i = 0; i < recolored.length; i += 4) {
      if (recolored[i] === 255) expect([...recolored.slice(i, i + 3)]).toEqual([255, 204, 136]);
    }
    appearance.parameters.pattern.color = '#invalid';
    expect(() => renderAppearance(source, appearance)).toThrow('six-digit hex');
    appearance.parameters.pattern.color = '#ffffff';
    appearance.parameters.pattern.seed = -1;
    expect(() => renderAppearance(source, appearance)).toThrow('Character seed must be');
    Object.assign(appearance.parameters.pattern, { type: 'unknown' });
    expect(() => renderAppearance(source, appearance)).toThrow('Unknown character pattern');
  });

  it('retains downloaded cheek recipes but generates only unmarked faces and bodies', () => {
    const source = new Uint8ClampedArray(RIG_WIDTH * RIG_HEIGHT * 4);
    for (let i = 0; i < source.length; i += 4) source.set([247, 249, 249, 255], i);
    const appearance = neutralAppearance(42);
    appearance.parameters.ears.type = 'plain';
    appearance.parameters.pattern = { type: 'cheeks', color: '#e88999', colorMode: 'custom', seed: 0 };
    const base = recolorRabbit(source, appearance.parameters.color);
    const result = renderAppearance(source, appearance);
    const changed: string[] = [];
    for (let i = 0; i < result.length; i += 4) {
      if (result.slice(i, i + 4).some((value, channel) => value !== base[i + channel])) {
        changed.push(`${i / 4 % RIG_WIDTH},${Math.floor(i / 4 / RIG_WIDTH)}`);
      }
    }
    expect(new Set(changed)).toEqual(new Set([
      '3,15', '2,16', '3,16', '4,16', '3,17',
      '12,15', '11,16', '12,16', '13,16', '12,17',
    ]));
    appearance.parameters.pattern.seed = 0xffffffff;
    expect(renderAppearance(source, appearance)).toEqual(result);
    const types = new Set<string>();
    for (let seed = 0; seed < 1000; seed++) {
      const generated = generateAppearance(seed);
      types.add(generated.parameters.pattern.type);
      generated.parameters.ears.type = 'plain';
      generated.parameters.expression.type = 'neutral';
      generated.parameters.accessory.type = 'none';
      const output = renderAppearance(source, generated);
      const coat = recolorRabbit(source, generated.parameters.color);
      expect(output.slice(6 * RIG_WIDTH * 4)).toEqual(coat.slice(6 * RIG_WIDTH * 4));
    }
    expect(types).toEqual(new Set(['solid']));
  });

  it('keeps coats soft while giving linked markings deeper contrast', () => {
    const lightness = (hex: string): number => {
      const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
        .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    expect(CHARACTER_COLOR_PALETTES.map(palette => palette.name)).toEqual([
      'Snow', 'Cream', 'Biscuit', 'Peach', 'Rose', 'Lavender', 'Sky', 'Mint',
    ]);
    const colors = [
      ...CHARACTER_COLOR_PALETTES,
      ...Array.from({ length: 1000 }, (_, seed) => generateAppearance(seed).parameters.color),
    ];
    for (const color of colors) {
      expect(lightness(color.coat)).toBeGreaterThan(0.65);
      expect(lightness(color.shade)).toBeGreaterThan(0.42);
      expect(lightness(color.coat)).toBeGreaterThan(lightness(color.shade));
      const patch = linkedPatchColor(color);
      expect(lightness(patch)).toBeLessThan(lightness(color.shade));
      const shadedPatch = `#${[1, 3, 5].map(index =>
        Math.round(parseInt(patch.slice(index, index + 2), 16) * 0.76).toString(16).padStart(2, '0')).join('')}`;
      for (const marking of [patch, shadedPatch]) {
        for (const base of [color.coat, color.shade]) {
          expect((lightness(base) + 0.05) / (lightness(marking) + 0.05)).toBeGreaterThanOrEqual(2);
        }
      }
    }
    for (let seed = 0; seed < 100; seed++) {
      const { color, pattern } = generateAppearance(seed).parameters;
      expect(pattern.colorMode).toBe('coat');
      expect(pattern.color).toBe(linkedPatternColor(color, pattern.type));
    }
  });

  it('uses four composed layouts with distinct spots, a clear muzzle and bounded coverage', () => {
    const source = new Uint8ClampedArray(RIG_WIDTH * RIG_HEIGHT * 4);
    for (let i = 0; i < source.length; i += 4) source.set([247, 249, 249, 255], i);
    const appearance = neutralAppearance(42);
    appearance.parameters.ears.type = 'plain';
    const layouts = new Set<string>();
    for (let seed = 0; seed < 4; seed++) {
      appearance.parameters.pattern = { type: 'mixed', color: '#ffcc88', seed };
      layouts.add(patternLayoutName(appearance.parameters.pattern));
      const output = renderAppearance(source, appearance);
      const marked = (x: number, y: number): boolean => output[(y * RIG_WIDTH + x) * 4] === 255;
      let face = 0, body = 0;
      for (let y = 7; y <= 25; y++) {
        for (let x = 0; x < RIG_WIDTH; x++) {
          if (y >= 13 && y <= 16 && x >= 7 && x <= 10) expect(marked(x, y)).toBe(false);
          if (marked(x, y)) { if (y <= 17) face++; else body++; }
        }
      }
      expect(face).toBeGreaterThanOrEqual(10);
      expect(face).toBeLessThanOrEqual(30);
      expect(body).toBeGreaterThanOrEqual(10);
      expect(body).toBeLessThanOrEqual(20);
      for (let y = 19; y <= 25; y++) {
        expect(marked(8, y)).toBe(false);
        expect(marked(9, y)).toBe(false);
      }
      appearance.parameters.pattern.seed += 4;
      expect(renderAppearance(source, appearance)).toEqual(output);
    }
    expect(layouts.size).toBe(4);
  });

  it('retains the legacy version 2 geometry for downloaded recipes', () => {
    const source = new Uint8ClampedArray(RIG_WIDTH * RIG_HEIGHT * 4);
    for (let i = 0; i < source.length; i += 4) source.set([247, 249, 249, 255], i);
    const appearance = neutralAppearance(42);
    appearance.parameters.ears.type = 'plain';
    appearance.parameters.pattern = { type: 'mixed', color: '#ffcc88', seed: 7 };
    const composed = renderAppearance(source, appearance);
    appearance.version = 2;
    const legacy = renderAppearance(source, appearance);
    expect(legacy).not.toEqual(composed);
    expect(renderAppearance(source, appearance)).toEqual(legacy);
  });
});

function earFixture(): Uint8ClampedArray {
  const rows = [
    '.....##....##.....', '....#oo#..#oo#....', '....#oo#..#oo#....',
    '....#oo#..#oo#....', '....#oo#..#oo#....', '....#oo#..#oo#....',
    '...##ss####ss##...',
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

describe('composed ear markings', () => {
  it('adds a separate seeded parameter without rerolling existing coat or patch streams', () => {
    expect(generateAppearance(42).parameters).toMatchObject({
      color: { coat: '#f8d5bf', shade: '#d9b19f' },
      pattern: { type: 'solid', color: '#ec9ca3', colorMode: 'coat', seed: 3375925203 },
    });
    const seen = new Set<CharacterEarType>();
    for (let seed = 0; seed < 1000; seed++) {
      const { color, pattern, ears } = generateAppearance(seed).parameters;
      expect(pattern).toEqual(generatePattern(seed, color));
      expect(ears).toEqual(generateEars(seed, color, pattern));
      expect(ears.colorMode).toBe('coat');
      expect(ears.color).toBe(linkedEarColor(color, ears.type));
      if (pattern.type === 'mixed' || pattern.type === 'two-tone') {
        expect(['plain', 'tips', 'inner']).toContain(ears.type);
      }
      if (pattern.type === 'face') expect(ears.type).not.toBe('both');
      seen.add(ears.type);
    }
    expect(seen).toEqual(new Set(CHARACTER_EAR_MARKINGS.map(option => option.type)));
    const color = generateAppearance(42).parameters.color;
    expect(() => generateEars(-1, color, generatePattern(42, color))).toThrow('Character seed must be');
  });

  it('uses exact authored masks, equal tip depths and inward-facing inset stripes', () => {
    const source = earFixture();
    const original = source.slice();
    const appearance = neutralAppearance(42);
    appearance.parameters.pattern.type = 'solid';
    const base = recolorRabbit(source, appearance.parameters.color);
    const masks: Record<CharacterEarType, string[]> = { plain: [], tips: [], single: [], both: [], inner: [] };
    for (const x of [5, 6, 11, 12]) {
      for (let y = 1; y <= 5; y++) {
        const key = `${x},${y}`;
        masks.both.push(key);
        if (x < 9) masks.single.push(key);
        if (y <= 2) masks.tips.push(key);
        if ((x === 6 || x === 11) && y >= 2 && y <= 4) masks.inner.push(key);
      }
    }
    for (const { type } of CHARACTER_EAR_MARKINGS) {
      appearance.parameters.ears = { type, color: '#aa6677', colorMode: 'custom' };
      const result = renderAppearance(source, appearance);
      const changed: string[] = [];
      for (let i = 0; i < result.length; i += 4) {
        expect(result[i + 3]).toBe(source[i + 3]);
        if (!source[i + 3] || source[i] === 0) expect(result.slice(i, i + 4)).toEqual(source.slice(i, i + 4));
        if (result.slice(i, i + 3).some((value, channel) => value !== base[i + channel])) {
          changed.push(`${(i / 4) % RIG_WIDTH},${Math.floor(i / 4 / RIG_WIDTH)}`);
          expect([...result.slice(i, i + 3)]).toEqual([170, 102, 119]);
        }
      }
      expect(new Set(changed)).toEqual(new Set(masks[type]));
      expect(renderAppearance(source, appearance)).toEqual(result);
    }
    expect(source).toEqual(original);
  });

  it('balances a single ear against the face first, otherwise the dominant body patch', () => {
    const appearance = neutralAppearance(42);
    appearance.parameters.ears.type = 'single';
    const { pattern, ears } = appearance.parameters;
    for (let seed = 0; seed < 4; seed++) {
      pattern.seed = seed;
      for (const type of ['face', 'mixed', 'body'] as const) {
        pattern.type = type;
        const expected = type === 'body'
          ? (seed % 2 === 0 ? 'left' : 'right') : (seed % 2 === 0 ? 'right' : 'left');
        expect(balancedEarSide(pattern)).toBe(expected);
        expect(earLayoutName(ears, pattern).toLowerCase()).toContain(`${expected} ear balances`);
        const withEars = renderAppearance(earFixture(), appearance);
        const plain = structuredClone(appearance);
        plain.parameters.ears.type = 'plain';
        const withoutEars = renderAppearance(earFixture(), plain);
        for (const [side, x] of [['left', 5], ['right', 11]] as const) {
          const index = (3 * RIG_WIDTH + x) * 4;
          expect(withEars.slice(index, index + 3).every((value, channel) => value === withoutEars[index + channel]))
            .toBe(side !== expected);
        }
        expect(withEars.slice(6 * RIG_WIDTH * 4)).toEqual(withoutEars.slice(6 * RIG_WIDTH * 4));
      }
    }
    for (const type of ['solid', 'two-tone'] as const) {
      pattern.type = type;
      expect(balancedEarSide(pattern)).toBe('left');
    }
  });

  it('retains shading, clips ink and transparency, and does not mutate manual colors', () => {
    const source = earFixture();
    source.set([202, 205, 225, 255], (4 * RIG_WIDTH + 5) * 4);
    source.set([247, 249, 249, 0], (2 * RIG_WIDTH + 11) * 4);
    const appearance = neutralAppearance(42);
    appearance.parameters.ears = { type: 'both', color: '#aa6677', colorMode: 'custom' };
    const before = structuredClone(appearance);
    const result = renderAppearance(source, appearance);
    expect([...result.slice((4 * RIG_WIDTH + 5) * 4, (4 * RIG_WIDTH + 5) * 4 + 3)]).toEqual([129, 78, 90]);
    expect(result[(2 * RIG_WIDTH + 11) * 4 + 3]).toBe(0);
    expect(appearance).toEqual(before);
    appearance.parameters.color = CHARACTER_COLOR_PALETTES[0];
    expect(renderAppearance(source, appearance).slice((3 * RIG_WIDTH + 5) * 4, (3 * RIG_WIDTH + 5) * 4 + 3))
      .toEqual(new Uint8ClampedArray([170, 102, 119]));
    expect(linkedEarColor(CHARACTER_COLOR_PALETTES[0], 'inner')).toBe('#ddb2bd');
    expect(linkedEarColor(CHARACTER_COLOR_PALETTES[0], 'both')).toBe(linkedPatchColor(CHARACTER_COLOR_PALETTES[0]));
  });

  it('preserves older recipes and reports invalid new ear settings explicitly', () => {
    const source = earFixture();
    const appearance = neutralAppearance(42);
    appearance.parameters.pattern = { type: 'mixed', color: '#aa6677', seed: 0 };
    appearance.parameters.ears.type = 'plain';
    const current = renderAppearance(source, appearance);
    const legacy: CharacterAppearance = {
      version: 3, seed: appearance.seed,
      parameters: { color: appearance.parameters.color, pattern: appearance.parameters.pattern },
    };
    expect(renderAppearance(source, legacy)).toEqual(current);
    legacy.version = 4;
    expect(() => renderAppearance(source, legacy)).toThrow('require ear settings');
    Object.assign(appearance.parameters.ears, { type: 'unknown' });
    expect(() => renderAppearance(source, appearance)).toThrow('Unknown ear marking');
    Object.assign(appearance.parameters.ears, { type: 'tips', colorMode: 'unknown' });
    expect(() => renderAppearance(source, appearance)).toThrow('Unknown ear color mode');
    appearance.parameters.ears = { type: 'tips', color: '#bad', colorMode: 'custom' };
    expect(() => renderAppearance(source, appearance)).toThrow('six-digit hex');
  });
});
