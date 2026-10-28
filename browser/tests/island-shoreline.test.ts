import { describe, expect, it } from 'vitest';
import type { World } from '../src/core/contracts';
import { generateIslandWorld } from '../src/core/world';
import { islandContourField } from '../src/render/island-contour-field';
import { drawIslandShoreline } from '../src/render/island-shoreline';
import { islandMaterials } from '../src/render/island-materials';

function fixture(): World {
  const width = 40;
  const height = 32;
  const world: World = {
    width, height, tileSize: 4, seed: 42, seaLevel: 0,
    generatorVersion: 'test', provenance: 'test-fixture',
    cells: new Uint8Array(width * height),
    heights: new Float32Array(width * height).fill(-0.1),
    elevations: new Uint8Array(width * height),
    rampIds: new Int32Array(width * height).fill(-1),
    cliffCells: new Uint8Array(width * height),
  };
  for (let y = 6; y < 26; y++) {
    for (let x = 3; x < 37; x++) {
      world.heights[y * width + x] = y >= 11 && y < 21 && x >= 8 && x < 32 ? 0.35 : 0.06;
      world.cells[y * width + x] = 1;
    }
  }
  return world;
}

function render(world: World, seconds?: number) {
  const pixels = new Map<string, string>();
  const context = {
    fillStyle: '',
    fillRect(x: number, y: number, width: number, height: number) {
      expect([x, y, width, height].every(Number.isInteger)).toBe(true);
      expect(width).toBeGreaterThan(0);
      expect(height).toBe(1);
      for (let px = x; px < x + width; px++) pixels.set(`${px},${y}`, String(this.fillStyle));
    },
  };
  const animation = drawIslandShoreline(context, world);
  if (seconds !== undefined) animation.drawWater(context, seconds);
  return pixels;
}

const foam = new Set(['#bae9e3', '#e5f5e9']);
const wet = new Set(['#bca66c', '#d4bb79']);

describe('Island shoreline artwork', () => {
  it('uses the terrace contour field for finer, bounded coastline detail', () => {
    const world = fixture();
    const materials = islandMaterials(world);
    const mask = Uint8Array.from(materials, material => Number(material > 0));
    expect(mask).toEqual(islandContourField(world, world.cells, 1));
    world.elevations = world.cells.slice();
    expect(mask).toEqual(islandContourField(world, world.elevations, 2));
    const width = world.width * world.tileSize;
    const rows = [];
    for (let x = 32; x < 128; x++) {
      const top = Array.from({ length: 32 }, (_, y) => y).find(y => materials[y * width + x]);
      expect(top).toBeDefined();
      expect(Math.abs(top! - 24)).toBeLessThanOrEqual(world.tileSize);
      rows.push(top!);
    }
    expect(new Set(rows).size).toBeGreaterThanOrEqual(3);
    expect(rows.filter(y => y % world.tileSize !== 0).length).toBeGreaterThan(rows.length / 4);
    let longest = 1;
    let run = 1;
    for (let i = 1; i < rows.length; i++) {
      run = rows[i] === rows[i - 1] ? run + 1 : 1;
      longest = Math.max(longest, run);
    }
    expect(longest).toBeLessThan(rows.length / 2);
    for (let i = 1; i < rows.length; i++) expect(Math.abs(rows[i] - rows[i - 1])).toBeLessThanOrEqual(1);
  });

  it('draws a prominent wet band, broken curved foam and a graded shallow-water fade', () => {
    const world = fixture();
    const pixels = render(world);
    const crestRows = new Set<number>();
    let foamingColumns = 0;
    for (let x = 32; x < 128; x++) {
      let found = false;
      for (let y = 19; y < 24; y++) {
        if (!foam.has(pixels.get(`${x},${y}`) ?? '')) continue;
        found = true;
        crestRows.add(y);
      }
      if (found) foamingColumns++;
      const wetPixels = [24, 25, 26, 27, 28].filter(y => wet.has(pixels.get(`${x},${y}`) ?? ''));
      expect(wetPixels.length).toBeGreaterThanOrEqual(2);
      expect(wetPixels.length).toBeLessThanOrEqual(4);
      expect(pixels.has(`${x},29`)).toBe(false);
    }
    expect(foamingColumns).toBeGreaterThan(24);
    expect(foamingColumns).toBeLessThan(80);
    expect(crestRows.size).toBeGreaterThan(1);
    expect(pixels.get('80,0')).toBe('#2698ee');
  });

  it('breaks the uniform halo with darker mottling and visibly uneven shallow-water widths', () => {
    const pixels = render(fixture());
    const lateralColors = new Set<string>();
    const widths: number[] = [];
    let nearGreen = 0;
    let farGreen = 0;
    for (let x = 32; x < 128; x++) {
      lateralColors.add(pixels.get(`${x},14`)!);
      nearGreen += Number.parseInt(pixels.get(`${x},18`)!.slice(3, 5), 16);
      farGreen += Number.parseInt(pixels.get(`${x},6`)!.slice(3, 5), 16);
      const edge = Array.from({ length: 20 }, (_, y) => y)
        .find(y => pixels.get(`${x},${y}`) !== '#2698ee')!;
      widths.push(24 - edge);
    }
    expect(lateralColors.size).toBeGreaterThanOrEqual(4);
    expect(Math.max(...widths) - Math.min(...widths)).toBeGreaterThanOrEqual(4);
    expect(nearGreen / 96 - farGreen / 96).toBeGreaterThan(10);
    for (const color of lateralColors) {
      expect(Number.parseInt(color.slice(3, 5), 16)).toBeLessThanOrEqual(185);
    }
  });

  it('is seed-stable without changing any terrain or navigation data', () => {
    const world = fixture();
    const before = structuredClone(world);
    const pixels = render(world);
    expect(render(world)).toEqual(pixels);
    expect(world).toEqual(before);
    world.seed++;
    expect(render(world)).not.toEqual(pixels);
  });

  it('moves and dissolves water detail at repeatable times while keeping wet sand and all land fixed', () => {
    const world = fixture();
    const before = structuredClone(world);
    const initial = render(world, 0);
    const materials = islandMaterials(world);
    const width = world.width * world.tileSize;
    const cliffColors = new Set(['#7b6344', '#d0ae7a', '#b28b60', '#4f573a', '#2387c7']);
    const frames = [0.5, 2, 4].map(seconds => render(world, seconds));
    for (const pixels of frames) {
      expect(pixels).not.toEqual(initial);
      expect([...pixels.keys()]).toEqual([...initial.keys()]);
      let changed = 0;
      for (const [point, color] of pixels) {
        if (color === initial.get(point)) continue;
        changed++;
        const [x, y] = point.split(',').map(Number);
        expect(materials[y * width + x]).toBe(0);
        expect(cliffColors.has(initial.get(point)!)).toBe(false);
      }
      expect(changed).toBeGreaterThan(100);
    }
    expect(render(world, 0)).toEqual(initial);
    expect(render(world, 2)).toEqual(frames[1]);
    expect(world).toEqual(before);
  });

  it('excludes elevated sand, cliff cells and sandy ramps from wet sand', () => {
    const world = fixture();
    world.elevations![6 * world.width + 12] = 1;
    world.cliffCells![6 * world.width + 18] = 1;
    world.rampIds![6 * world.width + 24] = 0;
    const pixels = render(world);
    for (const cx of [12, 18, 24]) {
      for (let y = 24; y < 28; y++) {
        for (let x = cx * 4; x < (cx + 1) * 4; x++) expect(pixels.has(`${x},${y}`)).toBe(false);
      }
    }
  });

  it.each([0, 6, 43, 902479])('aligns coastal land, cliff feet and water while preserving stairs and interiors for seed %i', seed => {
    const world = generateIslandWorld(seed);
    const before = structuredClone(world);
    const pixels = render(world);
    const materials = islandMaterials(world);
    const width = world.width * world.tileSize;
    const cliffColors = ['#7b6344', '#d0ae7a', '#b28b60', '#4f573a', '#2387c7'];
    expect(world).toEqual(before);
    expect([...pixels.values()].some(color => wet.has(color))).toBe(true);
    expect([...pixels.values()].some(color => foam.has(color))).toBe(true);
    for (const [point, color] of pixels) {
      const [x, y] = point.split(',').map(Number);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(world.width * world.tileSize);
      expect(y).toBeLessThan(world.height * world.tileSize);
      const cx = Math.floor(x / world.tileSize);
      const cy = Math.floor(y / world.tileSize);
      const cell = cy * world.width + cx;
      const material = materials[y * width + x];
      expect(world.rampIds![cell]).toBe(-1);
      expect(world.elevations![cell]).toBe(0);
      expect(world.cliffCells![cell]).toBe(0);
      if (wet.has(color)) {
        expect(material).toBe(2);
      }
      if (material) {
        expect([2, 3]).toContain(material);
        let nearWater = false;
        for (let dy = -5; dy <= 5; dy++) {
          for (let dx = -5; dx <= 5; dx++) {
            if (materials[(y + dy) * width + x + dx] === 0) nearWater = true;
          }
        }
        expect(nearWater).toBe(true);
      } else {
        let depth = 0;
        for (let d = 1; d <= 5 && d <= y; d++) {
          const above = materials[(y - d) * width + x];
          if (!above) continue;
          if (above === 3) depth = d;
          break;
        }
        if (depth) expect(color).toBe(cliffColors[depth - 1]);
        else expect(cliffColors).not.toContain(color);
      }
    }
  });
});
