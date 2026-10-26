import { describe, expect, it } from 'vitest';
import { generateWorld, cellCenter } from '../src/core/world';
import { Navigation } from '../src/core/navigation';
import { GameSimulation } from '../src/core/game';

describe('integrated browser-generated worlds', () => {
  for (const seed of [0, 1, 17, 44, 99, 12346, 271828, 999999]) {
    it(`keeps seed ${seed} playable and repeatable`, () => {
      const world = generateWorld(seed);
      const repeated = generateWorld(seed);
      expect(world.provenance).toBe('browser-generated');
      expect(world.heights).toEqual(repeated.heights);
      expect(world.cells).toEqual(repeated.cells);
      expect(world.elevations).toBeUndefined();
      const navigation = new Navigation(world);
      const simulation = new GameSimulation(world, navigation, { autoSelect: true });
      expect(navigation.speedAt(simulation.character.position)).toBe(1);
      expect(simulation.bushes.length).toBeGreaterThan(0);
      for (const bush of simulation.bushes) {
        expect(navigation.canReach(simulation.character.position, bush.position)).toBe(true);
      }
      const target = navigation.route(simulation.character.position, {
        x: simulation.character.position.x + 35,
        y: simulation.character.position.y + 12,
      }).at(-1)!;
      simulation.moveTo(target);
      for (let tick = 0; tick < 600; tick++) simulation.advance(1 / 60);
      expect(Math.hypot(simulation.character.position.x - target.x, simulation.character.position.y - target.y)).toBeLessThan(0.001);
    });
  }

  for (const seed of [0, 44, 999999]) {
    it(`connects experimental elevation routes for seed ${seed} without changing its coastline`, () => {
      const baseline = generateWorld(seed);
      const world = generateWorld(seed, { relief: true });
      expect(world.heights).toEqual(baseline.heights);
      expect(world.cells).toEqual(baseline.cells);
      expect([...new Set(world.elevations)]).toEqual(expect.arrayContaining([0, 1, 2]));
      expect(world.ramps!.length).toBeGreaterThan(0);
      const navigation = new Navigation(world);
      const spawn = navigation.spawnPosition();
      for (const ramp of world.ramps!) {
        const upper = cellCenter(world, ramp.highCell);
        const lower = cellCenter(world, ramp.lowCell);
        expect(navigation.canReach(spawn, upper)).toBe(true);
        expect(navigation.canReach(spawn, lower)).toBe(true);
        const route = navigation.route(lower, upper);
        for (let index = 1; index < route.length; index++) {
          expect(navigation.segmentClear(route[index - 1], route[index])).toBe(true);
        }
      }
    });
  }
});
