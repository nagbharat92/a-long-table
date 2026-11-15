import { describe, expect, it } from 'vitest';
import { BERRY_LAYOUTS, BUSH_PALETTES, BUSH_SHAPES, berryPositions, bushLeafAt, generateBush } from '../src/foliage-family/core/bush-appearance';
import { BushCrop } from '../src/foliage-family/core/bush-crop';
import { FOLIAGE_PALETTES } from '../src/foliage-family/core/foliage-palettes';

describe('berry bush family pass', () => {
  it('keeps bush palettes independent of unchanged grass palettes', () => {
    expect(BUSH_PALETTES.map(palette => palette.name)).toEqual(['Woodland', 'Sage', 'Blue spruce', 'Autumn']);
    expect(FOLIAGE_PALETTES[0]).toEqual({
      name: 'Woodland', ink: '#254b37', leaf: '#44864b', light: '#79b958', bud: '#b0cd79',
    });
    expect(BUSH_PALETTES[0].leaf).not.toBe(FOLIAGE_PALETTES[0].leaf);
  });

  it('retains the three silhouettes and places the requested berries across seeds and layouts', () => {
    expect(BUSH_SHAPES.map(shape => shape.name)).toEqual(['Upright shrub', 'Spreading bush', 'Forked tree']);
    for (const seed of [...Array.from({ length: 256 }, (_, value) => value), 4294967295]) {
      const generated = generateBush(seed);
      expect(generateBush(seed)).toEqual(generated);
      for (let shape = 0; shape < BUSH_SHAPES.length; shape++) {
        for (let layout = 0; layout < BERRY_LAYOUTS.length; layout++) {
          const appearance = { ...generated, shape, layout, count: 12 };
          const positions = berryPositions(appearance);
          expect(positions).toHaveLength(12);
          expect(new Set(positions.map(point => `${point.x},${point.y}`)).size).toBe(12);
          const crop = new BushCrop(appearance);
          crop.setState('ripe');
          expect(crop.available).toBe(12);
          crop.gather();
          crop.advance(1);
          expect(crop.collected).toBe(12);
        }
      }
    }
  });

  it('changes the actual leaf silhouette across seeds while keeping each seed reproducible', () => {
    const silhouette = (seed: number, shape: number) => {
      const appearance = { ...generateBush(seed), shape };
      return Array.from({ length: 48 }, (_, y) =>
        Array.from({ length: 40 }, (_, x) => bushLeafAt(appearance, x, y) || ' ').join('')).join('\n');
    };
    for (let shape = 0; shape < BUSH_SHAPES.length; shape++) {
      const variants = [0, 42, 112].map(seed => silhouette(seed, shape));
      expect(new Set(variants).size).toBeGreaterThan(1);
      expect(silhouette(42, shape)).toBe(variants[1]);
    }
  });
});
