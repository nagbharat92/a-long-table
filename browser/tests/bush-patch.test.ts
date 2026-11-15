import { describe, expect, it } from 'vitest';
import { bushPixels, bushTones, generateBushPatch, MOUND_BASE, MOUND_SIZE, PATCH_SIZE, patchSeed, prepareBushMotion } from '../src/bush-patch/generation';
import { preparePatchRenderer } from '../src/bush-patch/renderer';
import { DEFAULT_TREE_WIND } from '../src/foliage-family/core/tree-motion';
import { DEFAULT_SUN } from '../src/world-family/render/island-sun';
import { resolveRoute } from '../src/pilot/directory';

describe('whole bush patch generation', () => {
  it('reproduces seeds, routes and named seeds without altering the berry-bush route', () => {
    expect(generateBushPatch(9)).toEqual(generateBushPatch(9));
    expect(patchSeed('canopy')).toBe(patchSeed('canopy'));
    expect(patchSeed('42')).toBe(42);
    expect(() => patchSeed('')).toThrow();
    expect(() => generateBushPatch(NaN)).toThrow();
    expect(resolveRoute('/bush-patch', new URLSearchParams())).toBe('bush-patch');
    expect(resolveRoute('/foliage', new URLSearchParams('tab=bush-patch'))).toBe('bush-patch');
    expect(resolveRoute('/foliage', new URLSearchParams('tab=bush'))).toBe('foliage');
  });

  it('varies footprint, spacing, low lobes and depth on 300 seeds without invalid bounds or rows', () => {
    const forms = new Set<string>(), silhouettes = new Set<string>(), counts = new Set<number>();
    for (let seed = 0; seed < 300; seed++) {
      const patch = generateBushPatch(seed);
      forms.add(patch.form); counts.add(patch.bushes.length); silhouettes.add(JSON.stringify(patch.footprint));
      expect(patch.bushes.length).toBeGreaterThan(12);
      expect(patch.bushes.length).toBeLessThanOrEqual(100);
      expect(new Set(patch.bushes.map(bush => bush.y)).size).toBeGreaterThan(7);
      let previous = -Infinity;
      for (const bush of patch.bushes) {
        expect(bush.x).toBeGreaterThanOrEqual(28); expect(bush.x).toBeLessThanOrEqual(256);
        expect(bush.y).toBeGreaterThanOrEqual(132); expect(bush.y).toBeLessThanOrEqual(214);
        expect(bush.depth).toBeGreaterThanOrEqual(previous); previous = bush.depth;
        for (const lobe of bush.lobes) {
          expect(Object.values(lobe).every(Number.isFinite)).toBe(true);
          expect(lobe.rx).toBeGreaterThan(0);
          expect(lobe.x - lobe.rx).toBeGreaterThan(-3);
          expect(lobe.x + lobe.rx).toBeLessThan(MOUND_SIZE.width + 3);
          expect(lobe.y - lobe.ry).toBeGreaterThan(-2);
        }
      }
    }
    expect(forms.size).toBe(4); expect(silhouettes.size).toBe(300); expect(counts.size).toBeGreaterThan(10);
  });

  it('uses smaller single domes with varied proportions and a tight palette, not elaborate crowns', () => {
    const proportions = new Set<string>();
    for (const seed of [0, 9, 17, 42, 153031]) for (const bush of generateBushPatch(seed).bushes) {
      const pixels = bushPixels(bush), tones = bushTones(bush.depth, bush.seed);
      expect(bush.lobes).toHaveLength(1);
      const lobe = bush.lobes[0];
      expect(lobe.rx).toBeLessThanOrEqual(14);
      expect(lobe.ry).toBeLessThanOrEqual(15);
      proportions.add(lobe.rx / lobe.ry < 0.7 ? 'upright' : lobe.rx / lobe.ry > 1.3 ? 'squat' : 'round');
      expect(pixels).toHaveLength(MOUND_SIZE.height);
      const nonempty = pixels.flat().filter(Boolean);
      expect(nonempty.length).toBeGreaterThan(12);
      expect(nonempty.every(tone => tone >= 1 && tone <= 3)).toBe(true);
      expect(tones.every(tone => tone !== '#000000')).toBe(true);
      expect(nonempty.filter(tone => tone === 2).length).toBeGreaterThan(nonempty.filter(tone => tone === 3).length);
      expect(pixels.slice(MOUND_BASE + 1).flat().every(tone => tone === 0)).toBe(true);
    }
    expect(proportions.size).toBe(3);
    const channels = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const far = channels(bushTones(0)[2]), near = channels(bushTones(1)[2]);
    near.forEach((value, index) => expect(value - far[index]).toBeLessThanOrEqual(45));
    for (const depth of [0, 0.5, 1]) {
      const base = channels(bushTones(depth)[2]);
      expect(base[1]).toBeGreaterThan(base[0]);
      expect(Math.max(...base)).toBeLessThan(150);
    }
  });

  it('keeps independent shape metadata and populated groups aligned across 300 seeds', () => {
    for (let seed = 0; seed < 300; seed++) {
      const patch = generateBushPatch(seed);
      expect(patch.clusters.length).toBeGreaterThanOrEqual(2);
      expect(patch.clusters.length).toBeLessThanOrEqual(3);
      expect(patch.clusterForms).toHaveLength(patch.clusters.length);
      expect(new Set(patch.clusterForms).size).toBe(patch.clusters.length);
      expect(patch.footprint).toEqual(patch.clusters.flat());
      for (let cluster = 0; cluster < patch.clusters.length; cluster++) {
        const members = patch.bushes.filter(bush => bush.cluster === cluster);
        expect(members.length).toBeGreaterThan(15);
        expect(patch.clusters[cluster].length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('mixes seeded local shades rather than mapping each depth to a smooth gradient', () => {
    const channels = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const brightness = (hex: string) => channels(hex).reduce((sum, value) => sum + value);
    for (const depth of [0, 0.5, 1]) {
      const tones = Array.from({ length: 100 }, (_, seed) => bushTones(depth, seed)[2]);
      expect(new Set(tones).size).toBeGreaterThan(70);
      for (const tone of tones) {
        const rgb = channels(tone);
        expect(rgb[1]).toBeGreaterThan(rgb[0]);
        expect(rgb[0]).toBeGreaterThan(rgb[2]);
        expect(Math.max(...rgb)).toBeLessThan(150);
      }
    }
    const average = (depth: number) => Array.from({ length: 1000 }, (_, seed) => brightness(bushTones(depth, seed)[2]))
      .reduce((sum, value) => sum + value) / 1000;
    expect(average(1)).toBeGreaterThan(average(0));
    for (const seed of [0, 9, 17, 42, 153031]) {
      const patch = generateBushPatch(seed);
      const shades = patch.bushes.map(bush => brightness(bushTones(bush.depth, bush.seed)[2]));
      expect(shades.filter((shade, index) => index > 0 && shade < shades[index - 1]).length).toBeGreaterThan(15);
      expect(bushTones(0.5, seed)).toEqual(bushTones(0.5, seed));
    }
    expect(() => bushTones(NaN)).toThrow();
    expect(() => bushTones(1.1)).toThrow();
  });

  it('anchors lower rows, starts at rest and validates shared wind ranges', () => {
    const bush = generateBushPatch(9).bushes[5], motion = prepareBushMotion(bush), rest = bushPixels(bush);
    expect(motion(0, DEFAULT_TREE_WIND)).toEqual(rest);
    expect(motion(4, { ...DEFAULT_TREE_WIND, preset: 0 })).toEqual(rest);
    const windy = { ...DEFAULT_TREE_WIND, strength: 6, preset: 2 };
    expect([2, 4, 6, 8, 10].some(time => JSON.stringify(motion(time, windy)) !== JSON.stringify(rest))).toBe(true);
    expect(motion(8, windy).slice(MOUND_BASE - 4)).toEqual(rest.slice(MOUND_BASE - 4));
    expect(() => motion(NaN, windy)).toThrow();
    expect(() => motion(1, { ...windy, strength: 7 })).toThrow();
  });
});

describe('bush patch pixel renderer', () => {
  const ground = [184, 207, 206] as const;
  const still = { ...DEFAULT_TREE_WIND, preset: 0 };
  const render = preparePatchRenderer(generateBushPatch(9), ground);

  it('casts ground and actual world-ordered neighbor shadows and keeps ground with either toggle off', () => {
    const frame = render(0, still, DEFAULT_SUN);
    expect(frame.groundShadowPixels).toBeGreaterThan(0);
    expect(frame.receiverShadowPixels).toBeGreaterThan(0);
    expect(frame.pixels).toHaveLength(PATCH_SIZE.width * PATCH_SIZE.height * 4);
    for (const candidate of [frame, render(0, still, DEFAULT_SUN, false), render(0, still, DEFAULT_SUN, true, false)]) {
      expect([...candidate.pixels.slice(-4)]).toEqual([...ground, 255]);
      expect(candidate.pixels.every(Number.isFinite)).toBe(true);
      for (let i = 3; i < candidate.pixels.length; i += 4) expect(candidate.pixels[i]).toBe(255);
    }
    expect(render(0, still, DEFAULT_SUN, false).groundShadowPixels).toBe(0);
    expect(render(0, still, DEFAULT_SUN, false).receiverShadowPixels).toBe(0);
    expect(render(0, still, DEFAULT_SUN, true, false).pixels).toEqual(render(0, still, DEFAULT_SUN, false, false).pixels);
    expect(render(0, still, DEFAULT_SUN, false).pixels).not.toEqual(frame.pixels);
  });

  it('every sun control affects real pixels, not just state', () => {
    const original = render(0, still, DEFAULT_SUN).pixels;
    for (const change of [
      { azimuth: 50 }, { elevation: 80 }, { intensity: 0.5 }, { skyFill: 0.8 }, { warmth: 0.9 },
      { shadowStrength: 0 }, { softness: 7 }, { shadowMode: 'hard' as const }, { mapSize: 2048 as const },
    ]) expect(render(0, still, { ...DEFAULT_SUN, ...change }).pixels, JSON.stringify(change)).not.toEqual(original);
    expect(() => render(0, still, { ...DEFAULT_SUN, elevation: NaN })).toThrow();
  });

  it('shadows follow wind-deformed pixels, comparison trees are optional, and renders many seeds', () => {
    const wind = { ...DEFAULT_TREE_WIND, strength: 6, preset: 2 };
    const a = render(0, wind, DEFAULT_SUN), b = render(8, wind, DEFAULT_SUN);
    expect(a.pixels).not.toEqual(b.pixels);
    expect(a.groundShadowPixels).not.toBe(b.groundShadowPixels);
    const bushOnly = preparePatchRenderer(generateBushPatch(9), ground, false)(0, still, DEFAULT_SUN);
    expect(bushOnly.groundShadowPixels).toBeGreaterThan(0); expect(bushOnly.receiverShadowPixels).toBeGreaterThan(0);
    expect(bushOnly.pixels).not.toEqual(a.pixels);
    for (let seed = 0; seed < 20; seed++) {
      const frame = preparePatchRenderer(generateBushPatch(seed), ground, false)(4, wind, DEFAULT_SUN);
      expect(frame.pixels).toHaveLength(PATCH_SIZE.width * PATCH_SIZE.height * 4);
      expect(frame.groundShadowPixels).toBeGreaterThan(0);
      expect([...frame.pixels.slice(-4)]).toEqual([...ground, 255]);
    }
  });
});
