import { describe, expect, it } from 'vitest';
import { MOSS_ASSET } from '../src/foliage-family/core/botanical-assets';
import { generateGroundArt, groundArtPixels, GROUND_ART_SIZE } from '../src/foliage-family/core/ground-pixel-art';

describe('moss family study', () => {
  it('keeps every moss shape, size, palette, facing and seed renderable', () => {
    expect(MOSS_ASSET.shapes).toEqual(['Low cushion', 'Rounded mound', 'Trailing strip']);
    expect(MOSS_ASSET.palettes.map(palette => palette.name)).toEqual([
      'Rainy emerald', 'Silver pincushion', 'Sunlit chartreuse',
    ]);
    for (const seed of [0, 112, 4294967295]) {
      const generated = generateGroundArt(MOSS_ASSET, seed);
      expect(generated.seed).toBe(seed);
      for (let shape = 0; shape < MOSS_ASSET.shapes.length; shape++) {
        for (let palette = 0; palette < MOSS_ASSET.palettes.length; palette++) {
          for (let size = 0; size < 3; size++) for (let facing = 0; facing < 2; facing++) {
            const pixels = groundArtPixels(MOSS_ASSET, { ...generated, shape, palette, size, facing });
            expect(pixels).toHaveLength(GROUND_ART_SIZE.height);
            expect(pixels.every(row => row.length === GROUND_ART_SIZE.width)).toBe(true);
            expect(pixels.flat().filter(Boolean).length).toBeGreaterThan(30);
            expect(pixels.flat().every(tone => tone >= 0 && tone < MOSS_ASSET.palettes[palette].tones.length)).toBe(true);
          }
        }
      }
    }
  });

  it('retains a shaded underside and broad lit upper plane for all three silhouettes', () => {
    const seed = generateGroundArt(MOSS_ASSET, 112);
    const shapes = MOSS_ASSET.shapes.map((_, shape) => groundArtPixels(MOSS_ASSET, {
      ...seed, shape, size: 2, facing: 0,
    }));
    for (const pixels of shapes) {
      expect(pixels.flat().filter(tone => tone === 1).length).toBeGreaterThan(10);
      expect(pixels.flat().filter(tone => tone === 3).length).toBeGreaterThan(10);
    }
    expect(new Set(shapes.map(pixels => JSON.stringify(pixels))).size).toBe(3);
  });
});
