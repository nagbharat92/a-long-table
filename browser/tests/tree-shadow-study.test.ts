import { describe, expect, it } from 'vitest';
import { generateTree } from '../src/foliage-family/core/tree-assets';
import { DEFAULT_TREE_WIND } from '../src/foliage-family/core/tree-motion';
import { prepareTreeShadowStudy, TREE_SHADOW_HEIGHT } from '../src/foliage-family/core/tree-shadow-study';
import { DEFAULT_SUN } from '../src/world-family/render/island-sun';

describe('tree shadow study', () => {
  const appearance = generateTree(9);
  const wind = { ...DEFAULT_TREE_WIND, preset: 0 };
  const ground = [184, 207, 206] as const;

  it('casts onto ground in the individual preview and onto neighboring trees in the existing layered preview', () => {
    const single = prepareTreeShadowStudy(appearance, false, ground)(0, wind, DEFAULT_SUN);
    const layered = prepareTreeShadowStudy(appearance, true, ground)(0, wind, DEFAULT_SUN);
    expect(single.pixels).toHaveLength(80 * TREE_SHADOW_HEIGHT * 4);
    expect(layered.pixels).toHaveLength(232 * TREE_SHADOW_HEIGHT * 4);
    expect(single.groundShadowPixels).toBeGreaterThan(0);
    expect(single.treeShadowPixels).toBe(0);
    expect(layered.groundShadowPixels).toBeGreaterThan(0);
    expect(layered.treeShadowPixels).toBeGreaterThan(0);
    expect([...single.pixels.slice((TREE_SHADOW_HEIGHT * 80 - 1) * 4)]).toEqual([...ground, 255]);
  });

  it('moves cast shadows with swaying source layers', () => {
    const scene = prepareTreeShadowStudy(appearance, true, ground);
    const breeze = { ...DEFAULT_TREE_WIND, strength: 6 };
    expect(scene(4, breeze, DEFAULT_SUN).pixels).not.toEqual(scene(0, breeze, DEFAULT_SUN).pixels);
  });

  it('uses every shared sun setting to change the projected light or shadows', () => {
    const scene = prepareTreeShadowStudy(appearance, true, ground);
    const original = scene(0, wind, DEFAULT_SUN).pixels;
    for (const change of [
      { azimuth: 50 }, { elevation: 80 }, { intensity: 0.5 }, { skyFill: 0.8 },
      { warmth: 0.9 }, { shadowStrength: 0 }, { softness: 7 },
      { shadowMode: 'hard' as const }, { mapSize: 2048 as const },
    ]) {
      expect(scene(0, wind, { ...DEFAULT_SUN, ...change }).pixels, JSON.stringify(change)).not.toEqual(original);
    }
    const unlit = scene(0, wind, { ...DEFAULT_SUN, intensity: 0 });
    expect(unlit.groundShadowPixels).toBe(0);
    expect(unlit.treeShadowPixels).toBe(0);
  });
});
