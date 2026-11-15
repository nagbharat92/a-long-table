import { describe, expect, it } from 'vitest';
import {
  createIslandTextures,
  ISLAND_TEXTURE_SIZE,
  ISLAND_TEXTURE_TEXEL_WORLD_SIZE,
  MATERIAL_COLORS,
  MATERIAL_PALETTES,
  type IslandMaterial,
} from './render/island-textures';

const materials = Object.keys(MATERIAL_COLORS) as IslandMaterial[];

describe('world-space island pixel textures', () => {
  it('is deterministic independently of sample order, with seed-dependent detail', () => {
    const first = createIslandTextures(71), again = createIslandTextures(71), other = createIslandTextures(72);
    for (const material of materials) {
      const coordinates = Array.from({ length: 1024 }, (_, i) => [i % 32, Math.floor(i / 32)]);
      const expected = coordinates.map(([x, y]) => first.sample(material, x, y));
      for (let i = coordinates.length - 1; i >= 0; i--) {
        const [x, y] = coordinates[i];
        expect(again.sample(material, x, y)).toEqual(expected[i]);
      }
      expect(coordinates.some(([x, y], i) => other.sample(material, x, y).join() !== expected[i].join())).toBe(true);
    }
  });

  it('uses floor-based nearest pixels, wrapping both axes including negative seams', () => {
    const textures = createIslandTextures(71), period = ISLAND_TEXTURE_SIZE * ISLAND_TEXTURE_TEXEL_WORLD_SIZE;
    for (const material of materials) {
      for (const [u, v] of [[0, 0], [-0.01, -0.01], [-256, 256], [-271.25, 319.9], [255.99, -256.01]]) {
        const expected = textures.sample(material, u, v);
        expect(textures.sample(material, u + period * 3, v - period * 2)).toEqual(expected);
        expect(textures.sample(material, u - period * 2, v + period * 3)).toEqual(expected);
        expect(textures.sample(material, Math.floor(u) + 0.01, Math.floor(v) + 0.99)).toBe(expected);
      }
      expect(textures.sample(material, -0.01, -0.01)).toBe(textures.sample(material, period - 1, period - 1));
      expect(textures.sample(material, -period, -period)).toBe(textures.sample(material, 0, 0));
    }
  });

  it('stabilizes interpolation error at texel boundaries without shifting other pixels', () => {
    const textures = createIslandTextures(71);
    for (const material of materials) {
      let distinctBoundaries = 0;
      for (let x = -256; x <= 256; x++) {
        const y = x % 37;
        const expected = textures.sample(material, x, y);
        expect(textures.sample(material, x - 1e-12, y + 1e-12)).toBe(expected);
        expect(textures.sample(material, x + 1e-12, y - 1e-12)).toBe(expected);
        expect(textures.sample(material, x - 1e-7, y)).toBe(textures.sample(material, x - 0.5, y));
        expect(textures.sample(material, x, y - 1e-7)).toBe(textures.sample(material, x, y - 0.5));
        if (expected !== textures.sample(material, x - 0.5, y)) distinctBoundaries++;
      }
      expect(distinctBoundaries).toBeGreaterThan(0);
    }
  });

  it.each(materials)('%s stays in a restrained palette with sparse cohesive detail', material => {
    const textures = createIslandTextures(71), palette = MATERIAL_PALETTES[material];
    const counts = new Map<string, number>();
    let detail = 0, connected = 0, verticalChanges = 0, horizontalChanges = 0;
    for (let y = 0; y < ISLAND_TEXTURE_SIZE; y++) {
      for (let x = 0; x < ISLAND_TEXTURE_SIZE; x++) {
        const sampled = textures.sample(material, x, y);
        counts.set(sampled.join(), (counts.get(sampled.join()) ?? 0) + 1);
        if (sampled !== MATERIAL_COLORS[material]) {
          detail++;
          if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) =>
            textures.sample(material, x + dx, y + dy) !== MATERIAL_COLORS[material])) connected++;
        }
        if (sampled !== textures.sample(material, x, y + 1)) verticalChanges++;
        if (sampled !== textures.sample(material, x + 1, y)) horizontalChanges++;
      }
    }
    expect(counts.size).toBe(palette.length);
    expect([...counts.keys()].sort()).toEqual(palette.map(entry => entry.join()).sort());
    const area = ISLAND_TEXTURE_SIZE ** 2;
    expect(detail / area).toBeGreaterThan(0.01);
    expect(detail / area).toBeLessThan(0.3);
    expect(connected / detail).toBeGreaterThan(0.9);
    expect(verticalChanges).toBeGreaterThan(100);
    expect(horizontalChanges).toBeGreaterThan(100);
    for (const entry of palette) {
      entry.forEach((value, channel) => {
        expect(Number.isInteger(value) && value >= 0 && value <= 255).toBe(true);
        expect(Math.abs(value - MATERIAL_COLORS[material][channel])).toBeLessThanOrEqual(22);
      });
    }
  });

  it('keeps material families distinguishable even at their nearest palette colors', () => {
    for (let a = 0; a < materials.length; a++) {
      for (let b = a + 1; b < materials.length; b++) {
        const distances = MATERIAL_PALETTES[materials[a]].flatMap(left =>
          MATERIAL_PALETTES[materials[b]].map(right =>
            Math.hypot(...left.map((channel, i) => channel - right[i]))));
        expect(Math.min(...distances)).toBeGreaterThan(8);
      }
    }
  });

  it('does not expose mutable cached colors and rejects invalid inputs', () => {
    const textures = createIslandTextures(0);
    expect(Object.isFrozen(MATERIAL_COLORS)).toBe(true);
    expect(Object.isFrozen(textures.sample('turf', 0, 0))).toBe(true);
    for (const invalid of [NaN, Infinity, -Infinity]) {
      expect(() => createIslandTextures(invalid)).toThrow(RangeError);
      expect(() => textures.sample('rock', invalid, 0)).toThrow(RangeError);
      expect(() => textures.sample('rock', 0, invalid)).toThrow(RangeError);
    }
    expect(() => textures.sample('unknown' as IslandMaterial, 0, 0)).toThrow(RangeError);
  });
});
