import { describe, expect, it } from 'vitest';
import type { Point, World } from '../src/core/contracts';
import { CLEARANCE, Navigation, SHALLOW_SPEED } from '../src/core/navigation';
import { cellAt, cellCenter, generateWorld, makeNavigationFixture, terrainAt } from '../src/core/world';

function grid(rows: string[]): World {
  const width = rows[0].length, height = rows.length;
  const values: Record<string, number> = { '.': -0.7, '~': -0.1, 's': 0.06, 'g': 0.4 };
  const heights = Float32Array.from(rows.join(''), symbol => values[symbol]);
  return { seed: 0, generatorVersion: 'navigation-test-v1', provenance: 'test-fixture',
    width, height, tileSize: 4, seaLevel: 0, heights, cells: Uint8Array.from(heights, value => Number(value > 0)) };
}
const center = (world: World, x: number, y: number) => cellCenter(world, { x, y });
function expectSafeRoute(nav: Navigation, route: Point[], from: Point): void {
  expect(route[0]).toEqual(from);
  for (let i = 1; i < route.length; i++) expect(nav.segmentClear(route[i - 1], route[i])).toBe(true);
}

describe('weighted EasyStar navigation', () => {
  it('takes a cheaper dry detour instead of simplifying across shallow water', () => {
    const world = grid([
      '..............',
      '.ssssssssssss.',
      '.ssssssssssss.',
      '.sss~~~~~~sss.',
      '.sss~~~~~~sss.',
      '.sss~~~~~~sss.',
      '.ssssssssssss.',
      '.ssssssssssss.',
      '..............',
    ]);
    const nav = new Navigation(world), from = center(world, 2, 4), to = center(world, 11, 4);
    expect(nav.segmentClear(from, to)).toBe(true);
    expect(nav.segmentClear(from, to, true)).toBe(false);
    const route = nav.route(from, to);
    expectSafeRoute(nav, route, from);
    expect(route.at(-1)).toEqual(to);
    expect(route.some(point => point.y < 12 || point.y >= 24)).toBe(true);
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i];
      const samples = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 4);
      for (let n = 0; n <= samples; n++) {
        const t = samples ? n / samples : 0;
        expect(nav.speedAt({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })).toBe(1);
      }
    }
  });

  it('retains shallow speed and permits sand/water transitions but blocks deep water and grass cliffs', () => {
    const world = grid(['.......', '.ss~gg.', '.ss~gg.', '.ss~gg.', '.......']);
    const nav = new Navigation(world);
    expect(nav.speedAt(center(world, 3, 2))).toBeCloseTo(SHALLOW_SPEED);
    expect(nav.speedAt(center(world, 2, 2))).toBe(1);
    expect(nav.speedAt(center(world, 0, 0))).toBe(0);
    expect(nav.canStep({ x: 2, y: 2 }, { x: 3, y: 2 })).toBe(true);
    expect(nav.canStep({ x: 3, y: 2 }, { x: 4, y: 2 })).toBe(false);
    expect(nav.canReach(center(world, 1, 2), center(world, 4, 2))).toBe(false);
    const route = nav.route(center(world, 1, 2), center(world, 3, 2));
    expectSafeRoute(nav, route, center(world, 1, 2));
    expect(route.at(-1)).toEqual(center(world, 3, 2));
  });

  it('does not cut blocked diagonal corners, including when cardinal tiles are open but edges are disallowed', () => {
    const world = grid(['.....', '.s.s.', '..ss.', '.sss.', '.....']);
    const nav = new Navigation(world);
    expect(nav.canStep({ x: 1, y: 1 }, { x: 2, y: 2 })).toBe(false);
    expect(nav.segmentClear(center(world, 1, 1), center(world, 2, 2))).toBe(false);
    expect(nav.canReach(center(world, 1, 1), center(world, 2, 2))).toBe(false);
    const cliffs = grid(['.....', '.ggg.', '.s~s.', '.sss.', '.....']);
    const cliffNav = new Navigation(cliffs);
    expect(cliffNav.canStep({ x: 1, y: 1 }, { x: 2, y: 2 })).toBe(false);
  });
});

describe('continuous destinations and swept clearance', () => {
  it('keeps partial-cell requested precision instead of snapping to cell centers', () => {
    const world = grid(['.......', '.sssss.', '.sssss.', '.sssss.', '.......']);
    const nav = new Navigation(world), from = { x: 6.2, y: 9.4 }, to = { x: 20.8, y: 7.3 };
    const route = nav.route(from, to);
    expect(route).toEqual([from, to]);
    expect(nav.route(from, from)).toEqual([from]);
  });

  it('uses the nearest reachable continuous boundary, not the nearest center or a disconnected requested component', () => {
    const world = grid(['........', '.ss..ss.', '.ss..ss.', '.ss..ss.', '........']);
    const nav = new Navigation(world), from = center(world, 1, 2), requested = { x: 23.1, y: 9.3 };
    expect(nav.canReach(from, requested)).toBe(false);
    const route = nav.route(from, requested);
    expectSafeRoute(nav, route, from);
    expect(route.at(-1)).toEqual({ x: 12 - CLEARANCE, y: requested.y });
    expect(nav.canReach(from, route.at(-1)!)).toBe(true);
    const outside = nav.route(from, { x: -100, y: 9.3 }).at(-1)!;
    expect(outside).toEqual({ x: 4 + CLEARANCE, y: 9.3 });
  });

  it('does not let thin corner crossings or endpoint footprints pass obstacles', () => {
    const world = grid(['.......', '.sssss.', '.s.sss.', '.sssss.', '.sssss.', '.......']);
    const nav = new Navigation(world);
    expect(nav.segmentClear({ x: 7.7, y: 6 }, { x: 7.7, y: 14 })).toBe(false);
    expect(nav.segmentClear({ x: 7.5, y: 7.5 }, { x: 7.5, y: 7.5 })).toBe(false);
    expect(nav.canReach(center(world, 1, 1), { x: 7.5, y: 7.5 })).toBe(false);
    const route = nav.route(center(world, 1, 1), center(world, 4, 4));
    expectSafeRoute(nav, route, center(world, 1, 1));
    expect(route.at(-1)).toEqual(center(world, 4, 4));
    const fallback = nav.route(center(world, 1, 1), { x: 8.1, y: 8.1 }).at(-1)!;
    expect(nav.segmentClear(fallback, fallback)).toBe(true);
  });

  it('bends via the cell interior for same-cell endpoints around an inset diagonal corner', () => {
    const world = grid(['......', '.ssss.', '.s.ss.', '.ssss.', '.ssss.', '......']);
    const nav = new Navigation(world), from = { x: 12.8, y: 12.1 }, to = { x: 12.1, y: 12.8 };
    expect(cellAt(world, from)).toEqual(cellAt(world, to));
    expect(nav.segmentClear(from, from)).toBe(true);
    expect(nav.segmentClear(to, to)).toBe(true);
    expect(nav.segmentClear(from, to)).toBe(false);
    const route = nav.route(from, to);
    expectSafeRoute(nav, route, from);
    expect(route.at(-1)).toEqual(to);
    expect(route.length).toBeGreaterThan(2);
  });

  it('blocks both projected coastal cliff face cells', () => {
    const world = grid(['.......', '.sssss.', '.sgsss.', '.s~sss.', '.s~sss.', '.sssss.', '.......']);
    const nav = new Navigation(world);
    expect(nav.speedAt(center(world, 2, 3))).toBe(0);
    expect(nav.speedAt(center(world, 2, 4))).toBe(0);
    expect(nav.canStep({ x: 1, y: 3 }, { x: 2, y: 3 })).toBe(false);
  });

  it('fails explicitly for invalid starts, non-finite destinations, malformed relief and missing grass spawns', () => {
    const world = grid(['.....', '.sss.', '.sss.', '.sss.', '.....']);
    const nav = new Navigation(world);
    expect(() => nav.route({ x: -1, y: 5 }, { x: 6, y: 6 })).toThrow('safe walkable terrain');
    expect(() => nav.route({ x: 4.1, y: 6 }, { x: 6, y: 6 })).toThrow('safe walkable terrain');
    expect(() => nav.route({ x: 6, y: 6 }, { x: NaN, y: 6 })).toThrow('finite coordinates');
    expect(() => nav.spawnPosition()).toThrow('grass spawn');
    expect(() => new Navigation({ ...world, elevations: new Uint8Array(world.heights.length) })).toThrow('complete elevation');
  });
});

describe('authored explorer and exact relief connectivity', () => {
  it('spawns on safe grass nearest the authored world center and routes around its obstacles', () => {
    const world = makeNavigationFixture(), nav = new Navigation(world), spawn = nav.spawnPosition();
    expect(terrainAt(world, cellAt(world, spawn))).toBe('grass');
    const midpoint = { x: world.width * world.tileSize / 2, y: world.height * world.tileSize / 2 };
    const spawnDistance = Math.hypot(spawn.x - midpoint.x, spawn.y - midpoint.y);
    for (let i = 0; i < world.heights.length; i++) {
      const cell = { x: i % world.width, y: Math.floor(i / world.width) }, point = cellCenter(world, cell);
      if (terrainAt(world, cell) === 'grass' && nav.segmentClear(point, point)) {
        expect(Math.hypot(point.x - midpoint.x, point.y - midpoint.y)).toBeGreaterThanOrEqual(spawnDistance);
      }
    }
    const route = nav.route(spawn, center(world, 26, 18));
    expectSafeRoute(nav, route, spawn);
    expect(nav.canReach(spawn, route.at(-1)!)).toBe(true);
  });

  it.each([42, 12345, 44])('seed %i connects every unblocked land cell and crosses elevation only on shared ramps', seed => {
    const world = generateWorld(seed, { relief: true }), nav = new Navigation(world), spawn = nav.spawnPosition();
    for (let i = 0; i < world.heights.length; i++) {
      const cell = { x: i % world.width, y: Math.floor(i / world.width) };
      if (world.cells[i] && nav.speeds[i]) expect(nav.canReach(spawn, cellCenter(world, cell))).toBe(true);
      for (const d of [{ x: 1, y: 0 }, { x: 0, y: 1 }]) {
        const next = { x: cell.x + d.x, y: cell.y + d.y };
        if (next.x >= world.width || next.y >= world.height) continue;
        const j = next.y * world.width + next.x;
        if (world.elevations![i] === world.elevations![j]) continue;
        if (nav.canStep(cell, next)) {
          expect(world.rampIds![i]).toBeGreaterThanOrEqual(0);
          expect(world.rampIds![i]).toBe(world.rampIds![j]);
          expect(Math.abs(world.elevations![i] - world.elevations![j])).toBe(1);
        } else if (world.rampIds![i] < 0 || world.rampIds![i] !== world.rampIds![j]) {
          expect(nav.canStep(cell, next)).toBe(false);
        }
      }
    }
    for (const ramp of world.ramps!) {
      const high = cellCenter(world, ramp.highCell), low = cellCenter(world, ramp.lowCell);
      expect(nav.canReach(high, low)).toBe(true);
      const route = nav.route(high, low);
      expectSafeRoute(nav, route, high);
      expect(route.at(-1)).toEqual(low);
    }
    const broken: World = { ...world, rampIds: new Int32Array(world.heights.length).fill(-1), ramps: [] };
    const noRamps = new Navigation(broken), ramp = world.ramps![0];
    expect(noRamps.canReach(cellCenter(world, ramp.highCell), cellCenter(world, ramp.lowCell))).toBe(false);
  });
});
