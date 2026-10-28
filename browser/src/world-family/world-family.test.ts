import { describe, expect, it } from 'vitest';
import { generateLandform, MAX_LANDFORM_SEED } from './core/landform-generation';
import { generateIslandWorld, generateWorld, makeNavigationFixture, cellCenter, terrainAt } from './core/world';
import { Navigation, SHALLOW_SPEED } from './core/navigation';
import { GameSimulation } from './core/game';
import { LANDFORM_FIXTURE } from './core/landform-study';

describe('isolated world-family source snapshot', () => {
  it('keeps reference geometry unchanged while generating deterministic new landforms', () => {
    const reference = JSON.stringify(LANDFORM_FIXTURE);
    for (const refined of [false, true]) {
      const sample = generateLandform(42, refined);
      expect(generateLandform(42, refined)).toEqual(sample);
      expect(generateLandform(43, refined).masses).not.toEqual(sample.masses);
      expect(sample.placements).toHaveLength(3);
    }
    expect(JSON.stringify(LANDFORM_FIXTURE)).toBe(reference);
    expect(generateLandform(MAX_LANDFORM_SEED).seed).toBe(MAX_LANDFORM_SEED);
  });

  it('keeps original V1 and navigation island generators deterministic', () => {
    for (const generate of [generateIslandWorld, generateWorld]) {
      const world = generate(42);
      const repeat = generate(42);
      expect(repeat.heights).toEqual(world.heights);
      expect(repeat.cells).toEqual(world.cells);
      const navigation = new Navigation(world);
      const spawn = navigation.spawnPosition();
      expect(navigation.segmentClear(spawn, spawn)).toBe(true);
    }
  });

  it('preserves deep-water blocking and 45-percent shallow movement', () => {
    const world = makeNavigationFixture();
    const navigation = new Navigation(world);
    const seen = new Set<string>();
    let openShallows = 0;
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        const terrain = terrainAt(world, { x, y });
        const speed = navigation.speedAt(cellCenter(world, { x, y }));
        if (terrain === 'deep') expect(speed).toBe(0);
        else if (terrain === 'shallow' && speed > 0) {
          expect(speed).toBeCloseTo(SHALLOW_SPEED, 6);
          openShallows++;
        }
        seen.add(terrain);
      }
    }
    expect(seen.has('deep')).toBe(true);
    expect(seen.has('shallow')).toBe(true);
    expect(openShallows).toBeGreaterThan(0);
  });

  it('routes through the real navigation engine and follows the shared movement simulation', () => {
    const world = makeNavigationFixture();
    const navigation = new Navigation(world);
    const simulation = new GameSimulation(world, navigation, { foraging: false, autoSelect: true });
    const from = { ...simulation.character.position };
    let destination: { x: number; y: number } | undefined;
    for (let y = 0; y < world.height && !destination; y++) {
      for (let x = 0; x < world.width; x++) {
        const point = cellCenter(world, { x, y });
        if (Math.hypot(point.x - from.x, point.y - from.y) > 10 && navigation.canReach(from, point)) {
          destination = point;
          break;
        }
      }
    }
    expect(destination).toBeDefined();
    simulation.moveTo(destination!);
    expect(simulation.character.route.length).toBeGreaterThan(1);
    for (let i = 0; i < 600; i++) simulation.advance(1 / 60);
    expect(simulation.character.position).not.toEqual(from);
    expect(navigation.segmentClear(simulation.character.position, simulation.character.position)).toBe(true);
  });
});
