import { describe, expect, it } from 'vitest';
import { generateBushPatch, PATCH_SIZE, type BushPatch } from '../src/bush-patch/generation';
import { prepareCanopy } from '../src/bush-patch/canopy';
import { preparePatchRenderer } from '../src/bush-patch/renderer';
import { DEFAULT_TREE_WIND } from '../src/foliage-family/core/tree-motion';
import { DEFAULT_SUN } from '../src/world-family/render/island-sun';

const ground = [184, 207, 206] as const;
const still = { ...DEFAULT_TREE_WIND, preset: 0 };
const bush = { ...generateBushPatch(9).bushes[0], x: 100, y: 180, cluster: 0,
  lobes: [{ x: 30, y: 36, rx: 14, ry: 12 }] };
const footprint = [{ x: 100, y: 180, rx: 14, ry: 14 }];
const patch: BushPatch = { ...generateBushPatch(9), bushes: [bush], clusters: [footprint], footprint, clusterForms: ['Compact'] };
const render = preparePatchRenderer(patch, ground, false);
const silhouette = prepareCanopy(patch, 0).draw(0, still).surface;

function sides(pixels: Uint8ClampedArray): [number, number] {
  const sums = [0, 0], counts = [0, 0];
  silhouette.forEach(point => {
    if (Math.abs(point.normal[0]) < 0.2 || point.normal[2] === 0) return;
    const side = point.normal[0] < 0 ? 0 : 1;
    const index = (point.y * PATCH_SIZE.width + point.x) * 4;
    sums[side] += pixels[index] + pixels[index + 1] + pixels[index + 2];
    counts[side]++;
  });
  return [sums[0] / counts[0], sums[1] / counts[1]];
}

describe('bush surface and cast-shadow lighting agreement', () => {
  it('moves the brighter face towards the sun even with cast shadows disabled', () => {
    const right = sides(render(0, still, { ...DEFAULT_SUN, azimuth: 0 }, false).pixels);
    const left = sides(render(0, still, { ...DEFAULT_SUN, azimuth: 180 }, false).pixels);
    expect(right[1] - right[0]).toBeGreaterThan(15);
    expect(left[0] - left[1]).toBeGreaterThan(15);
  });

  it('casts the shadow away from the same sun that lights the face', () => {
    for (const azimuth of [0, 180]) {
      const frame = render(0, still, { ...DEFAULT_SUN, azimuth, shadowMode: 'hard' });
      const occupied = new Set<number>();
      silhouette.forEach(point => occupied.add(point.y * PATCH_SIZE.width + point.x));
      let offset = 0, count = 0;
      for (let index = 0; index < frame.pixels.length / 4; index++) {
        if (occupied.has(index) || frame.pixels[index * 4] === ground[0]) continue;
        offset += index % PATCH_SIZE.width - bush.x;
        count++;
      }
      expect(count).toBeGreaterThan(0);
      expect((offset / count) * (azimuth === 0 ? -1 : 1)).toBeGreaterThan(0);
    }
  });

  it('does not bake directional highlights into unlit or ambient-only foliage', () => {
    const a = { ...DEFAULT_SUN, azimuth: 0 }, b = { ...DEFAULT_SUN, azimuth: 180 };
    expect(render(0, still, a, false, false).pixels).toEqual(render(0, still, b, false, false).pixels);
    expect(render(0, still, { ...a, intensity: 0 }, false).pixels)
      .toEqual(render(0, still, { ...b, intensity: 0 }, false).pixels);
    expect(render(0, still, { ...a, elevation: 10 }, false).pixels)
      .not.toEqual(render(0, still, { ...a, elevation: 85 }, false).pixels);
  });

  it('preserves reference-tree artwork and keeps lighting attached during wind', () => {
    const trees = preparePatchRenderer({ ...patch, bushes: [] }, ground, true);
    expect(trees(0, still, { ...DEFAULT_SUN, azimuth: 0 }, false).pixels)
      .toEqual(trees(0, still, { ...DEFAULT_SUN, azimuth: 180 }, false).pixels);
    const wind = { ...DEFAULT_TREE_WIND, strength: 6, preset: 2 };
    const rest = render(0, wind, DEFAULT_SUN, false).pixels;
    expect([2, 4, 6, 8, 10].some(time => !render(time, wind, DEFAULT_SUN, false).pixels.every((value, index) => value === rest[index]))).toBe(true);
  });
});
