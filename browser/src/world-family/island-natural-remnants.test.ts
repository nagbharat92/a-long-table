import { describe, expect, it } from 'vitest';
import type { World } from './core/contracts';
import { ascentHeightAt, type IslandAscent, type IslandAscentSection } from './core/island-ascents';
import { cleanNaturalAscentRemnants, cleanNaturalBankFragments } from './core/island-natural-remnants';

function fixture(rectangles: { x: number; y: number; width: number; height: number }[]): {
  world: World; ascent: IslandAscent;
} {
  const width = 40, height = 40, tileSize = 4;
  const elevations = new Uint8Array(width * height);
  for (let y = 5; y < 25; y++) for (let x = 5; x < 25; x++) elevations[y * width + x] = 1;
  elevations[8 * width + 30] = 1;
  const world: World = {
    seed: 1, width, height, tileSize, seaLevel: 0,
    cells: new Uint8Array(width * height).fill(1), heights: new Float32Array(width * height).fill(0.5),
    elevations, elevationHeights: [0, 16], generatorVersion: 'remnant-fixture', provenance: 'test-fixture',
  };
  const banks: IslandAscentSection[] = rectangles.map(rect => ({
    from: 0, to: rect.width, fromWidth: rect.height, toWidth: rect.height,
    fromHeight: 0, toHeight: 0, role: 'slope',
    axis: { origin: { x: rect.x, y: rect.y + rect.height / 2 }, direction: { x: 1, y: 0 } },
  }));
  const x = Math.min(...rectangles.map(rect => rect.x)), y = Math.min(...rectangles.map(rect => rect.y));
  const ascent: IslandAscent = {
    id: 0, kind: 'gully', origin: { x, y }, direction: { x: 0, y: 1 },
    upperLevel: 1, lowerLevel: 0, upperHeight: 16, lowerHeight: 0,
    length: 0, topWidth: 8, bottomWidth: 8, stepCount: 0, sections: [], banks,
    bounds: {
      x, y, width: Math.max(...rectangles.map(rect => rect.x + rect.width)) - x,
      height: Math.max(...rectangles.map(rect => rect.y + rect.height)) - y,
    },
  };
  return { world, ascent };
}

describe('local cut-created remnant cleanup', () => {
  function bankFixture(x: number): ReturnType<typeof fixture> {
    const result = fixture([{ x, y: 60, width: 4, height: 4 }]);
    result.ascent.banks![0].fromHeight = result.ascent.banks![0].toHeight = 5;
    result.ascent.sections.push({
      from: 0, to: 8, fromWidth: 8, toWidth: 8, fromHeight: 5, toHeight: 5, role: 'pocket',
      axis: { origin: { x: 40, y: 44 }, direction: { x: 1, y: 0 } },
    });
    result.ascent.bounds = { x: 40, y: 40, width: x + 4 - 40, height: 24 };
    return result;
  }

  it('lowers a stranded bank blade at the outer rim, not just remnants at summit height', () => {
    const { world, ascent } = bankFixture(96);
    expect(ascentHeightAt(ascent, { x: 98, y: 62 })).toBe(5);
    expect(cleanNaturalBankFragments(world, ascent)).toBe(true);
    expect(ascentHeightAt(ascent, { x: 98, y: 62 })).toBe(0);
    expect(ascentHeightAt(ascent, { x: 44, y: 44 })).toBe(5);
    const copy = structuredClone(ascent);
    expect(cleanNaturalBankFragments(world, copy)).toBe(true);
    expect(copy).toEqual(ascent);
  });

  it('rejects an isolated bank fragment that has no safe connection to the lower ground', () => {
    const { world, ascent } = bankFixture(60), original = structuredClone(ascent);
    expect(cleanNaturalBankFragments(world, ascent)).toBe(false);
    expect(ascent).toEqual(original);
  });

  it('retains a bank attached to its own route plane', () => {
    const { world, ascent } = bankFixture(96);
    ascent.sections[0].axis!.origin = { x: 88, y: 62 };
    ascent.sections[0].fromWidth = ascent.sections[0].toWidth = 4;
    const original = structuredClone(ascent);
    expect(cleanNaturalBankFragments(world, ascent)).toBe(true);
    expect(ascent).toEqual(original);
  });

  it('absorbs a small isolated entrance cap into its adjoining bank, without changing source terrain', () => {
    const { world, ascent } = fixture([
      { x: 20, y: 92, width: 20, height: 4 },
      { x: 36, y: 96, width: 4, height: 4 },
    ]);
    const original = structuredClone(world);
    expect(ascentHeightAt(ascent, { x: 25, y: 99 })).toBeUndefined();
    expect(cleanNaturalAscentRemnants(world, ascent)).toBe(true);
    for (let y = 97; y < 100; y += 2) for (let x = 21; x < 36; x += 2) {
      expect(ascentHeightAt(ascent, { x, y })).toBe(0);
    }
    expect(ascentHeightAt(ascent, { x: 80, y: 80 })).toBeUndefined();
    expect(ascentHeightAt(ascent, { x: 122, y: 34 })).toBeUndefined();
    expect(world).toEqual(original);
  });

  it('also removes a newly thin finger even when it remains attached to the main mass', () => {
    const { world, ascent } = fixture([{ x: 24, y: 88, width: 12, height: 12 }]);
    expect(ascentHeightAt(ascent, { x: 21, y: 97 })).toBeUndefined();
    expect(cleanNaturalAscentRemnants(world, ascent)).toBe(true);
    expect(ascentHeightAt(ascent, { x: 21, y: 97 })).toBe(0);
    expect(ascentHeightAt(ascent, { x: 50, y: 70 })).toBeUndefined();
  });

  it('rejects a cut that would require erasing a substantial disconnected shoulder', () => {
    const { world, ascent } = fixture([{ x: 20, y: 60, width: 80, height: 4 }]);
    const original = structuredClone(ascent);
    expect(cleanNaturalAscentRemnants(world, ascent)).toBe(false);
    expect(ascent).toEqual(original);
  });

  it('does not erase a pre-existing narrow outcrop near an otherwise clean cut', () => {
    const { world, ascent } = fixture([{ x: 40, y: 92, width: 12, height: 8 }]);
    world.elevations![25 * world.width + 21] = 1;
    const original = structuredClone(world);
    expect(cleanNaturalAscentRemnants(world, ascent)).toBe(true);
    expect(ascentHeightAt(ascent, { x: 86, y: 102 })).toBeUndefined();
    expect(world).toEqual(original);
  });
});
