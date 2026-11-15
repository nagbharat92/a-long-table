import { describe, expect, it } from 'vitest';
import { prepareCanopy } from '../src/bush-patch/canopy';
import { bushPixels, generateBushPatch, MOUND_BASE, PATCH_SIZE } from '../src/bush-patch/generation';
import { preparePatchRenderer } from '../src/bush-patch/renderer';
import { DEFAULT_TREE_WIND } from '../src/foliage-family/core/tree-motion';
import { DEFAULT_SUN } from '../src/world-family/render/island-sun';

const still = { ...DEFAULT_TREE_WIND, preset: 0 };
const ground = [184, 207, 206] as const;

describe('continuous patch canopies', () => {
  it('renders one connected mass per footprint, not a sprite or crease around every control site', () => {
    for (let seed = 0; seed < 100; seed++) {
      const patch = generateBushPatch(seed);
      for (let cluster = 0; cluster < patch.clusters.length; cluster++) {
        const canopy = prepareCanopy(patch, cluster), frame = canopy.draw(0, still);
        const mask = new Set(frame.surface.map(p => p.y * PATCH_SIZE.width + p.x));
        const original = new Set<number>();
        for (const bush of patch.bushes.filter(bush => bush.cluster === cluster)) {
          bushPixels(bush).forEach((row, y) => row.forEach((tone, x) => {
            if (tone) original.add((y + bush.y - MOUND_BASE) * PATCH_SIZE.width + x + bush.x - 30);
          }));
        }
        expect([...original].every(pixel => mask.has(pixel))).toBe(true);
        expect(mask.size / original.size).toBeLessThan(1.04);
        const start = mask.values().next().value!;
        const seen = new Set([start]), pending = [start];
        while (pending.length) {
          const point = pending.pop()!;
          for (const offset of [-385, -384, -383, -1, 1, 383, 384, 385]) {
            const next = point + offset;
            if (mask.has(next) && !seen.has(next)) { seen.add(next); pending.push(next); }
          }
        }
        expect(seen.size, `seed ${seed}, canopy ${cluster}`).toBe(mask.size);
        expect(mask.size).toBeGreaterThan(100);
        expect(canopy.creaseCount).toBeLessThanOrEqual(8);
        expect(frame.surface.filter(p => p.crease).length / frame.surface.length).toBeLessThan(0.06);
        expect(canopy.creaseCount / patch.bushes.filter(bush => bush.cluster === cluster).length).toBeLessThan(0.2);
        for (const point of frame.surface) {
          expect(point.x).toBeGreaterThanOrEqual(0); expect(point.x).toBeLessThan(PATCH_SIZE.width);
          expect(point.y).toBeGreaterThanOrEqual(0); expect(point.y).toBeLessThan(PATCH_SIZE.height);
          expect(point.height).toBeGreaterThanOrEqual(0);
          expect(point.height).toBeLessThan(14);
          expect(Math.hypot(...point.normal)).toBeCloseTo(1, 5);
        }
      }
    }
  });

  it('moves colour, creases, normals and shadow-casting tops with the shared wind field', () => {
    const canopy = prepareCanopy(generateBushPatch(9), 0), rest = canopy.draw(0, DEFAULT_TREE_WIND);
    expect(rest).toEqual(canopy.draw(0, still));
    expect(canopy.draw(4, still)).toEqual(rest);
    const wind = { ...DEFAULT_TREE_WIND, strength: 6, preset: 2 };
    const moving = [2, 4, 6, 8, 10].map(time => canopy.draw(time, wind));
    expect(moving.some(frame => frame.surface.some((p, i) => p.x !== rest.surface[i].x))).toBe(true);
    for (const frame of moving) {
      expect(frame.surface.map(p => [p.y, p.height, p.normal, p.rgb, p.crease]))
        .toEqual(rest.surface.map(p => [p.y, p.height, p.normal, p.rgb, p.crease]));
      expect(frame.tops.some((p, i) => p.x !== rest.tops[i].x) || frame.surface.every((p, i) => p.x === rest.surface[i].x)).toBe(true);
      const base = rest.surface.filter(p => p.y === canopy.baseY);
      expect(frame.surface.filter(p => p.y === canopy.baseY)).toEqual(base);
    }
    expect(() => canopy.draw(NaN, wind)).toThrow();
    expect(() => prepareCanopy({ ...generateBushPatch(9), bushes: [] }, 0)).toThrow('populated footprint');
  });

  it('uses only a few canopy render objects with broad uninterrupted interior coverage', () => {
    for (const seed of [0, 9, 17, 42, 153031]) {
      const patch = generateBushPatch(seed);
      const frame = preparePatchRenderer(patch, ground, false)(0, still, DEFAULT_SUN);
      expect(frame.canopyCount).toBe(patch.clusters.length);
      expect(frame.canopyCount).toBeLessThan(patch.bushes.length / 10);
      expect(frame.foliagePixels).toBeGreaterThan(500);
      expect(frame.creasePixels / frame.foliagePixels).toBeLessThan(0.06);
      expect(frame.pixels.every(Number.isFinite)).toBe(true);
    }
  });
});
