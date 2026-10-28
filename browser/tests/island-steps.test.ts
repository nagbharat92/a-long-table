import { describe, expect, it } from 'vitest';
import type { Ramp, World } from '../src/core/contracts';
import { generateIslandWorld } from '../src/core/world';
import { drawIslandSteps, islandStepRecipe } from '../src/render/island-steps';
import { ISLAND_STEP_PALETTES } from '../src/render/island-step-palette';
import { ISLAND_GRASS_COLORS } from '../src/render/island-ground';

function fixture(dx: number, dy: number, seed: number, span = 3) {
  const ramp: Ramp = {
    surface: 'sand', highCell: { x: 8, y: 8 }, lowCell: { x: 8 + dx * span, y: 8 + dy * span },
    direction: { x: dx, y: dy }, upperLevel: 1, lowerLevel: 0,
    rect: {
      x: 8 + Math.min(0, dx * span) - Number(!dx),
      y: 8 + Math.min(0, dy * span) - Number(!dy),
      width: dx ? span + 1 : 3, height: dy ? span + 1 : 3,
    },
  };
  const world: World = {
    width: 20, height: 20, tileSize: 4, seed, seaLevel: 0,
    generatorVersion: 'test', provenance: 'test-fixture',
    cells: new Uint8Array(400).fill(1), heights: new Float32Array(400).fill(1),
    elevations: new Uint8Array(400), cliffCells: new Uint8Array(400),
    rampIds: new Int32Array(400).fill(-1), ramps: [ramp],
  };
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 20; x++) {
      const i = y * 20 + x;
      world.elevations![i] = Number((x - 8) * dx + (y - 8) * dy <= 0);
      if (x >= ramp.rect.x && x < ramp.rect.x + ramp.rect.width
        && y >= ramp.rect.y && y < ramp.rect.y + ramp.rect.height) world.rampIds![i] = 0;
    }
  }
  return { world, ramp };
}

function render(world: World, ramp: Ramp) {
  const pixels = new Map<string, string>();
  const context = {
    fillStyle: '',
    fillRect(x: number, y: number, w: number, h: number) {
      expect([x, y, w, h].every(Number.isInteger)).toBe(true);
      expect(w).toBeGreaterThan(0);
      expect(h).toBeGreaterThan(0);
      for (let v = y; v < y + h; v++) {
        for (let u = x; u < x + w; u++) pixels.set(`${u},${v}`, this.fillStyle);
      }
    },
  };
  drawIslandSteps(context, world, ramp);
  return pixels;
}

function connected(pixels: Map<string, string>) {
  const first = pixels.keys().next().value!;
  const seen = new Set([first]), queue = [first];
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i].split(',').map(Number);
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const key = `${x + dx},${y + dy}`;
      if (!pixels.has(key) || seen.has(key)) continue;
      seen.add(key);
      queue.push(key);
    }
  }
  expect(seen.size).toBe(pixels.size);
}

const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]];
const cases = directions.flatMap(([dx, dy]) => [0, 1, 2, 42, 43, 902479]
  .flatMap(seed => [3, 4].map(span => ({ dx, dy, seed, span }))));
const surface = new Set<string>(['#c4b878', ...ISLAND_STEP_PALETTES.flatMap(p => Object.values(p))]);

describe('terrain-integrated Island steps', () => {
  it.each(cases)('keeps a broad connected corridor $dx,$dy seed $seed span $span', ({ dx, dy, seed, span }) => {
    const { world, ramp } = fixture(dx, dy, seed, span);
    const before = structuredClone(world);
    const pixels = render(world, ramp);
    expect(render(world, ramp)).toEqual(pixels);
    expect(world).toEqual(before);
    connected(pixels);
    const { width, length, treads, upperLanding, lowerLanding } = islandStepRecipe(world, ramp);
    expect(treads[0].from).toBe(upperLanding);
    expect(treads.at(-1)!.to).toBe(length - lowerLanding);
    for (let i = 0; i < treads.length; i++) {
      expect(treads[i].to - treads[i].from).toBeGreaterThanOrEqual(3);
      if (i) expect(treads[i].from).toBe(treads[i - 1].to);
    }
    const origin = {
      x: (ramp.highCell.x + 0.5) * 4 - dx * 2 + dy * width / 2,
      y: (ramp.highCell.y + 0.5) * 4 - dy * 2 - dx * width / 2,
    };
    for (let a = 0; a < length; a++) {
      for (let s = width / 2 - 1; s <= width / 2 + 1; s++) {
        const x = Math.floor(origin.x + dx * (a + 0.5) - dy * (s + 0.5));
        const y = Math.floor(origin.y + dy * (a + 0.5) + dx * (s + 0.5));
        expect(surface.has(pixels.get(`${x},${y}`)!)).toBe(true);
      }
    }
    const external = [...pixels.keys()].filter(key => {
      const [x, y] = key.split(',').map(Number);
      return x < ramp.rect.x * 4 || x >= (ramp.rect.x + ramp.rect.width) * 4
        || y < ramp.rect.y * 4 || y >= (ramp.rect.y + ramp.rect.height) * 4;
    });
    expect(external.length).toBeGreaterThan(0);
    for (const key of external) {
      const [x, y] = key.split(',').map(Number);
      const i = Math.floor(y / 4) * world.width + Math.floor(x / 4);
      expect(world.cells[i]).toBe(1);
      expect(world.heights[i]).toBeGreaterThan(world.seaLevel);
      expect(world.cliffCells![i]).toBe(0);
      expect(world.rampIds![i]).toBe(-1);
      const upper = (x / 4 - ramp.highCell.x) * dx + (y / 4 - ramp.highCell.y) * dy < 0;
      expect(world.elevations![i]).toBe(upper ? ramp.upperLevel : ramp.lowerLevel);
    }
  });

  it('varies structure as well as color, including between crossings on the same island', () => {
    const recipes = Array.from({ length: 30 }, (_, seed) => {
      const { world, ramp } = fixture(0, 1, seed, 4);
      return islandStepRecipe(world, ramp);
    });
    expect(new Set(recipes.map(r => r.variant)).size).toBe(3);
    expect(new Set(recipes.map(r => JSON.stringify(r.treads))).size).toBeGreaterThan(10);
    expect(recipes.some(r => new Set(r.treads.map(t => t.to - t.from)).size > 1)).toBe(true);
    const { world, ramp } = fixture(0, 1, 902479, 4);
    const other = structuredClone(ramp);
    other.highCell.x += 8;
    other.lowCell.x += 8;
    other.rect.x += 8;
    expect(islandStepRecipe(world, ramp)).not.toEqual(islandStepRecipe(world, other));
  });

  it.each(directions.flatMap(([dx, dy]) =>
    ['water', 'sea height', 'cliff', 'other crossing', 'wrong level', 'bounds']
      .map(obstacle => ({ dx, dy, obstacle }))))('guards exterior and turf donors $dx,$dy $obstacle', ({ dx, dy, obstacle }) => {
    const { world, ramp } = fixture(dx, dy, 42);
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        if (x >= ramp.rect.x && x < ramp.rect.x + ramp.rect.width
          && y >= ramp.rect.y && y < ramp.rect.y + ramp.rect.height) continue;
        const i = y * world.width + x;
        if (obstacle === 'water') world.cells[i] = 0;
        if (obstacle === 'sea height') world.heights[i] = world.seaLevel;
        if (obstacle === 'cliff') world.cliffCells![i] = 1;
        if (obstacle === 'other crossing') world.rampIds![i] = 1;
        if (obstacle === 'wrong level') world.elevations![i] = 2;
      }
    }
    if (obstacle === 'bounds') {
      world.width = ramp.rect.x + ramp.rect.width;
      world.height = ramp.rect.y + ramp.rect.height;
      world.rampIds!.fill(1);
    }
    const pixels = render(world, ramp);
    for (const [key, color] of pixels) {
      const [x, y] = key.split(',').map(Number);
      expect(x).toBeGreaterThanOrEqual(ramp.rect.x * 4);
      expect(y).toBeGreaterThanOrEqual(ramp.rect.y * 4);
      expect(x).toBeLessThan((ramp.rect.x + ramp.rect.width) * 4);
      expect(y).toBeLessThan((ramp.rect.y + ramp.rect.height) * 4);
      expect(ISLAND_GRASS_COLORS).not.toContain(color);
    }
    connected(pixels);
  });

  it.each([0, 43, 902479])('does not mutate generated island %i', seed => {
    const world = generateIslandWorld(seed);
    const before = structuredClone(world);
    for (const ramp of world.ramps!) connected(render(world, ramp));
    expect(world).toEqual(before);
  });
});
