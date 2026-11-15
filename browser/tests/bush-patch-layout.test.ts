import { describe, expect, it, vi } from 'vitest';
import * as canopyModule from '../src/bush-patch/canopy';
import { stackedCanopyOffsets } from '../src/bush-patch/layout';
import { generateBushPatch, PATCH_SIZE } from '../src/bush-patch/generation';
import { preparePatchRenderer } from '../src/bush-patch/renderer';
import { DEFAULT_TREE_WIND } from '../src/foliage-family/core/tree-motion';
import { DEFAULT_SUN } from '../src/world-family/render/island-sun';

const still = { ...DEFAULT_TREE_WIND, preset: 0 };
const ground = [184, 207, 206] as const;

describe('stacked canopy comparison', () => {
  it('places actual silhouettes in a connected overlapping stack while retaining visible foliage', () => {
    for (const seed of [...Array.from({ length: 100 }, (_, seed) => seed), 147, 285, 726, 898, 908, 993]) {
      const patch = generateBushPatch(seed);
      const canopies = patch.clusters.map((_, i) => canopyModule.prepareCanopy(patch, i));
      const shapes = canopies.map(c => c.draw(0, still).surface), offsets = stackedCanopyOffsets(shapes, seed);
      expect(offsets).toEqual(stackedCanopyOffsets(shapes, seed));
      const masks = shapes.map((shape, owner) => new Set(shape.map(p => {
        const x = p.x + offsets[owner].x, y = p.y + offsets[owner].y;
        expect(x).toBeGreaterThanOrEqual(24); expect(x).toBeLessThanOrEqual(266);
        expect(y).toBeGreaterThanOrEqual(100); expect(y).toBeLessThanOrEqual(236);
        return y * PATCH_SIZE.width + x;
      })));
      const order = canopies.map((c, owner) => ({ owner, depth: c.baseY + offsets[owner].y })).sort((a, b) => a.depth - b.depth);
      const occupied = new Set<number>();
      for (const [rank, { owner }] of order.entries()) {
        if (rank) expect([...masks[owner]].some(p => occupied.has(p)), `seed ${seed}: actual silhouette overlap`).toBe(true);
        for (const p of masks[owner]) occupied.add(p);
        const later = new Set(order.slice(rank + 1).flatMap(({ owner }) => [...masks[owner]]));
        expect([...masks[owner]].filter(p => !later.has(p)).length / masks[owner].size).toBeGreaterThanOrEqual(0.45);
        const warm = shapes[owner].filter(p => p.region === 3).map(p => (p.y + offsets[owner].y) * PATCH_SIZE.width + p.x + offsets[owner].x);
        if (warm.length) expect(warm.filter(p => !later.has(p)).length / warm.length).toBeGreaterThanOrEqual(0.65);
      }
      expect(masks.reduce((sum, mask) => sum + mask.size, 0) - occupied.size).toBeGreaterThan(40);
    }
  });

  it('changes placement only and restores the exact spaced frame without regenerating the artwork', () => {
    const render = preparePatchRenderer(generateBushPatch(9), ground, false);
    const spaced = render(0, still, DEFAULT_SUN, false, false, true, 'spaced');
    const stacked = render(0, still, DEFAULT_SUN, false, false, true, 'stacked');
    expect(stacked.canopyOverlapPixels).toBeGreaterThan(40);
    expect(spaced.canopyOverlapPixels).toBe(0);
    expect(stacked.foliagePixels).toBeLessThan(spaced.foliagePixels);
    expect(stacked.pixels).not.toEqual(spaced.pixels);
    expect(render(0, still, DEFAULT_SUN, false, false, true, 'spaced')).toEqual(spaced);
    expect(render(0, still, DEFAULT_SUN, false, false, true, 'stacked')).toEqual(stacked);
  });

  it('paints the foreground canopy at overlapping pixels instead of interleaving whole patches', () => {
    const patch = generateBushPatch(9), canopies = patch.clusters.map((_, i) => canopyModule.prepareCanopy(patch, i));
    const shapes = canopies.map(c => c.draw(0, still).surface), offsets = stackedCanopyOffsets(shapes, patch.seed);
    const layers = new Map<number, { depth: number; point: canopyModule.CanopyPoint }[]>();
    shapes.forEach((shape, owner) => shape.forEach(point => {
      const index = (point.y + offsets[owner].y) * PATCH_SIZE.width + point.x + offsets[owner].x;
      const list = layers.get(index) ?? [];
      list.push({ depth: canopies[owner].baseY + offsets[owner].y, point }); layers.set(index, list);
    }));
    const frame = preparePatchRenderer(patch, ground, false)(0, still, DEFAULT_SUN, false, false, true, 'stacked');
    let checked = 0;
    for (const [index, samples] of layers) {
      if (samples.length < 2) continue;
      const point = samples.sort((a, b) => a.depth - b.depth).at(-1)!.point;
      const light = (point.crease ? 0.88 : 1) * (point.height < 1 ? 0.92 : 1);
      expect([...frame.pixels.slice(index * 4, index * 4 + 3)]).toEqual(point.rgb.map(c => Math.round(c * light)));
      checked++;
    }
    expect(checked).toBeGreaterThan(40);
  });

  it('does not apply a hidden rear receiver shadow to an unshadowed foreground canopy', () => {
    const point = (x: number, y: number, groundY: number, height: number): canopyModule.CanopyPoint => ({
      x, y, groundY, height, normal: [0, 0, 1], rgb: [110, 130, 75], green: [110, 130, 75],
      crease: false, region: 0, greenRegion: 0,
    });
    const back = point(100, 150, 170, 20), caster = point(105, 120, 170, 50), front = point(100, 150, 150, 0);
    const spy = vi.spyOn(canopyModule, 'prepareCanopy').mockImplementation((_, cluster) => ({
      baseY: cluster ? 190 : 180, creaseCount: 0,
      draw: () => cluster ? { surface: [front], tops: [front] } : { surface: [back], tops: [back, caster] },
    }));
    try {
      const patch = generateBushPatch(9);
      const render = preparePatchRenderer({ ...patch, clusters: patch.clusters.slice(0, 2), bushes: patch.bushes.filter(b => b.cluster < 2) }, ground, false);
      const sun = { ...DEFAULT_SUN, azimuth: 0, shadowMode: 'hard' as const };
      const lit = render(0, still, sun), clear = render(0, still, sun, false);
      const index = (150 * PATCH_SIZE.width + 100) * 4;
      expect(lit.receiverShadowPixels).toBeGreaterThan(0);
      expect([...lit.pixels.slice(index, index + 4)]).toEqual([...clear.pixels.slice(index, index + 4)]);
    } finally { spy.mockRestore(); }
  });

  it('rejects invalid layouts and bounds failure rather than silently reverting to spaced placement', () => {
    expect(() => stackedCanopyOffsets([[]], 0)).toThrow('populated pixel silhouettes');
    expect(() => stackedCanopyOffsets([], NaN)).toThrow('Invalid canopy layout seed');
    const point = canopyModule.prepareCanopy(generateBushPatch(9), 0).draw(0, still).surface[0];
    const oversized = [{ ...point, x: 0, y: 0 }, { ...point, x: PATCH_SIZE.width - 1, y: PATCH_SIZE.height - 1 }];
    expect(() => stackedCanopyOffsets([oversized, oversized], 0)).toThrow('Could not stack these canopies');
    const render = preparePatchRenderer(generateBushPatch(9), ground);
    expect(() => Reflect.apply(render, undefined, [0, still, DEFAULT_SUN, true, true, true, 'unknown']))
      .toThrow('Invalid patch layout');
  });
});
