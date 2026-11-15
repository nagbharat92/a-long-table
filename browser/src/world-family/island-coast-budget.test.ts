import { beforeAll, describe, expect, it } from 'vitest';
import type { World } from './core/contracts';
import type { IslandCove } from './core/island-cove';
import { COAST_DRY_WIDTH, coordinateIslandCoasts, planOpposingShores } from './core/island-coast-budget';
import { generateIslandLandform, islandSurfaceHeight, type IslandLandform } from './core/island-landform';
import { createIslandBeachShelf, islandBeachHeightAt } from './core/island-beach-shelf';

const beach = (priority: number) => ({ width: 24, priority });
describe('opposing shores share a dry-land budget', () => {
  it('allows two full beaches only when both grades and the dry route fit', () => {
    expect(planOpposingShores(64, beach(2), beach(1))).toEqual({
      first: 24, last: 24, dryStart: 24, dryWidth: 16, reason: 'both-fit',
    });
    expect(planOpposingShores(40, beach(2), beach(1))).toEqual({
      first: 24, last: 0, dryStart: 24, dryWidth: 16, reason: 'first-only',
    });
    expect(planOpposingShores(40, beach(1), beach(2))).toEqual({
      first: 0, last: 24, dryStart: 0, dryWidth: 16, reason: 'last-only',
    });
    expect(planOpposingShores(20, beach(2), beach(1)).reason).toBe('rocky-neck');
    expect(planOpposingShores(12, beach(2), beach(1)).reason).toBe('insufficient-land');
  });

  it('never compresses a profile or accepts a one-tile thread as a dry route', () => {
    for (let width = 4; width <= 100; width++) {
      const plan = planOpposingShores(width, beach(2), beach(1));
      expect([0, 24]).toContain(plan.first);
      expect([0, 24]).toContain(plan.last);
      expect(plan.first + plan.last + plan.dryWidth).toBeLessThanOrEqual(width);
      if (width >= COAST_DRY_WIDTH) expect(plan.dryWidth).toBe(COAST_DRY_WIDTH);
      else expect(plan.reason).toBe('insufficient-land');
    }
    for (const width of [0, -1, NaN, Infinity]) expect(() => planOpposingShores(width, beach(2), beach(1))).toThrow(RangeError);
  });

  it('sets a cut back toward the cove instead of pinching a narrow connecting strip', () => {
    const width = 32, height = 24;
    const original: World = {
      seed: 153025, generatorVersion: 'coast-fixture', provenance: 'test-fixture',
      width, height, tileSize: 4, seaLevel: 0,
      cells: new Uint8Array(width * height), heights: new Float32Array(width * height).fill(-0.1),
      elevations: new Uint8Array(width * height), rampIds: new Int32Array(width * height).fill(-1),
      cliffCells: new Uint8Array(width * height), ramps: [],
    };
    for (let y = 2; y < 22; y++) for (let x = 4; x < 28; x++) {
      original.cells[y * width + x] = 1;
      original.heights[y * width + x] = 0.06;
    }
    const carved = structuredClone(original);
    for (let y = 6; y < 18; y++) for (let x = 4; x < 26; x++) {
      carved.cells[y * width + x] = 0;
      carved.heights[y * width + x] = -0.1;
    }
    const cove: IslandCove = {
      center: { x: 60, y: 48 }, radius: { x: 24, y: 40 }, rotation: 0,
      gradeWidth: 24, shelfWidth: 52, shelfDepth: 2, focus: { x: 84, y: 48 },
    };
    const before = structuredClone({ original, carved, cove });
    const result = coordinateIslandCoasts(original, carved, cove, []);
    expect(result.budget.restoredCells).toBeGreaterThan(0);
    expect(result.budget.sections.length).toBeGreaterThan(0);
    const section = result.budget.sections.find(section => section.axis === 'x' && section.start.y === 12)!;
    expect(section.cells.length * 4).toBeGreaterThanOrEqual(16);
    expect(section.plan.first).toBe(0);
    expect(section.plan.last).toBe(0);
    const shelf = createIslandBeachShelf(result.world, [], result.cove, result.budget);
    for (let i = 0; i < result.budget.dryCells.length; i++) if (result.budget.dryCells[i]) {
      expect(result.world.cells[i]).toBe(1);
      expect(shelf.landSurfaces.has(i)).toBe(false);
    }
    expect({ original, carved, cove }).toEqual(before);
    const wider = structuredClone(original);
    for (let y = 6; y < 18; y++) for (let x = 4; x < 18; x++) {
      wider.cells[y * width + x] = 0;
      wider.heights[y * width + x] = -0.1;
    }
    const broad = coordinateIslandCoasts(original, wider, cove, []);
    const broadSection = broad.budget.sections.find(section => section.axis === 'x' && section.start.y === 12)!;
    expect(broadSection.plan.first).toBe(24);
    expect(broadSection.plan.last).toBe(0);
    const broadShelf = createIslandBeachShelf(broad.world, [], broad.cove, broad.budget);
    const at = (x: number) => islandBeachHeightAt(broad.world, broadShelf, { x: Math.floor(x / 4), y: 12 }, { x, y: 50 }) ?? 0;
    expect(at(72)).toBe(-2.5);
    expect(at(96)).toBe(0);
    for (let x = 72; x < 96; x++) {
      expect(at(x + 1)).toBeGreaterThanOrEqual(at(x));
      expect(at(x + 1) - at(x)).toBeLessThanOrEqual(0.75);
    }
  });
});

let approved: IslandLandform, guarded: IslandLandform;
beforeAll(() => {
  approved = generateIslandLandform(153025, { pilotCove: true });
  guarded = generateIslandLandform(153025, { pilotCove: true, coordinateCoasts: true });
});
describe('coordinated seed-153025 coast preview', () => {
  it('keeps the approved comparison intact and preserves raised terrain and stairs', () => {
    expect(approved.coastBudget).toBeUndefined();
    expect(approved.cove?.shoreMask).toBeUndefined();
    expect(guarded.coastBudget!.sections.length).toBeGreaterThan(0);
    expect(guarded.world.elevations).toEqual(approved.world.elevations);
    expect(guarded.world.rampIds).toEqual(approved.world.rampIds);
    expect(guarded.ascents).toEqual(approved.ascents);
    expect(guarded.edges).toEqual(approved.edges);
    expect(generateIslandLandform(153025, { pilotCove: true }).world).toEqual(approved.world);
    const again = generateIslandLandform(153025, { pilotCove: true, coordinateCoasts: true });
    expect(again.world).toEqual(guarded.world);
    expect(again.coastBudget).toEqual(guarded.coastBudget);
    expect(again.cove).toEqual(guarded.cove);
    expect(() => generateIslandLandform(77, { coordinateCoasts: true })).toThrow(/opt-in/);
  });

  it('emits dry, ungraded four-tile reservations rather than just reporting a width', () => {
    const { world, beach, ascents, edges, shoulders, coastBudget: budget } = guarded;
    let dry = 0;
    for (let i = 0; i < budget!.dryCells.length; i++) if (budget!.dryCells[i]) {
      const cell = { x: i % world.width, y: Math.floor(i / world.width) };
      expect(world.cells[i]).toBe(1);
      expect(beach.landSurfaces.has(i)).toBe(false);
      for (const [dx, dy] of [[0.1, 0.1], [2, 2], [3.9, 3.9]]) {
        expect(islandSurfaceHeight(world, cell, { x: cell.x * 4 + dx, y: cell.y * 4 + dy }, ascents, edges, beach, shoulders))
          .toBeGreaterThanOrEqual(0);
      }
      dry++;
    }
    expect(dry).toBeGreaterThan(16);
    for (const section of budget!.sections) {
      expect(section.plan.dryWidth).toBe(16);
      const start = section.plan.dryStart / 4;
      expect(section.cells.slice(start, start + 4).every(i => budget!.dryCells[i] === 1)).toBe(true);
    }
  });

  it('retains the approved main beach grade where space is sufficient', () => {
    for (let x = 316; x <= 340; x++) {
      const cell = { x: Math.floor(x / 4), y: 29 }, point = { x, y: 116 };
      expect(islandSurfaceHeight(guarded.world, cell, point, guarded.ascents, guarded.edges, guarded.beach, guarded.shoulders))
        .toBe(islandSurfaceHeight(approved.world, cell, point, approved.ascents, approved.edges, approved.beach, approved.shoulders));
    }
  });
});
