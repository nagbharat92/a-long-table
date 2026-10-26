import { describe, expect, it } from 'vitest';
import type { BushState, NavigationApi, Point, World } from '../src/core/contracts';
import {
  advanceCharacterAnimation,
  characterPose,
  createCharacter,
  GameSimulation,
} from '../src/core/game';
import { terrainAt } from '../src/core/world';

function syntheticWorld(seed = 7): World {
  const width = 64;
  const height = 48;
  return {
    seed,
    generatorVersion: 'game-test',
    width,
    height,
    tileSize: 4,
    seaLevel: 0,
    heights: new Float32Array(width * height).fill(0.5),
    cells: new Uint8Array(width * height).fill(1),
    cliffCells: new Uint8Array(width * height),
    provenance: 'test-fixture',
  };
}

function testNavigation(
  world: World,
  options: {
    spawn?: Point;
    speedAt?: (point: Point) => number;
    canReach?: (from: Point, to: Point) => boolean;
    segmentClear?: (from: Point, to: Point, sameSpeed?: boolean) => boolean;
    route?: (from: Point, to: Point) => Point[];
  } = {},
): NavigationApi {
  const speedAt =
    options.speedAt ??
    ((point: Point) => {
      const x = Math.floor(point.x / world.tileSize);
      const y = Math.floor(point.y / world.tileSize);
      if (x < 0 || y < 0 || x >= world.width || y >= world.height) return 0;
      const terrain = terrainAt(world, { x, y });
      return terrain === 'deep' ? 0 : terrain === 'shallow' ? 0.45 : 1;
    });
  return {
    world,
    speeds: new Float32Array(world.width * world.height).fill(1),
    spawnPosition: () => ({ ...(options.spawn ?? { x: 50, y: 64 }) }),
    speedAt,
    canReach: options.canReach ?? ((from, to) => speedAt(from) > 0 && speedAt(to) > 0),
    canStep: () => true,
    segmentClear:
      options.segmentClear ?? ((from, to) => speedAt(from) > 0 && speedAt(to) > 0),
    route: options.route ?? ((from, to) => [{ ...from }, { ...to }]),
  };
}

function bush(id = 'berries', position: Point = { x: 102, y: 64 }): BushState {
  return {
    id,
    position: { ...position },
    state: 'ripe',
    regrowElapsed: 0,
    targeted: false,
    hovered: false,
    gatherProgress: 0,
  };
}

function gatherFixture(options: Parameters<typeof testNavigation>[1] = {}) {
  const world = syntheticWorld();
  const navigation = testNavigation(world, options);
  const game = new GameSimulation(world, navigation, { foraging: false });
  const target = bush();
  game.bushes.push(target);
  return { game, target };
}

function standingFixture() {
  return gatherFixture({ spawn: { x: 94, y: 64 } });
}

describe('shared character animation', () => {
  it('copies the foot anchor and initializes a quiet, unselected character', () => {
    const position = { x: 64, y: 64 };
    const character = createCharacter(position);
    position.x = 100;
    expect(character.position).toEqual({ x: 64, y: 64 });
    expect(character.selected).toBe(false);
    expect(character.route).toEqual([]);
    expect(characterPose(character)).toEqual({
      hop: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      blink: false,
    });
  });

  it('lifts only the visual body at the apex and squashes at landing', () => {
    const character = createCharacter({ x: 64, y: 64 });
    advanceCharacterAnimation(character, 0.2, 4.5, { x: 1, y: 0 }, true);
    const apex = characterPose(character);
    expect(apex.hop).toBeGreaterThan(1.8);
    expect(apex.scaleX).toBeLessThan(1);
    expect(apex.scaleY).toBeGreaterThan(1);
    expect(apex.rotation).toBeGreaterThan(0);
    expect(apex.rotation).toBeLessThanOrEqual(0.045);
    expect(character.position).toEqual({ x: 64, y: 64 });
    advanceCharacterAnimation(character, 0.2, 4.5, { x: 1, y: 0 }, true);
    const landing = characterPose(character);
    expect(landing.hop).toBeCloseTo(0, 12);
    expect(landing.scaleX).toBeGreaterThan(1.1);
    expect(landing.scaleY).toBeLessThan(0.9);
  });

  it('uses continuous travelled distance, not wall time, for the gait', () => {
    const dry = createCharacter({ x: 0, y: 0 });
    const shallow = createCharacter({ x: 0, y: 0 });
    for (let frame = 0; frame < 60; frame += 1) {
      advanceCharacterAnimation(dry, 1 / 60, 22 / 60, { x: 1, y: 0 }, true);
      advanceCharacterAnimation(shallow, 1 / 60, (22 * 0.45) / 60, { x: 1, y: 0 }, true);
    }
    expect(shallow.gaitDistance / dry.gaitDistance).toBeCloseTo(0.45, 12);
    expect(dry.gaitDistance).toBeCloseTo(22, 12);
    expect(characterPose(dry).hop).not.toBeCloseTo(characterPose(shallow).hop, 2);
  });

  it('matches poses at 30, 60, and irregular frame rates with exponential smoothing', () => {
    const characters = [30, 60, 1].map(() => createCharacter({ x: 0, y: 0 }));
    const steps = [
      Array.from({ length: 30 }, () => 1 / 30),
      Array.from({ length: 60 }, () => 1 / 60),
      [0.03, 0.07, 0.1, 0.3, 0.5],
    ];
    characters.forEach((character, index) => {
      for (const delta of steps[index]) {
        advanceCharacterAnimation(character, delta, 22 * delta, { x: -1, y: 0 }, true);
      }
    });
    const expected = characterPose(characters[0]);
    for (const character of characters) {
      const pose = characterPose(character);
      expect(pose.hop).toBeCloseTo(expected.hop, 12);
      expect(pose.scaleX).toBeCloseTo(expected.scaleX, 12);
      expect(pose.scaleY).toBeCloseTo(expected.scaleY, 12);
      expect(pose.rotation).toBeCloseTo(expected.rotation, 12);
      expect(character.motionWeight).toBeCloseTo(1 - Math.exp(-16), 12);
    }
  });

  it('settles without an idle gait and blinks only in the last 0.14 seconds of 4.7', () => {
    const character = createCharacter({ x: 0, y: 0 });
    advanceCharacterAnimation(character, 0.2, 4.5, { x: 1, y: 0 }, true);
    advanceCharacterAnimation(character, 1, 0, { x: 0, y: 0 }, false);
    expect(character.gaitDistance).toBe(4.5);
    expect(character.motionWeight).toBeLessThan(0.000001);
    expect(characterPose(character).hop).toBeLessThan(0.000001);
    expect(characterPose(character).rotation).toBeLessThan(0.000001);
    for (const [time, blinking] of [
      [4.55, false],
      [4.56, false],
      [4.57, true],
      [4.69, true],
      [4.7, false],
      [4.8, false],
      [9.3, true],
    ] as const) {
      character.animationTime = time;
      expect(characterPose(character).blink).toBe(blinking);
    }
  });
});

describe('continuous character traversal', () => {
  it('advances actual simulation seconds without renderer clamping and arrives exactly', () => {
    const { game } = gatherFixture();
    game.moveTo({ x: 160.25, y: 64 });
    game.advance(0.1);
    expect(game.character.position.x).toBeCloseTo(52.2, 10);
    expect(game.character.gaitDistance).toBeCloseTo(2.2, 10);
    expect(game.character.routeIndex).toBe(1);
    game.advance(5);
    expect(game.character.position).toEqual({ x: 160.25, y: 64 });
    expect(game.character.route).toEqual([]);
    expect(game.character.routeIndex).toBe(0);
    expect(game.elapsed).toBeCloseTo(5.1, 12);
    expect(game.tick).toBe(2);
    expect(game.character.gaitDistance).toBeCloseTo(110.25, 9);
  });

  it('slows physical travel and gait to 0.45 in shallows', () => {
    const { game } = gatherFixture({ speedAt: () => 0.45 });
    game.moveTo({ x: 150, y: 64 });
    game.advance(1);
    expect(game.character.position.x).toBeCloseTo(59.9, 10);
    expect(game.character.gaitDistance).toBeCloseTo(9.9, 10);
    expect(game.character.position.y).toBe(64);
  });

  it('integrates terrain boundaries in at most 0.01 second steps across delta sizes', () => {
    const run = (steps: number[]) => {
      const { game } = gatherFixture({
        speedAt: (point) => (point.x < 72 ? 1 : 0.45),
      });
      game.moveTo({ x: 150, y: 64 });
      for (const delta of steps) game.advance(delta);
      return game;
    };
    const coarse = run([2]);
    const fine = run(Array.from({ length: 200 }, () => 0.01));
    const irregular = run([0.07, 0.013, 0.117, 0.4, 0.3, 0.6, 0.5]);
    expect(Math.abs(coarse.character.position.x - 81.9)).toBeLessThan(22 * 0.01);
    expect(fine.character.position.x).toBeCloseTo(coarse.character.position.x, 8);
    expect(Math.abs(irregular.character.position.x - coarse.character.position.x)).toBeLessThan(
      22 * 0.01,
    );
    expect(coarse.character.gaitDistance).toBeCloseTo(coarse.character.position.x - 50, 8);
  });

  it('consumes waypoint arrival time and tracks routeIndex before clearing the route', () => {
    const { game } = gatherFixture({
      route: (from, to) => [{ ...from }, { x: 72, y: 64 }, { x: 72, y: 86 }, { ...to }],
    });
    game.moveTo({ x: 94, y: 86 });
    game.advance(1.5);
    expect(game.character.position.x).toBeCloseTo(72, 10);
    expect(game.character.position.y).toBeCloseTo(75, 10);
    expect(game.character.routeIndex).toBe(2);
    game.advance(1.5);
    expect(game.character.position).toEqual({ x: 94, y: 86 });
    expect(game.character.route).toEqual([]);
  });

  it('replaces a mid-route command rather than retaining the old destination', () => {
    const { game } = gatherFixture();
    game.moveTo({ x: 160, y: 64 });
    game.advance(0.25);
    game.moveTo({ x: 30.25, y: 40.5 });
    game.advance(5);
    expect(game.character.position).toEqual({ x: 30.25, y: 40.5 });
  });

  it('reports blocked movement and never turns a failed walk into a harvest', () => {
    let blocked = false;
    const { game, target } = gatherFixture({ speedAt: () => (blocked ? 0 : 1) });
    expect(game.gather(target.id)).toBe(true);
    blocked = true;
    game.advance(1);
    expect(game.character.position).toEqual({ x: 50, y: 64 });
    expect(game.job).toBeNull();
    expect(game.character.route).toEqual([]);
    expect(game.feedback).toBe('Character reached blocked terrain');
    expect(game.berries).toBe(0);
  });

  it('rejects invalid deltas without mutating elapsed time or position', () => {
    const { game } = gatherFixture();
    for (const delta of [-1, Infinity, NaN]) expect(() => game.advance(delta)).toThrow(RangeError);
    game.advance(0);
    expect(game.elapsed).toBe(0);
    expect(game.tick).toBe(0);
    expect(game.character.position).toEqual({ x: 50, y: 64 });
  });
});

describe('gathering and regrowth', () => {
  it('walks to an eight-unit approach before the full 0.8-second harvest yields three', () => {
    const { game, target } = gatherFixture();
    expect(game.gather(target.id)).toBe(true);
    expect(game.activity).toBe('Walking to berries');
    expect(target.targeted).toBe(true);
    game.advance(1.99);
    expect(game.job?.started).toBe(false);
    expect(target.gatherProgress).toBe(0);
    expect(game.berries).toBe(0);
    game.advance(0.01);
    expect(game.character.position.x).toBeCloseTo(94, 8);
    expect(game.character.route).toEqual([]);
    expect(game.job?.started).toBe(true);
    expect(game.activity).toBe('Gathering berries...');
    expect(Math.hypot(game.character.position.x - 102, game.character.position.y - 64)).toBeCloseTo(
      8,
      10,
    );
    game.advance(0.79);
    expect(game.berries).toBe(0);
    expect(target.gatherProgress).toBeCloseTo(0.79 / 0.8, 9);
    game.advance(0.01);
    expect(game.berries).toBe(3);
    expect(game.job).toBeNull();
    expect(target.state).toBe('depleted');
    expect(target.targeted).toBe(false);
    expect(target.gatherProgress).toBe(0);
    expect(game.feedback).toBe('Gathered 3 berries');
  });

  it('accounts for arrival, harvest, and regrowth within one large delta', () => {
    const { game, target } = gatherFixture();
    game.gather(target.id);
    game.advance(12.8);
    expect(game.berries).toBe(3);
    expect(game.job).toBeNull();
    expect(target.state).toBe('growing');
    expect(target.regrowElapsed).toBeCloseTo(10, 7);
    expect(game.character.gaitDistance).toBeCloseTo(44, 8);
    expect(game.feedback).toBe('');
  });

  it('stays depleted below seven seconds, grows until twenty, and regrows without inventory', () => {
    const { game, target } = standingFixture();
    game.gather(target.id);
    game.advance(0.8);
    expect(game.berries).toBe(3);
    expect(game.gather(target.id)).toBe(false);
    expect(game.feedback).toBe('Berries are regrowing');
    game.advance(6.99);
    expect(target.state).toBe('depleted');
    game.advance(0.01);
    expect(target.state).toBe('growing');
    game.advance(12.99);
    expect(target.state).toBe('growing');
    game.advance(0.01);
    expect(target.state).toBe('ripe');
    expect(target.regrowElapsed).toBe(20);
    expect(game.berries).toBe(3);
    expect(game.gather(target.id)).toBe(true);
    game.advance(0.8);
    expect(game.berries).toBe(6);
    expect(target.state).toBe('depleted');
  });

  it('retains one job and its progress on repeated clicks', () => {
    const { game, target } = standingFixture();
    game.gather(target.id);
    const original = game.job;
    game.advance(0.4);
    expect(game.gather(target.id)).toBe(true);
    expect(game.job).toBe(original);
    expect(target.gatherProgress).toBeCloseTo(0.5, 10);
    game.advance(0.4);
    expect(game.berries).toBe(3);
    game.advance(1);
    expect(game.berries).toBe(3);
  });

  it('cancels pending or active gathering without ghost harvests', () => {
    for (const delta of [0.5, 2.4]) {
      const { game, target } = gatherFixture();
      game.gather(target.id);
      game.advance(delta);
      game.cancelGather();
      expect(target.targeted).toBe(false);
      expect(target.gatherProgress).toBe(0);
      game.advance(3);
      expect(game.job).toBeNull();
      expect(game.berries).toBe(0);
      expect(target.state).toBe('ripe');
    }
  });

  it('ground redirects cancel gathering but preserve the replacement route', () => {
    const { game, target } = standingFixture();
    game.gather(target.id);
    game.advance(0.4);
    game.select(true);
    game.click({ x: 25, y: 25 }, 2);
    expect(game.job).toBeNull();
    expect(target.gatherProgress).toBe(0);
    expect(game.character.route.at(-1)).toEqual({ x: 25, y: 25 });
    game.advance(0.8);
    expect(game.berries).toBe(0);
    expect(game.character.route.at(-1)).toEqual({ x: 25, y: 25 });
    game.advance(5);
    expect(game.character.position).toEqual({ x: 25, y: 25 });
  });

  it('cancels an externally replaced route without erasing that route', () => {
    const { game, target } = standingFixture();
    game.gather(target.id);
    game.advance(0.4);
    game.character.route = [{ ...game.character.position }, { x: 25, y: 25 }];
    game.character.routeIndex = 1;
    game.advance(0.1);
    expect(game.job).toBeNull();
    expect(game.character.route.at(-1)).toEqual({ x: 25, y: 25 });
    expect(game.berries).toBe(0);
    expect(target.targeted).toBe(false);
  });

  it('switches bushes without harvesting the abandoned crop', () => {
    const { game, target } = standingFixture();
    const next = bush('other', { x: 150, y: 100 });
    game.bushes.push(next);
    game.gather(target.id);
    game.advance(0.4);
    expect(game.gather(next.id)).toBe(true);
    expect(game.job?.bushId).toBe(next.id);
    expect(target.targeted).toBe(false);
    expect(target.gatherProgress).toBe(0);
    game.advance(10);
    expect(target.state).toBe('ripe');
    expect(next.state).not.toBe('ripe');
    expect(game.berries).toBe(3);
  });

  it('rejects unreachable, obstructed, shallow, or snapped approaches explicitly', () => {
    const cases: Parameters<typeof testNavigation>[1][] = [
      { canReach: () => false },
      { segmentClear: () => false },
      { speedAt: () => 0.45 },
      { route: (from) => [{ ...from }, { x: 60, y: 64 }] },
    ];
    for (const options of cases) {
      const { game, target } = gatherFixture(options);
      expect(game.gather(target.id)).toBe(false);
      expect(game.feedback).toBe("Can't reach this bush");
      expect(game.job).toBeNull();
      expect(target.targeted).toBe(false);
      game.advance(1);
      expect(game.berries).toBe(0);
    }
  });

  it('checks all eight sampled approaches and accepts the available one', () => {
    const { game, target } = gatherFixture({
      canReach: (_from, to) => to.x > 109.9,
    });
    expect(game.gather(target.id)).toBe(true);
    expect(game.job?.destination).toEqual({ x: 110, y: 64 });
    game.advance(4);
    expect(game.berries).toBe(3);
  });

  it('interrupts if the arrival-to-bush segment becomes blocked', () => {
    let clear = true;
    const { game, target } = standingFixture();
    expect(game.gather(target.id)).toBe(true);
    game.advance(0.4);
    const original = game.navigation.segmentClear;
    game.navigation.segmentClear = (from, to) => clear && original(from, to);
    clear = false;
    game.advance(0.4);
    expect(game.job).toBeNull();
    expect(game.berries).toBe(0);
    expect(game.feedback).toBe('Gathering interrupted');
  });

  it('laboratory phase controls cancel only the related job and never grant inventory', () => {
    const { game, target } = standingFixture();
    const other = bush('other', { x: 150, y: 100 });
    game.bushes.push(other);
    game.gather(target.id);
    game.advance(0.4);
    game.setBushState(other.id, 'growing');
    expect(game.job?.bushId).toBe(target.id);
    expect(other.regrowElapsed).toBe(7);
    game.setBushState(target.id, 'depleted');
    expect(game.job).toBeNull();
    expect(target.gatherProgress).toBe(0);
    expect(target.targeted).toBe(false);
    expect(target.regrowElapsed).toBe(0);
    game.advance(0.8);
    expect(game.berries).toBe(0);
    game.setBushState(target.id, 'growing');
    expect(target.regrowElapsed).toBe(7);
    game.advance(13);
    expect(target.state).toBe('ripe');
    game.setBushState(target.id, 'ripe');
    expect(target.regrowElapsed).toBe(0);
    expect(game.berries).toBe(0);
    expect(() => game.setBushState('missing', 'ripe')).toThrow('Unknown bush');
  });
});

describe('selection and hit targets', () => {
  it('ignores ground and bush commands without selection, then selects the character', () => {
    const { game, target } = gatherFixture();
    game.click({ x: 180, y: 120 }, 2);
    game.click({ x: target.position.x, y: target.position.y - 7 }, 2);
    expect(game.character.route).toEqual([]);
    expect(game.job).toBeNull();
    game.click(game.character.position, 2);
    expect(game.character.selected).toBe(true);
    expect(game.character.route).toEqual([]);
    game.click({ x: target.position.x, y: target.position.y - 7 }, 2);
    expect(game.job?.bushId).toBe(target.id);
    game.select(false);
    expect(game.character.selected).toBe(false);
    expect(game.job?.bushId).toBe(target.id);
  });

  it('supports auto-selection and optional foraging without changing the shared character', () => {
    const world = syntheticWorld();
    const game = new GameSimulation(world, testNavigation(world), {
      foraging: false,
      autoSelect: true,
    });
    expect(game.character.selected).toBe(true);
    expect(game.bushes).toEqual([]);
    expect(game.world).toBe(world);
    expect(game.navigation.world).toBe(world);
    game.click({ x: 180, y: 120 }, 2);
    expect(game.character.route.at(-1)).toEqual({ x: 180, y: 120 });
  });

  it('keeps the marker and transformed ears selectable at every supported zoom', () => {
    const { game } = gatherFixture();
    advanceCharacterAnimation(game.character, 0.2, 4.5, { x: 1, y: 0 }, true);
    const pose = characterPose(game.character);
    const earX = (-3.5 * 12) / 29 * pose.scaleX;
    const earY = (-28.5 * 12) / 29 * pose.scaleY;
    const ear = {
      x: game.character.position.x + earX * Math.cos(pose.rotation) - earY * Math.sin(pose.rotation),
      y:
        game.character.position.y +
        earX * Math.sin(pose.rotation) +
        earY * Math.cos(pose.rotation) -
        pose.hop,
    };
    expect(game.characterHitTest(ear, 8)).toBe(true);
    for (const zoom of [0.5, 1, 2, 8]) {
      const radius = Math.max(1.5, 3 / zoom);
      const marker = {
        x: game.character.position.x,
        y:
          game.character.position.y -
          15 -
          radius -
          2 / zoom +
          Math.sin(game.character.animationTime * 2.5) * 0.45,
      };
      expect(game.characterHitTest(marker, zoom)).toBe(true);
    }
    expect(game.characterHitTest({ x: 200, y: 180 }, 8)).toBe(false);
  });

  it('chooses closest bush centers and still gathers adjacent bushes over enlarged character hits', () => {
    for (const zoom of [0.5, 1, 8]) {
      const { game, target } = standingFixture();
      game.bushes.push(bush('other', { x: 118, y: 64 }));
      const foliage = { x: 102, y: 57 };
      expect(game.bushAt(foliage, zoom)).toBe(target);
      game.select(true);
      game.click(foliage, zoom);
      expect(game.job?.bushId).toBe(target.id);
      expect(game.bushAt({ x: 240, y: 180 }, zoom)).toBeUndefined();
    }
  });
});

describe('seeded restrained berry patches', () => {
  it('is deterministic per seed, independent of animation, and leaves terrain untouched', () => {
    const world = syntheticWorld(42);
    const heights = world.heights.slice();
    const cells = world.cells.slice();
    const first = new GameSimulation(world, testNavigation(world));
    first.advance(4.6);
    characterPose(first.character);
    const repeated = new GameSimulation(world, testNavigation(world));
    expect(repeated.bushes).toEqual(first.bushes);
    const otherWorld = syntheticWorld(43);
    const other = new GameSimulation(otherWorld, testNavigation(otherWorld));
    expect(other.bushes[0].position).toEqual(first.bushes[0].position);
    expect(other.bushes.slice(1)).not.toEqual(first.bushes.slice(1));
    expect(world.heights).toEqual(heights);
    expect(world.cells).toEqual(cells);
  });

  it('places the first bush nearest spawn + (28,16), with 6..18 nonoverlapping bushes', () => {
    const world = syntheticWorld();
    const game = new GameSimulation(world, testNavigation(world));
    expect(game.bushes[0].position).toEqual({ x: 78, y: 78 });
    expect(game.bushes.length).toBeGreaterThanOrEqual(6);
    expect(game.bushes.length).toBeLessThanOrEqual(18);
    for (const [index, target] of game.bushes.entries()) {
      expect(Math.hypot(target.position.x - 50, target.position.y - 64)).toBeGreaterThanOrEqual(20);
      for (const other of game.bushes.slice(0, index)) {
        expect(
          Math.hypot(target.position.x - other.position.x, target.position.y - other.position.y),
        ).toBeGreaterThanOrEqual(16);
      }
    }
    expect(new Set(game.bushes.map((target) => target.id)).size).toBe(game.bushes.length);
  });

  it('uses reachable 5x5 grass neighborhoods away from beaches and cliff cells', () => {
    const world = syntheticWorld();
    for (let y = 0; y < world.height; y += 1) {
      world.heights[y * world.width + 24] = 0.06;
      if (world.cliffCells) world.cliffCells[y * world.width + 34] = 1;
    }
    const navigation = testNavigation(world, { canReach: (_from, to) => to.x < 180 });
    const game = new GameSimulation(world, navigation);
    expect(game.bushes.length).toBeGreaterThanOrEqual(6);
    for (const target of game.bushes) {
      expect(navigation.canReach(game.character.position, target.position)).toBe(true);
      const x = Math.floor(target.position.x / world.tileSize);
      const y = Math.floor(target.position.y / world.tileSize);
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const index = (y + dy) * world.width + x + dx;
          expect(terrainAt(world, { x: x + dx, y: y + dy })).toBe('grass');
          expect(world.cells[index]).toBe(1);
          expect(world.cliffCells?.[index]).toBe(0);
        }
      }
    }
  });

  it('reports when there are no suitable reachable patches', () => {
    const world = syntheticWorld();
    world.heights.fill(0.06);
    const game = new GameSimulation(world, testNavigation(world));
    expect(game.bushes).toEqual([]);
    expect(game.feedback).toBe('No reachable grass patch for berry bushes');
  });
});
