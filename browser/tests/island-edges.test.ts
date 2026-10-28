import { describe, expect, it } from 'vitest';
import type { World } from '../src/core/contracts';
import { generateIslandWorld } from '../src/core/world';
import { drawIslandEdges } from '../src/render/island-edges';
import { islandMaterials } from '../src/render/island-materials';

const grasses = ['#85cc49', '#99cf63', '#b5d982'];

function fixture(): World {
  const width = 12;
  const height = 10;
  const world: World = {
    width, height, tileSize: 4, seed: 42, seaLevel: 0,
    generatorVersion: 'test', provenance: 'test-fixture',
    cells: new Uint8Array(width * height).fill(1),
    heights: new Float32Array(width * height).fill(0.35),
    elevations: new Uint8Array(width * height),
    cliffCells: new Uint8Array(width * height),
    rampIds: new Int32Array(width * height).fill(-1),
    ramps: [{
      surface: 'sand', rect: { x: 5, y: 3, width: 3, height: 4 },
      direction: { x: 0, y: 1 }, highCell: { x: 6, y: 3 }, lowCell: { x: 6, y: 6 },
      upperLevel: 1, lowerLevel: 0,
    }],
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (x >= 2 && x <= 8 && y >= 1 && y <= 3) world.elevations![i] = 1;
      if (x >= 2 && x <= 8 && y >= 4 && y <= 5) world.cliffCells![i] = 1;
      if (x >= 9 && y >= 2 && y <= 7) world.heights[i] = 0.06;
      if (x >= 5 && x <= 7 && y >= 3 && y <= 6) {
        world.rampIds![i] = 0;
        world.cliffCells![i] = 0;
      }
      if (x === width - 1 || y === height - 1) {
        world.heights[i] = -0.5;
        world.cells[i] = 0;
      }
    }
  }
  return world;
}

function render(world: World) {
  const commands: { x: number; y: number; width: number; height: number; color: string }[] = [];
  const context = {
    fillStyle: '',
    fillRect(x: number, y: number, width: number, height: number) {
      commands.push({ x, y, width, height, color: this.fillStyle });
    },
  };
  drawIslandEdges(context, world, grasses);
  return commands;
}

function pixels(commands: ReturnType<typeof render>) {
  const result = new Map<string, string>();
  for (const command of commands) {
    for (let y = command.y; y < command.y + command.height; y++) {
      for (let x = command.x; x < command.x + command.width; x++) result.set(`${x},${y}`, command.color);
    }
  }
  return result;
}

describe('Island terrain edge artwork', () => {
  it('joins the turf, face and base shadow along one fine-grained contour', () => {
    const world = fixture();
    world.width = 48;
    world.height = 32;
    const size = world.width * world.height;
    world.cells = new Uint8Array(size).fill(1);
    world.heights = new Float32Array(size).fill(0.35);
    world.elevations = new Uint8Array(size);
    world.cliffCells = new Uint8Array(size);
    world.rampIds = new Int32Array(size).fill(-1);
    world.ramps = [];
    for (let y = 5; y <= 21; y++) {
      for (let x = 5; x <= 41; x++) {
        const i = y * world.width + x;
        if (y <= 19) world.elevations[i] = 1;
        else world.cliffCells[i] = 1;
      }
    }
    const raster = pixels(render(world));
    const tops: number[] = [];
    for (let x = 28; x < 156; x++) {
      const top = Array.from({ length: 12 }, (_, d) => 74 + d)
        .find(y => raster.get(`${x},${y}`) === '#7b6344');
      expect(top).toBeDefined();
      tops.push(top!);
      expect(raster.get(`${x},${top! - 1}`)).toBe('#577337');
      expect(raster.get(`${x},${top! - 2}`)).toBe('#c2e69a');
      expect(raster.get(`${x},${top! + 6}`)).toBe('#4f573a');
      expect(raster.get(`${x},${top! + 7}`)).toBe('#4f573a');
      expect(raster.get(`${x},${top! + 8}`)).not.toBe('#4f573a');
    }
    expect(new Set(tops).size).toBeGreaterThanOrEqual(3);
    expect(tops.some(y => y % world.tileSize !== 0)).toBe(true);
    let longest = 1;
    let run = 1;
    for (let i = 1; i < tops.length; i++) {
      run = tops[i] === tops[i - 1] ? run + 1 : 1;
      longest = Math.max(longest, run);
      expect(Math.abs(tops[i] - tops[i - 1])).toBeLessThanOrEqual(1);
    }
    expect(longest).toBeLessThanOrEqual(32);
  });

  it('replaces coarse grass/sand boundaries with a connected source-pixel contour', () => {
    const world = fixture();
    world.width = 48;
    world.height = 32;
    const size = world.width * world.height;
    world.cells = new Uint8Array(size).fill(1);
    world.heights = new Float32Array(size).fill(0.35);
    world.elevations = new Uint8Array(size);
    world.cliffCells = new Uint8Array(size);
    world.rampIds = new Int32Array(size).fill(-1);
    world.ramps = [];
    for (let y = 16; y < world.height; y++) {
      world.heights.fill(0.06, y * world.width, (y + 1) * world.width);
    }
    const materials = islandMaterials(world);
    const raster = pixels(render(world));
    const width = world.width * world.tileSize;
    const rows: number[] = [];
    const sandColors = new Set(['#e7cf85', '#c7b173', '#ecd793']);
    let replaced = 0;
    for (let x = 28; x < 156; x++) {
      const top = Array.from({ length: 16 }, (_, d) => 56 + d)
        .find(y => materials[y * width + x] === 2);
      expect(top).toBeDefined();
      rows.push(top!);
      expect(Math.abs(top! - 64)).toBeLessThanOrEqual(world.tileSize);
      for (let y = 56; y < 72; y++) {
        const material = materials[y * width + x];
        const original = y < 64 ? 3 : 2;
        if (material === original) continue;
        replaced++;
        if (material === 3) expect(raster.get(`${x},${y}`)).toBe(grasses[0]);
        else expect(sandColors.has(raster.get(`${x},${y}`)!)).toBe(true);
      }
    }
    expect(replaced).toBeGreaterThan(30);
    expect(new Set(rows).size).toBeGreaterThanOrEqual(3);
    expect(rows.some(y => y % world.tileSize !== 0)).toBe(true);
    for (let i = 1; i < rows.length; i++) expect(Math.abs(rows[i] - rows[i - 1])).toBeLessThanOrEqual(1);
  });

  it('does not mistake another elevation for a same-level material neighbor', () => {
    const world = fixture();
    const materials = islandMaterials(world);
    for (let y = 12; y < 16; y++) {
      for (let x = 36; x < 40; x++) expect(materials[y * world.width * world.tileSize + x]).toBe(2);
    }
  });

  it('continues contoured cliff faces across a sandy base instead of leaving block-shaped gaps', () => {
    const world = fixture();
    world.rampIds!.fill(-1);
    world.ramps = [];
    world.elevations!.fill(0);
    world.cliffCells!.fill(0);
    world.cells.fill(1);
    world.heights.fill(0.06);
    for (let y = 1; y <= 3; y++) {
      for (let x = 2; x <= 8; x++) {
        world.elevations![y * world.width + x] = 1;
        world.heights[y * world.width + x] = 0.35;
      }
    }
    for (let y = 4; y <= 5; y++) {
      for (let x = 2; x <= 8; x++) world.cliffCells![y * world.width + x] = 1;
    }
    const raster = pixels(render(world));
    const colors = new Set(['#7b6344', '#b28b60', '#886743', '#d0ae7a', '#aa8559', '#4f573a']);
    for (let x = 12; x < 32; x++) {
      expect(Array.from({ length: 12 }, (_, d) => raster.get(`${x},${14 + d}`))
        .filter(color => color && colors.has(color)).length).toBeGreaterThanOrEqual(6);
    }
  });

  it.each(['fixture', '0', '6', '43', '902479'])('is deterministic, leaves %s data intact, and supplies the terrain beneath sandy cuts', seed => {
    const world = seed === 'fixture' ? fixture() : generateIslandWorld(Number(seed));
    const before = structuredClone(world);
    const commands = render(world);
    const materials = islandMaterials(world);
    expect(render(world)).toEqual(commands);
    expect(world).toEqual(before);
    for (const command of commands) {
      expect(command.width).toBeGreaterThan(0);
      expect(command.height).toBeGreaterThan(0);
      expect([command.x, command.y, command.width, command.height].every(Number.isInteger)).toBe(true);
    }
    for (const point of pixels(commands).keys()) {
      const [x, y] = point.split(',').map(Number);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(world.width * world.tileSize);
      expect(y).toBeLessThan(world.height * world.tileSize);
      const i = Math.floor(y / world.tileSize) * world.width + Math.floor(x / world.tileSize);
      expect(world.heights[i] > world.seaLevel || materials[y * world.width * world.tileSize + x] >= 2).toBe(true);
      const rampId = world.rampIds![i];
      if (rampId >= 0) expect(world.ramps![rampId].surface).toBe('sand');
    }
  });

  it('continues the cliff strata beneath sandy shoulders but excludes historical grass ramps', () => {
    const world = fixture();
    const ramp = world.ramps![0];
    const inCrossing = (commands: ReturnType<typeof render>) => [...pixels(commands)].filter(([key]) => {
      const [x, y] = key.split(',').map(Number);
      return x >= ramp.rect.x * 4 && x < (ramp.rect.x + ramp.rect.width) * 4
        && y >= ramp.rect.y * 4 && y < (ramp.rect.y + ramp.rect.height) * 4;
    });
    const underlay = inCrossing(render(world));
    expect(underlay.length).toBeGreaterThan(0);
    expect(underlay.some(([, color]) => color === '#b28b60' || color === '#886743')).toBe(true);
    delete ramp.surface;
    expect(inCrossing(render(world))).toEqual([]);
  });
});
