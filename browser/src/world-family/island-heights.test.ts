import { describe, expect, it } from 'vitest';
import type { World } from './core/contracts';
import { ISLAND_HEIGHT_PALETTE, islandHeightAtLevel, islandLevelHeights, validateIslandHeights } from './core/island-heights';
import { buildIslandLandform, islandSurfaceHeight } from './core/island-landform';
import { createIslandAscents, ISLAND_STAIR_MAX_RISER, ISLAND_STAIR_MIN_TREAD } from './core/island-ascents';
import { createIslandEnvironment } from './render/island-environment';
import { islandLevelPalette } from './render/island-level-palette';

function fixture(): World {
  const width = 8, height = 8;
  return {
    seed: 12, width, height, tileSize: 4, seaLevel: 0, generatorVersion: 'height-fixture', provenance: 'test-fixture',
    cells: new Uint8Array(width * height).fill(1), heights: new Float32Array(width * height).fill(0.5),
    elevations: Uint8Array.from({ length: width * height }, (_, i) => Math.min(i % width, ISLAND_HEIGHT_PALETTE.length - 1)),
    elevationHeights: [...ISLAND_HEIGHT_PALETTE], rampIds: new Int32Array(width * height).fill(-1), ramps: [],
  };
}

describe('physical terrace heights', () => {
  it('uses the entire allowed height palette instead of interpreting logical levels as fixed heights', () => {
    const world = fixture(), before = structuredClone(world), island = buildIslandLandform(world);
    for (let level = 0; level < ISLAND_HEIGHT_PALETTE.length; level++) {
      const cell = { x: level, y: 3 }, point = { x: (level + 0.5) * 4, y: 14 };
      expect(islandSurfaceHeight(world, cell, point, island.ascents, island.edges, island.beach, island.shoulders)).toBe(level * 8);
    }
    const topHeights = new Set(island.triangles.filter(triangle => triangle.plane === 'top').flatMap(triangle => triangle.vertices.map(point => point.z)));
    expect(topHeights).toEqual(new Set(ISLAND_HEIGHT_PALETTE));
    expect(world).toEqual(before);
  });

  it('renders all logical levels in the elevation plan without missing palette colors', () => {
    const world = fixture(), island = buildIslandLandform(world);
    const frame = createIslandEnvironment(island).render('plan', { width: 48, height: 48, origin: { x: 4, y: 4 } });
    for (let level = 0; level < ISLAND_HEIGHT_PALETTE.length; level++) {
      const index = 18 * 48 + 4 + (level + 0.5) * 4;
      expect(frame.raster.levels[index]).toBe(level);
    }
    const colors = islandLevelPalette(world, [211, 217, 184], [112, 142, 120]);
    expect(colors).toHaveLength(ISLAND_HEIGHT_PALETTE.length);
    expect(colors[0]).toEqual([211, 217, 184]);
    expect(colors.at(-1)).toEqual([145, 167, 141]);
    const lowIndex = (18 * 48 + 6) * 4, highIndex = (18 * 48 + 4 + (ISLAND_HEIGHT_PALETTE.length - 0.5) * 4) * 4;
    expect(Array.from(frame.raster.pixels.slice(lowIndex, lowIndex + 3))).toEqual(colors[0]);
    expect(Array.from(frame.raster.pixels.slice(highIndex, highIndex + 3))).toEqual(colors.at(-1));
  });

  it('adapts stair rise and riser count to selected heights, including logical levels above two', () => {
    for (const [upperLevel, lowerLevel, heights] of [
      [1, 0, [0, 8]], [3, 2, [0, 8, 24, 32]],
    ] as const) {
      const width = 40, height = 40;
      const world: World = {
        seed: 12, width, height, tileSize: 4, seaLevel: 0, generatorVersion: 'stair-height-fixture', provenance: 'test-fixture',
        cells: new Uint8Array(width * height).fill(1), heights: new Float32Array(width * height).fill(0.5),
        elevationHeights: heights,
        elevations: Uint8Array.from({ length: width * height }, (_, i) => i % width <= 21 ? upperLevel : lowerLevel),
        cliffCells: new Uint8Array(width * height),
        ramps: [{
          highCell: { x: 20, y: 20 }, lowCell: { x: 23, y: 20 }, direction: { x: 1, y: 0 },
          upperLevel, lowerLevel, rect: { x: 20, y: 19, width: 4, height: 3 },
        }],
      };
      const [ascent] = createIslandAscents(world);
      expect(ascent.upperHeight).toBe(heights[upperLevel]);
      expect(ascent.lowerHeight).toBe(heights[lowerLevel]);
      expect(ascent.sections.every(section => section.fromHeight === section.toHeight)).toBe(true);
      const minimumSteps = Math.ceil((ascent.upperHeight - ascent.lowerHeight) / ISLAND_STAIR_MAX_RISER);
      expect(ascent.stepCount).toBeGreaterThanOrEqual(minimumSteps);
      expect(ascent.stepCount).toBeLessThanOrEqual(minimumSteps + 3);
      expect(ascent.sections.filter(section => section.role === 'tread').every(section =>
        section.to - section.from >= ISLAND_STAIR_MIN_TREAD - 1e-8)).toBe(true);
    }
  });

  it('retains the V1 height mapping when no V2 composition is present', () => {
    const world = fixture();
    delete world.elevationHeights;
    expect(islandLevelHeights(world)).toEqual([0, 20, 48]);
    expect(islandHeightAtLevel(world, 1)).toBe(20);
    expect(islandHeightAtLevel(world, 2)).toBe(48);
  });

  it.each([[8, 16], [0, 12], [0, 16, 8], [0, 8, 8], [0, 40], [0, 48], [0, 56], []].map(heights => ({ heights })))('rejects invalid V2 heights $heights explicitly', ({ heights }) => {
    const world = { ...fixture(), elevationHeights: heights };
    expect(() => validateIslandHeights(world)).toThrow('multiples of eight');
    expect(() => buildIslandLandform(world)).toThrow('multiples of eight');
  });

  it('rejects levels outside the selected composition instead of substituting a height', () => {
    const world = fixture();
    expect(() => islandHeightAtLevel(world, 7)).toThrow('no valid surface height');
    expect(() => islandHeightAtLevel(world, -1)).toThrow('no valid surface height');
    world.elevationHeights = [0, 8];
    expect(() => buildIslandLandform(world)).toThrow('no valid surface height');
  });
});
