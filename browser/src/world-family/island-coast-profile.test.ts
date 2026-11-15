import { describe, expect, it } from 'vitest';
import { islandCoastInfluence, type IslandProceduralCoast } from './core/island-coast-profile';
import { islandCoveInfluence, type IslandCove } from './core/island-cove';

describe('shared procedural coastal profile', () => {
  it('samples a cloneable world-space mask without restricting it to one ellipse or seed', () => {
    const profile: IslandProceduralCoast = {
      kind: 'procedural', gradeWidth: 24, shelfWidth: 52, shelfDepth: 2, focus: { x: 0, y: 0 }, regions: [],
      mask: { origin: { x: -2, y: -2 }, spacing: 2, width: 3, height: 3,
        weights: new Float32Array([0, 0, 0, 0, 1, 1, 0, 1, 1]) },
    };
    expect(islandCoastInfluence(profile, 0, 0)).toBe(1);
    expect(islandCoastInfluence(profile, -1, -1)).toBe(0.25);
    expect(islandCoastInfluence(profile, 1, 1)).toBe(1);
    expect(islandCoastInfluence(profile, -3, 0)).toBe(0);
    expect(islandCoastInfluence(profile, 3, 0)).toBe(0);
    expect(islandCoastInfluence(structuredClone(profile), -1, -1)).toBe(0.25);
    expect(() => islandCoastInfluence(profile, NaN, 0)).toThrow(RangeError);
  });

  it('retains the manual cove as an internal regression profile', () => {
    const cove: IslandCove = {
      center: { x: 260, y: 128 }, radius: { x: 56, y: 40 }, rotation: -0.12,
      gradeWidth: 24, shelfWidth: 52, shelfDepth: 2, focus: { x: 324, y: 108 },
    };
    for (const [x, y] of [[316, 116], [200, 124], [340, 112], [296, 168]]) {
      expect(islandCoastInfluence(cove, x, y)).toBe(islandCoveInfluence(cove, x, y));
    }
  });
});
