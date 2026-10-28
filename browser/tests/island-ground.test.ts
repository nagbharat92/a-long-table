import { describe, expect, it } from 'vitest';
import type { World } from '../src/core/contracts';
import { generateIslandWorld } from '../src/core/world';
import { drawIslandGround, ISLAND_GRASS_COLORS } from '../src/render/island-ground';
import { createIslandGroundField, type GroundInfluences } from '../src/render/island-ground-field';

function fixture(sand = false): World {
  const width = 64;
  const height = 48;
  const world: World = {
    width, height, tileSize: 4, seed: 42, seaLevel: 0,
    generatorVersion: 'test', provenance: 'test-fixture',
    cells: new Uint8Array(width * height).fill(1),
    heights: new Float32Array(width * height).fill(sand ? 0.06 : 0.35),
    elevations: new Uint8Array(width * height),
    rampIds: new Int32Array(width * height).fill(-1),
    cliffCells: new Uint8Array(width * height),
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x > 0 && y > 0 && x < width - 1 && y < height - 1) continue;
      world.heights[y * width + x] = -0.5;
      world.cells[y * width + x] = 0;
    }
  }
  return world;
}

function render(world: World, influences: GroundInfluences = {}) {
  const commands: { x: number; y: number; width: number; height: number; color: string }[] = [];
  drawIslandGround({
    fillStyle: '',
    fillRect(x: number, y: number, width: number, height: number) {
      commands.push({ x, y, width, height, color: String(this.fillStyle) });
    },
  }, world, influences);
  return commands;
}

function pixels(commands: ReturnType<typeof render>) {
  const raster = new Map<string, string>();
  for (const command of commands) {
    for (let y = command.y; y < command.y + command.height; y++) {
      for (let x = command.x; x < command.x + command.width; x++) raster.set(`${x},${y}`, command.color);
    }
  }
  return raster;
}

describe('Island ground artwork', () => {
  it('keeps textured grass on flat shapes without patch-edge shadows or highlights', () => {
    const world = fixture();
    const commands = render(world);
    const raster = pixels(commands);
    const interiorArea = (world.width - 4) * (world.height - 4) * world.tileSize ** 2;
    expect(raster.size / interiorArea).toBe(1);
    const baseColors = ['#85cc49', '#a8cf65', '#72ad59', '#c4b878'];
    const firstDetail = commands.findIndex((command, i) => i > 0 && command.y < commands[i - 1].y);
    expect(firstDetail).toBeGreaterThan(0);
    const surface = pixels(commands.slice(0, firstDetail));
    expect(new Set(surface.values()).size).toBeGreaterThanOrEqual(3);
    expect([...surface.values()].every(color => baseColors.includes(color))).toBe(true);
    expect(commands.slice(0, firstDetail).every(command => command.height === 1)).toBe(true);
    const strokes = commands.slice(firstDetail).filter(command => command.height === 2);
    expect(strokes.length).toBeGreaterThan(20);
    expect(new Set(strokes.map(command => command.y % 7)).size).toBeGreaterThan(3);
    expect(new Set(raster.values()).size).toBeGreaterThanOrEqual(6);
    expect(new Set(raster.values()).size).toBeLessThanOrEqual(12);
    for (const command of commands.slice(firstDetail)) {
      const base = surface.get(`${command.x},${command.y}`);
      for (let y = command.y; y < command.y + command.height; y++) {
        for (let x = command.x; x < command.x + command.width; x++) {
          expect(surface.get(`${x},${y}`)).toBe(base);
        }
      }
    }
    let isolated = 0;
    for (const [point, color] of surface) {
      const [x, y] = point.split(',').map(Number);
      if ([[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
        .every(([nx, ny]) => surface.get(`${nx},${ny}`) !== color)) isolated++;
    }
    expect(isolated).toBe(0);
  });

  it.each([1, 2])('matches the surrounding terrace turf at level %i without a square inset seam', level => {
    const world = fixture();
    world.elevations!.fill(level);
    const commands = render(world);
    const firstDetail = commands.findIndex((command, i) => i > 0 && command.y < commands[i - 1].y);
    const surface = pixels(commands.slice(0, firstDetail));
    for (let y = 8; y < (world.height - 2) * world.tileSize; y++) {
      expect(surface.get(`8,${y}`)).toBe(ISLAND_GRASS_COLORS[level]);
    }
    expect(new Set(surface.values()).size).toBeGreaterThan(1);
  });

  it('rounds growth away from a staircase-shaped cliff guard instead of clipping it to tile corners', () => {
    const world = fixture();
    for (let y = 1; y < world.height - 1; y++) {
      for (let x = 1; x < 12 + Math.floor(y / 5); x++) {
        world.cliffCells![y * world.width + x] = 1;
      }
    }
    const commands = render(world, { canopy: new Float32Array(world.heights.length).fill(1) });
    const firstDetail = commands.findIndex((command, i) => i > 0 && command.y < commands[i - 1].y);
    const surface = pixels(commands.slice(0, firstDetail));
    const patches = [...surface].filter(([, color]) => color !== ISLAND_GRASS_COLORS[0]);
    expect(patches.length).toBeGreaterThan(500);
    for (const [point] of patches) {
      const [x, y] = point.split(',').map(Number);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          expect(surface.has(`${x + dx},${y + dy}`)).toBe(true);
        }
      }
    }
  });

  describe('Island ground habitat field', () => {
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    const points = Array.from({ length: 400 }, (_, i) => [12 + i % 20 * 11, 12 + Math.floor(i / 20) * 8]);

    it.each([0, 42, 902479, 4294967295])('normalizes overlapping weights and is order-independent for seed %i', seed => {
      const world = fixture();
      world.seed = seed;
      const field = createIslandGroundField(world);
      const before = structuredClone(world);
      for (const [x, y] of points) {
        const sample = field.sample(x, y);
        expect(Object.values(sample).every(Number.isFinite)).toBe(true);
        expect(sample.turf + sample.meadow + sample.moss + sample.earth).toBeCloseTo(1, 12);
        for (const key of ['turf', 'meadow', 'moss', 'earth', 'moisture', 'shelter', 'coast'] as const) {
          expect(sample[key]).toBeGreaterThanOrEqual(0);
          expect(sample[key]).toBeLessThanOrEqual(1);
        }
        field.sample(y, x);
        expect(field.sample(x, y)).toEqual(sample);
      }
      expect(world).toEqual(before);
    });

    it('keeps broad variation stronger than pixel-scale breakup, without hard region jumps', () => {
      const field = createIslandGroundField(fixture());
      const differences = (distance: number) => points.map(([x, y]) =>
        Math.abs(field.sample(x, y).moss - field.sample(x + distance, y).moss));
      expect(mean(differences(32))).toBeGreaterThan(mean(differences(1)) * 4);
      expect(Math.max(...differences(1))).toBeLessThan(0.045);
      const moss = points.map(([x, y]) => field.sample(x, y).moss);
      expect(Math.max(...moss) - Math.min(...moss)).toBeGreaterThan(0.2);
    });

    it('supports real canopy input without inventing trees or tree shadows', () => {
      const world = fixture();
      const open = createIslandGroundField(world);
      const shaded = createIslandGroundField(world, { canopy: new Float32Array(world.heights.length).fill(1) });
      expect(mean(points.map(([x, y]) => shaded.sample(x, y).moss)))
        .toBeGreaterThan(mean(points.map(([x, y]) => open.sample(x, y).moss)) + 0.1);
      expect(mean(points.map(([x, y]) => shaded.sample(x, y).meadow)))
        .toBeLessThan(mean(points.map(([x, y]) => open.sample(x, y).meadow)));
      expect(open.sample(80, 80).shelter).toBe(0);
    });

    it('reduces moss on disturbed ground, and suppresses lush moss on exposed coasts', () => {
      const world = fixture();
      const natural = createIslandGroundField(world);
      const disturbed = createIslandGroundField(world, { disturbance: new Float32Array(world.heights.length).fill(1) });
      expect(mean(points.map(([x, y]) => disturbed.sample(x, y).moss)))
        .toBeLessThan(mean(points.map(([x, y]) => natural.sample(x, y).moss)) * 0.25);
      expect(mean(points.map(([x, y]) => disturbed.sample(x, y).earth))).toBeGreaterThan(0.1);
      const coastalWorld = fixture();
      for (let y = 0; y < world.height; y++) {
        for (let x = 0; x < 20; x++) coastalWorld.heights[y * world.width + x] = -0.5;
      }
      const coastal = createIslandGroundField(coastalWorld);
      const near = Array.from({ length: 30 }, (_, y) => [84, 36 + y * 4]);
      expect(mean(near.map(([x, y]) => coastal.sample(x, y).moss)))
        .toBeLessThan(mean(near.map(([x, y]) => natural.sample(x, y).moss)));
    });

    it('shelters cliff feet rather than exposed terrace tops, with no blanket elevation-based moss', () => {
      const world = fixture();
      for (let y = 1; y < world.height - 1; y++) {
        for (let x = 1; x < 20; x++) world.elevations![y * world.width + x] = 1;
      }
      const field = createIslandGroundField(world);
      expect(field.sample(82, 82).shelter).toBeGreaterThan(0.5);
      expect(field.sample(74, 82).shelter).toBe(0);
      expect(field.sample(130, 82).shelter).toBe(0);
    });

    it('does not propagate stair disturbance through water or another elevation', () => {
      const world = fixture();
      world.rampIds![20 * world.width + 20] = 0;
      world.elevations!.fill(1);
      world.elevations![20 * world.width + 20] = 0;
      const stairs = createIslandGroundField(world);
      world.rampIds!.fill(-1);
      const noStairs = createIslandGroundField(world);
      expect(stairs.sample(90, 82)).toEqual(noStairs.sample(90, 82));
    });

    it('rejects malformed or nonfinite habitat inputs explicitly', () => {
      const world = fixture();
      expect(() => createIslandGroundField(world, { canopy: new Float32Array(2) })).toThrow(/per world cell/);
      for (const invalid of [NaN, Infinity, -0.1, 1.1]) {
        const canopy = new Float32Array(world.heights.length);
        canopy[0] = invalid;
        expect(() => createIslandGroundField(world, { canopy })).toThrow(/finite value/);
      }
    });
  });

  it('lifts the same ground pattern with the elevation without moving any artwork', () => {
    const world = fixture();
    const low = pixels(render(world));
    world.elevations!.fill(2);
    const high = pixels(render(world));
    expect([...high.keys()]).toEqual([...low.keys()]);
    for (const [point, color] of low) {
      const elevated = high.get(point)!;
      for (const start of [1, 3, 5]) {
        expect(Number.parseInt(elevated.slice(start, start + 2), 16))
          .toBeGreaterThan(Number.parseInt(color.slice(start, start + 2), 16));
      }
    }
  });

  it('gives sand aligned curved strokes rather than grass clusters or square patches', () => {
    const commands = render(fixture(true));
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.length % 5).toBe(0);
    expect(commands.every(command => command.height === 1 && [1, 2, 3].includes(command.width))).toBe(true);
    expect(new Set(commands.map(command => command.color))).toEqual(new Set(['#d4bb76', '#f0d99a']));
    for (let i = 0; i < commands.length; i += 5) {
      expect(commands[i + 1].x - commands[i].x).toBe(commands[i].width);
      expect(commands[i + 1].y - commands[i].y).toBe(-1);
      expect(commands[i + 2].x - commands[i].x).toBe(commands[i].width * 2);
      expect(commands[i + 2].y - commands[i].y).toBe(-2);
    }
  });

  it('keeps ground variation seed-stable without changing terrain data', () => {
    const world = fixture();
    const before = structuredClone(world);
    const commands = render(world);
    expect(render(world)).toEqual(commands);
    expect(world).toEqual(before);
    world.seed++;
    expect(render(world)).not.toEqual(commands);
  });

  it.each([0, 6, 43, 902479])('preserves shoreline, stair, cliff and elevation boundaries for seed %i', seed => {
    const world = generateIslandWorld(seed);
    const before = structuredClone(world);
    const commands = render(world);
    expect(world).toEqual(before);
    if (seed !== 6) expect(commands.some(command => command.color === '#d4bb76')).toBe(true);
    for (const command of commands) {
      expect([command.x, command.y, command.width, command.height].every(Number.isInteger)).toBe(true);
      expect(command.width).toBeGreaterThan(0);
      expect(command.height).toBeGreaterThan(0);
    }
    for (const point of pixels(commands).keys()) {
      const [x, y] = point.split(',').map(Number);
      const cx = Math.floor(x / world.tileSize);
      const cy = Math.floor(y / world.tileSize);
      expect(cx).toBeGreaterThan(0);
      expect(cy).toBeGreaterThan(0);
      expect(cx).toBeLessThan(world.width - 1);
      expect(cy).toBeLessThan(world.height - 1);
      const i = cy * world.width + cx;
      const probes = world.heights[i] > 0.12
        ? [i, i - 1, i + 1, i - world.width, i + world.width]
        : [[x, y], [x - 2, y], [x + 2, y], [x, y - 2], [x, y + 2]]
          .map(([px, py]) => Math.floor(py / world.tileSize) * world.width + Math.floor(px / world.tileSize));
      for (const n of probes) {
        expect(world.heights[n]).toBeGreaterThan(world.seaLevel);
        expect(world.cliffCells![n]).toBe(0);
        expect(world.rampIds![n]).toBe(-1);
        expect(world.elevations![n]).toBe(world.elevations![i]);
        expect(world.heights[n] > 0.12).toBe(world.heights[i] > 0.12);
      }
    }
  });
});
