import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bushPixels, bushTones, generateBushPatch, MOUND_BASE, PATCH_SIZE, type BushPatch } from '../src/bush-patch/generation';
import { prepareCanopy } from '../src/bush-patch/canopy';
import { preparePatchRenderer } from '../src/bush-patch/renderer';
import { DEFAULT_TREE_WIND } from '../src/foliage-family/core/tree-motion';
import { DEFAULT_SUN } from '../src/world-family/render/island-sun';

describe('year-round warm shrub pockets', () => {
  it('preserves the approved geometry and original green palettes exactly', () => {
    const baselines = [
      [0, '1b676d699718cf4d2448acda4f32c18c695059ca77102dfa6458a3cc2dc4f6c9', '#647644'],
      [9, 'cbe99007dea27bd1ca0d893cf32f0b046d00f91002f059fbf18b84dd1b576643', '#77894f'],
      [17, 'dec737c69345f2b556ec9584fb5934cf18df5f8aced0a283421c5ff227851ed3', '#4f6d47'],
      [42, '17cca286a682296883bac57e93864c7f38ed8ab4664faf7579243de750ab9fe1', '#546d43'],
      [153031, '7f6a0d72ce82306de1b5907ab6ce2e6ad5f139188a6c5fa139171ddc82caf8fe', '#6e7e44'],
    ] as const;
    for (const [seed, hash, green] of baselines) {
      const patch = generateBushPatch(seed);
      const geometry = { footprint: patch.footprint, clusters: patch.clusters, forms: patch.clusterForms,
        bushes: patch.bushes.map(({ seed, cluster, x, y, depth, lobes }) => ({ seed, cluster, x, y, depth, lobes })) };
      expect(createHash('sha256').update(JSON.stringify(geometry)).digest('hex')).toBe(hash);
      expect(bushTones(0.5, seed, 'green')[2]).toBe(green);
    }
  });

  it('keeps green dominant, leaves some scenes entirely green and grows one connected edge pocket', () => {
    let greenOnly = 0, accented = 0;
    for (let seed = 0; seed < 300; seed++) {
      const patch = generateBushPatch(seed), warm = patch.bushes.filter(bush => bush.palette === 'warm');
      if (!warm.length) { greenOnly++; continue; }
      accented++;
      expect(warm.length).toBeGreaterThanOrEqual(3);
      expect(warm.length).toBeLessThanOrEqual(8);
      expect(warm.length / patch.bushes.length).toBeLessThanOrEqual(0.1);
      expect(new Set(warm.map(bush => bush.cluster)).size).toBe(1);
      const cluster = patch.bushes.filter(bush => bush.cluster === warm[0].cluster);
      expect(warm.length / cluster.length).toBeLessThanOrEqual(0.25);
      const reached = new Set([warm[0]]);
      for (let pass = 0; pass < warm.length; pass++) for (const bush of warm) {
        if ([...reached].some(neighbor => Math.hypot(bush.x - neighbor.x, bush.y - neighbor.y) <= 10)) reached.add(bush);
      }
      expect(reached.size).toBe(warm.length);
      const edge = warm.some(a => cluster.some(b => {
        if (a.x === b.x && a.y === b.y) return false;
        const cross = cluster.map(p => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
        return cross.every(value => value <= 0) || cross.every(value => value >= 0);
      }));
      expect(edge).toBe(true);
    }
    expect(greenOnly).toBeGreaterThan(30);
    expect(accented).toBeGreaterThan(150);
  });

  it('varies restrained ochre/tawny shades independently of depth rather than season or shadow', () => {
    const bases = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      const tones = bushTones(0.5, seed, 'warm');
      bases.add(tones[2]);
      expect(tones).toEqual(bushTones(1, seed, 'warm'));
      expect(tones).toEqual(bushTones(0, seed, 'warm'));
      const [r, g, b] = [1, 3, 5].map(i => parseInt(tones[2].slice(i, i + 2), 16));
      expect(r).toBeGreaterThan(g);
      expect(g).toBeGreaterThan(b);
      expect(r).toBeLessThan(170);
      expect(b).toBeGreaterThan(45);
      expect(tones[1]).not.toBe(tones[3]);
    }
    expect(bases.size).toBeGreaterThan(70);
    expect(() => Reflect.apply(bushTones, undefined, [0.5, 0, 'autumn'])).toThrow('Invalid bush palette.');
  });

  it('turns colour off without changing the raised foliage or its wind-deformed shadows', () => {
    const patch = [0, 9, 17, 42].map(generateBushPatch).find(patch => patch.bushes.some(bush => bush.palette === 'warm'))!;
    const ground = [184, 207, 206] as const;
    const render = preparePatchRenderer(patch, ground);
    const wind = { ...DEFAULT_TREE_WIND, strength: 6, preset: 2 };
    for (const time of [0, 8]) {
      const warmFrame = render(time, wind, DEFAULT_SUN), greenFrame = render(time, wind, DEFAULT_SUN, true, true, false);
      expect(warmFrame.pixels).not.toEqual(greenFrame.pixels);
      expect(warmFrame.groundShadowPixels).toBe(greenFrame.groundShadowPixels);
      expect(warmFrame.receiverShadowPixels).toBe(greenFrame.receiverShadowPixels);
    }
  });

  it('uses the visible warm crown silhouettes instead of an elliptical colour stencil', () => {
    const still = { ...DEFAULT_TREE_WIND, preset: 0 };
    for (const seed of [9, 17, 153031]) {
      const patch = generateBushPatch(seed);
      for (let cluster = 0; cluster < patch.clusters.length; cluster++) {
        const expected = new Set<number>();
        for (const bush of patch.bushes.filter(b => b.cluster === cluster)) {
          bushPixels(bush).forEach((row, y) => row.forEach((tone, x) => {
            if (!tone) return;
            const i = (y + bush.y - MOUND_BASE) * PATCH_SIZE.width + x + bush.x - 30;
            if (bush.palette === 'warm') expected.add(i); else expected.delete(i);
          }));
        }
        const frame = prepareCanopy(patch, cluster).draw(0, still);
        const actual = new Set(frame.surface.filter(p => p.region === 3).map(p => p.y * PATCH_SIZE.width + p.x));
        expect(actual).toEqual(expected);
        if (actual.size) {
          const heights = frame.surface.filter(p => p.region === 3).map(p => p.height);
          expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(2);
        }
      }
    }
  });

  it('makes green and warm internal colour boundaries follow crown contours', () => {
    const still = { ...DEFAULT_TREE_WIND, preset: 0 };
    for (let seed = 0; seed < 100; seed++) {
      const patch = generateBushPatch(seed);
      for (let cluster = 0; cluster < patch.clusters.length; cluster++) {
        const boundaries = new Set<number>();
        for (const bush of patch.bushes.filter(b => b.cluster === cluster)) {
          const pixels = bushPixels(bush);
          pixels.forEach((row, y) => row.forEach((tone, x) => {
            if (tone && (!row[x - 1] || !row[x + 1] || !pixels[y - 1]?.[x] || !pixels[y + 1]?.[x])) {
              boundaries.add((y + bush.y - MOUND_BASE) * PATCH_SIZE.width + x + bush.x - 30);
            }
          }));
        }
        const frame = prepareCanopy(patch, cluster).draw(0, still);
        const material = new Map(frame.surface.map(p => [p.y * PATCH_SIZE.width + p.x, p.region]));
        expect(new Set(frame.surface.map(p => p.greenRegion)).size).toBeLessThanOrEqual(3);
        for (const [i, region] of material) for (const offset of [1, PATCH_SIZE.width]) {
          const neighbor = material.get(i + offset);
          if (neighbor !== undefined && neighbor !== region) {
            expect(boundaries.has(i) || boundaries.has(i + offset), `seed ${seed}, material boundary ${i}`).toBe(true);
          }
        }
      }
    }
  });

  it('lets foreground green foliage hide the warm crown rather than painting brown over it', () => {
    const base = generateBushPatch(9), source = base.bushes[0];
    const warm = { ...source, seed: 1, x: 100, y: 160, cluster: 0, palette: 'warm' as const,
      lobes: [{ x: 30, y: 36, rx: 12, ry: 10 }] };
    const green = { ...source, seed: 2, x: 100, y: 164, cluster: 0, palette: 'green' as const,
      lobes: [{ x: 30, y: 36, rx: 10, ry: 8 }] };
    const patch: BushPatch = { ...base, bushes: [green, warm], clusters: [[{ x: 100, y: 160, rx: 20, ry: 18 }]],
      clusterForms: ['Compact'] };
    const frame = prepareCanopy(patch, 0).draw(0, { ...DEFAULT_TREE_WIND, preset: 0 });
    expect(frame.surface.find(p => p.x === 100 && p.y === 151)?.region).toBe(3);
    expect([0, 1, 2]).toContain(frame.surface.find(p => p.x === 100 && p.y === 160)?.region);
    const ordered = prepareCanopy({ ...patch, bushes: [warm, green] }, 0).draw(0, { ...DEFAULT_TREE_WIND, preset: 0 });
    expect(frame).toEqual(ordered);
  });
});
