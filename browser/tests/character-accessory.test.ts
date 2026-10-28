import { describe, expect, it } from 'vitest';
import { CHARACTER_ACCESSORIES, renderAccessory } from '../src/core/character-accessory';
import {
  CHARACTER_COLOR_PALETTES, generateAccessory, generateAppearance, linkedAccessoryColor, renderAppearance,
  type CharacterAppearance,
} from '../src/core/character-appearance';
import { RIG_HEIGHT, RIG_WIDTH } from '../src/core/character-rig';

function fixture(): Uint8ClampedArray {
  const source = new Uint8ClampedArray(RIG_WIDTH * RIG_HEIGHT * 4);
  for (let i = 0; i < source.length; i += 4) source.set([247, 249, 249, 255], i);
  source.set([0, 0, 0, 255], (20 * RIG_WIDTH + 5) * 4);
  source[(19 * RIG_WIDTH + 6) * 4 + 3] = 0;
  return source;
}

describe('authored neck accessories', () => {
  it('generates accessories only on solid coats without rerolling preceding parameter streams', () => {
    const seen = new Set<string>();
    const solidChoices = new Set<string>();
    for (let seed = 0; seed < 1000; seed++) {
      const { color, pattern, accessory } = generateAppearance(seed).parameters;
      expect(accessory).toEqual(generateAccessory(seed, color, pattern));
      expect(accessory.colorMode).toBe('coat');
      expect(accessory.color).toBe(linkedAccessoryColor(color));
      seen.add(accessory.type);
      if (pattern.type !== 'solid') expect(accessory.type).toBe('none');
      const simple = generateAccessory(seed, color, { ...pattern, type: 'solid' });
      solidChoices.add(simple.type);
      for (const type of ['cheeks', 'face', 'body', 'mixed', 'two-tone'] as const) {
        expect(generateAccessory(seed, color, { ...pattern, type }).type).toBe('none');
      }
    }
    expect(seen).toEqual(new Set(CHARACTER_ACCESSORIES.map(option => option.type)));
    expect(solidChoices).toEqual(seen);
    expect(generateAppearance(42).parameters).toMatchObject({
      color: { coat: '#f8d5bf', shade: '#d9b19f' },
      pattern: { type: 'solid', seed: 3375925203 },
      ears: { type: 'both' },
    });
    const { color, pattern } = generateAppearance(42).parameters;
    expect(() => generateAccessory(-1, color, pattern)).toThrow('Character seed must be');
  });

  it('paints complete material stamps only below the jaw, preserving source, ink and transparency', () => {
    const source = fixture(), original = source.slice();
    const appearance = generateAppearance(42);
    appearance.parameters.expression.type = 'neutral';
    appearance.parameters.accessory.type = 'none';
    const uncovered = renderAppearance(source, appearance);
    const images = new Set<string>();
    const before = structuredClone(appearance.parameters);
    for (const { type } of CHARACTER_ACCESSORIES) {
      appearance.parameters.accessory = { type, color: '#537b68', colorMode: 'custom' };
      const result = renderAppearance(source, appearance);
      let changed = 0;
      for (let i = 0; i < source.length; i += 4) {
        expect(result[i + 3]).toBe(uncovered[i + 3]);
        const x = (i / 4) % RIG_WIDTH, y = Math.floor(i / 4 / RIG_WIDTH);
        if (result.slice(i, i + 4).some((value, channel) => value !== uncovered[i + channel])) {
          changed++;
          expect(y).toBeGreaterThanOrEqual(19);
          expect(y).toBeLessThanOrEqual(25);
          expect(x).toBeGreaterThanOrEqual(5);
          expect(x).toBeLessThanOrEqual(13);
          expect(source[i + 3]).toBe(255);
          expect([...source.slice(i, i + 3)]).not.toEqual([0, 0, 0]);
        }
      }
      expect(changed).toBe(type === 'none' ? 0 : type === 'collar' ? 35 : 38);
      expect(appearance.parameters.color).toEqual(before.color);
      expect(appearance.parameters.pattern).toEqual(before.pattern);
      expect(appearance.parameters.ears).toEqual(before.ears);
      expect(appearance.parameters.expression).toEqual(before.expression);
      expect(renderAppearance(source, appearance)).toEqual(result);
      images.add(String(result));
    }
    expect(images.size).toBe(3);
    expect(source).toEqual(original);
  });

  it('keeps brass hardware independent from the material color and supports manual overrides', () => {
    const source = fixture();
    const appearance = generateAppearance(42);
    appearance.parameters.accessory = { type: 'collar', color: '#537b68', colorMode: 'custom' };
    const first = renderAppearance(source, appearance);
    appearance.parameters.accessory.color = '#a54c6b';
    const second = renderAppearance(source, appearance);
    const pixel = (data: Uint8ClampedArray, x: number, y: number) =>
      [...data.slice((y * RIG_WIDTH + x) * 4, (y * RIG_WIDTH + x) * 4 + 3)];
    expect(pixel(first, 9, 24)).toEqual([211, 166, 79]);
    expect(pixel(second, 9, 24)).toEqual(pixel(first, 9, 24));
    expect(pixel(second, 6, 20)).not.toEqual(pixel(first, 6, 20));
    for (const color of CHARACTER_COLOR_PALETTES) {
      appearance.parameters.color = color;
      const result = renderAppearance(source, appearance);
      expect(pixel(result, 6, 20)).toEqual(pixel(second, 6, 20));
      expect(linkedAccessoryColor(color)).toMatch(/^#[0-9a-f]{6}$/);
    }
    appearance.parameters.accessory.colorMode = 'coat';
    const automatic = renderAppearance(source, appearance);
    appearance.parameters.accessory.color = '#invalid';
    expect(renderAppearance(source, appearance)).toEqual(automatic);
  });

  it('uses saturated coat pairings while preserving version 7 neckwear artwork', () => {
    const source = fixture();
    for (const color of CHARACTER_COLOR_PALETTES) {
      const accent = linkedAccessoryColor(color);
      const channels = [1, 3, 5].map(index => parseInt(accent.slice(index, index + 2), 16));
      expect(Math.max(...channels) - Math.min(...channels)).toBeGreaterThanOrEqual(130);
      expect(accent).not.toBe(linkedAccessoryColor(color, 1));
      for (const type of ['collar', 'bandana'] as const) {
        const appearance = generateAppearance(42);
        appearance.parameters.color = color;
        appearance.parameters.pattern.type = 'solid';
        appearance.parameters.expression.type = 'neutral';
        appearance.parameters.accessory = { type, color: accent, colorMode: 'coat' };
        const current = renderAppearance(source, appearance);
        appearance.version = 7;
        const legacy = renderAppearance(source, appearance);
        const expected = structuredClone(appearance);
        expected.parameters.accessory.type = 'none';
        const baseline = renderAppearance(source, expected);
        renderAccessory(source, baseline, { type, color: linkedAccessoryColor(color, 1), colorMode: 'custom' }, 1);
        expect(legacy).toEqual(baseline);
        expect(current).not.toEqual(legacy);
        for (let y = 24; y < RIG_HEIGHT; y++) {
          expect(legacy.slice(y * RIG_WIDTH * 4, (y + 1) * RIG_WIDTH * 4))
            .toEqual(renderAppearance(source, expected).slice(y * RIG_WIDTH * 4, (y + 1) * RIG_WIDTH * 4));
        }
      }
    }
  });

  it('preserves version 6 artwork and rejects malformed new accessory settings', () => {
    const source = fixture();
    const appearance = generateAppearance(42);
    appearance.parameters.accessory.type = 'none';
    const current = renderAppearance(source, appearance);
    const legacy: CharacterAppearance = { ...appearance, version: 6, parameters: { ...appearance.parameters, accessory: undefined } };
    expect(renderAppearance(source, legacy)).toEqual(current);
    legacy.version = 7;
    expect(() => renderAppearance(source, legacy)).toThrow('require accessory settings');
    Object.assign(appearance.parameters.accessory, { type: 'unknown' });
    expect(() => renderAppearance(source, appearance)).toThrow('Unknown character accessory');
    Object.assign(appearance.parameters.accessory, { type: 'collar', colorMode: 'unknown' });
    expect(() => renderAppearance(source, appearance)).toThrow('Unknown accessory color mode');
    appearance.parameters.accessory = { type: 'collar', colorMode: 'custom', color: '#bad' };
    expect(() => renderAppearance(source, appearance)).toThrow('six-digit hex');
    expect(() => renderAccessory(new Uint8ClampedArray(4), source, appearance.parameters.accessory)).toThrow('18 by 29');
  });
});
