import { beforeAll, describe, expect, it } from 'vitest';
import { createIslandCove, islandCoveInfluence } from './core/island-cove';
import { generateIslandLandform, islandSurfaceHeight, type IslandLandform } from './core/island-landform';
import { createIslandShoreField } from './render/island-shore-field';
import { ISLAND_WATER_HEIGHT } from './core/island-water-level';
import { ISLAND_SEABED_HEIGHTS } from './core/island-seabed';
import { ISLAND_BEACH_HEIGHTS } from './core/island-beach-shelf';

let original: IslandLandform, pilot: IslandLandform;
beforeAll(() => {
  original = generateIslandLandform(153025, { coastalGeneration: false });
  pilot = generateIslandLandform(153025, { pilotCove: true });
});

describe('one-cove geometry study', () => {
  it('is opt-in, deterministic and does not mutate its input', () => {
    const snapshot = structuredClone(original.world);
    const result = createIslandCove(original.world, original.ascents);
    expect(original.world).toEqual(snapshot);
    expect(result.world).toEqual(pilot.world);
    expect(generateIslandLandform(153025, { coastalGeneration: false }).world).toEqual(snapshot);
    expect(pilot.cove).toEqual(result.cove);
    expect(original.cove).toBeUndefined();
    expect(pilot.world.generatorVersion).toMatch(/-cove-study-v1$/);
    expect(() => generateIslandLandform(77, { pilotCove: true })).toThrow(/seed 153025/);
  });

  it('excavates only local lowland and preserves highlands, stairs and their support', () => {
    const before = original.world, after = pilot.world;
    expect(after.elevations).toEqual(before.elevations);
    expect(after.elevationHeights).toEqual(before.elevationHeights);
    expect(after.rampIds).toEqual(before.rampIds);
    expect(after.ramps).toEqual(before.ramps);
    expect(pilot.ascents).toEqual(original.ascents);
    expect(pilot.edges).toEqual(original.edges);
    let carved = 0, widened = 0;
    for (let i = 0; i < before.cells.length; i++) {
      if (before.cells[i] === after.cells[i] && before.heights[i] === after.heights[i]) continue;
      const x = i % before.width, y = Math.floor(i / before.width);
      expect(x).toBeGreaterThanOrEqual(45);
      expect(x).toBeLessThan(90);
      expect(y).toBeGreaterThanOrEqual(16);
      expect(y).toBeLessThan(46);
      expect(before.elevations![i]).toBe(0);
      expect(before.rampIds![i]).toBe(-1);
      if (!after.cells[i]) carved++;
      else widened++;
    }
    expect(carved).toBeGreaterThan(80);
    expect(widened).toBeGreaterThan(80);
    for (const { bounds } of original.ascents) {
      for (let y = Math.floor(bounds.y / 4) - 2; y <= Math.ceil((bounds.y + bounds.height) / 4) + 2; y++) {
        for (let x = Math.floor(bounds.x / 4) - 2; x <= Math.ceil((bounds.x + bounds.width) / 4) + 2; x++) {
          const i = y * before.width + x;
          expect(after.cells[i]).toBe(before.cells[i]);
          expect(after.heights[i]).toBe(before.heights[i]);
        }
      }
    }
  });

  it('has broad shallow treads across the six-tile beach and a flat dry approach', () => {
    const at = (x: number) => islandSurfaceHeight(pilot.world, { x: Math.floor(x / 4), y: 29 },
      { x, y: 116 }, pilot.ascents, pilot.edges, pilot.beach, pilot.shoulders);
    expect(at(316)).toBe(ISLAND_WATER_HEIGHT);
    expect(at(340)).toBe(0);
    let flatSamples = 0;
    const levels = new Set<number>();
    for (let x = 316; x < 348; x++) {
      const a = at(x), b = at(x + 1);
      expect(b).toBeGreaterThanOrEqual(a);
      expect(b - a).toBeLessThanOrEqual(0.75);
      expect(ISLAND_BEACH_HEIGHTS).toContain(a);
      levels.add(a);
      if (a === b) flatSamples++;
      if (x >= 340) expect(a).toBe(0);
    }
    expect(flatSamples).toBeGreaterThanOrEqual(24);
    expect(levels.size).toBe(5);
    // Four tiles of clear lowland width connect the dry beach inland.
    for (let y = 26; y < 30; y++) for (let x = 84; x < 92; x++) {
      const i = y * pilot.world.width + x;
      expect(pilot.world.cells[i]).toBe(1);
      expect(pilot.world.elevations![i]).toBe(0);
      expect(pilot.world.cliffCells![i]).toBe(0);
    }
  });

  it('joins the unchanged beach waterline to a broad sequence of flat submerged steps', () => {
    const landHeight = (x: number) => islandSurfaceHeight(pilot.world, { x: Math.floor(x / 4), y: 29 },
      { x, y: 116 }, pilot.ascents, pilot.edges, pilot.beach, pilot.shoulders);
    const waterline = 316;
    const row = pilot.beach.seabed.cells.filter(cell => cell.y === 58 && cell.x < waterline / 2);
    const contact = row.find(cell => cell.x === waterline / 2 - 1)!;
    expect(ISLAND_SEABED_HEIGHTS[contact.level]).toBe(landHeight(waterline));
    expect(landHeight(waterline + 1)).toBe(ISLAND_WATER_HEIGHT);
    expect(row.some(cell => cell.x * 2 < waterline - 24)).toBe(true);
    expect(new Set(row.map(cell => cell.level)).size).toBeGreaterThanOrEqual(3);
  });

  it('queries emitted tread interiors without interpolating across vertical risers', () => {
    for (const [index, surfaces] of pilot.beach.landSurfaces) {
      const cell = { x: index % pilot.world.width, y: Math.floor(index / pilot.world.width) };
      for (const { vertices } of surfaces) {
        const center = vertices.reduce((sum, p) => ({
          x: sum.x + p.x / vertices.length, y: sum.y + p.y / vertices.length, z: sum.z + p.z / vertices.length,
        }), { x: 0, y: 0, z: 0 });
        expect(islandSurfaceHeight(pilot.world, cell, center, pilot.ascents, pilot.edges, pilot.beach, pilot.shoulders)).toBeCloseTo(center.z, 8);
        expect(vertices.every(p => p.z === center.z)).toBe(true);
      }
    }
  });

  it('continues into a broad stepped bed with a waterline contact band, while leaving rocky ends', () => {
    const shore = createIslandShoreField(pilot.world);
    let broadShelf = 0, waterline = 0;
    for (const cell of pilot.beach.seabed.cells) {
      const x = (cell.x + 0.5) * 2, y = (cell.y + 0.5) * 2;
      const sample = shore.sample(x, y);
      if (islandCoveInfluence(pilot.cove!, x, y) < 0.999 || sample.beachWeight < 0.999) continue;
      const z = ISLAND_SEABED_HEIGHTS[cell.level];
      expect(z).toBeGreaterThanOrEqual(ISLAND_WATER_HEIGHT - 4.75);
      if (sample.beachDistance > 24) broadShelf++;
      if (cell.anchored) {
        expect(z).toBe(ISLAND_WATER_HEIGHT);
        waterline++;
      }
    }
    expect(broadShelf * pilot.beach.seabed.cellSize ** 2).toBeGreaterThan(200);
    expect(waterline).toBeGreaterThan(10);
    expect(islandCoveInfluence(pilot.cove!, 200, 124)).toBe(0);
    expect(islandCoveInfluence(pilot.cove!, 296, 168)).toBe(0);
    expect(() => islandCoveInfluence(pilot.cove!, NaN, 0)).toThrow(RangeError);
  });
});
