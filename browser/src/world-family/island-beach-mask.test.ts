import { describe, expect, it } from 'vitest';
import { generateIslandLandform } from './core/island-landform';
import { islandBeachHeightAt } from './core/island-beach-shelf';
import { createCurvedBeachMask, roundedBeachCoverage } from './render/island-beach-mask';
import { createIslandSurface } from './render/island-surface';
import { createIslandShoreField } from './render/island-shore-field';

describe('rounded sand-to-grass seam', () => {
  it('rounds square corners without blurring the material decision or changing its source', () => {
    const source = new Uint8Array(128 * 128);
    for (let y = 40; y < 88; y++) for (let x = 40; x < 88; x++) source[y * 128 + x] = 1;
    const before = source.slice(), coverage = roundedBeachCoverage(128, 128, source);
    expect(source).toEqual(before);
    expect(coverage).toEqual(roundedBeachCoverage(128, 128, source));
    expect(coverage[40 * 128 + 40]).toBeLessThan(0.5);
    expect(coverage[64 * 128 + 40]).toBeGreaterThan(0.5);
    expect(coverage[48 * 128 + 48]).toBeGreaterThan(0.5);
    expect(coverage[64 * 128 + 64]).toBe(1);
    expect(coverage[19 * 128 + 19]).toBe(0);
    expect([...coverage].every(value => value >= 0 && value <= 1)).toBe(true);
    expect(() => roundedBeachCoverage(2, 2, new Uint8Array(3))).toThrow('binary pixel grid');
  });

  it('turns a long straight source seam into a continuous broad curve', () => {
    const width = 256, height = 256, source = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 128; x < width; x++) source[y * width + x] = 1;
    const mask = createCurvedBeachMask(width, height, source, 153058);
    const again = createCurvedBeachMask(width, height, source, 153058);
    const crossings: number[] = [];
    for (let y = 32; y < height - 32; y++) {
      let first = -1, changes = 0, previous = false;
      for (let x = 96; x <= 160; x++) {
        const selected = mask(x, y, 1);
        expect(selected).toBe(again(x, y, 1));
        if (selected !== previous) changes++;
        if (selected && first < 0) first = x;
        previous = selected;
      }
      expect(changes).toBe(1);
      crossings.push(first);
    }
    expect(Math.max(...crossings) - Math.min(...crossings)).toBeGreaterThanOrEqual(10);
    expect(crossings.slice(1).every((x, i) => Math.abs(x - crossings[i]) <= 2)).toBe(true);
    let longest = 1, run = 1;
    for (let i = 1; i < crossings.length; i++) {
      run = crossings[i] === crossings[i - 1] ? run + 1 : 1;
      longest = Math.max(longest, run);
    }
    expect(longest).toBeLessThan(32);
    expect(mask(127, 100, 0)).toBe(false);
    expect(mask(128, 100, 0)).toBe(true);
    expect(() => mask(0, 0, 2)).toThrow('strength');
  });

  it('keeps a narrow beach connected to its water side while curving only its inland edge', () => {
    const width = 256, height = 256, ground = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 80; x < width; x++) ground[y * width + x] = 1;
    const mask = createCurvedBeachMask(width, height, ground, 153034);
    for (let y = 32; y < height - 32; y++) {
      for (let x = 0; x < 64; x++) expect(mask(x, y, 1)).toBe(false);
      let transitions = 0, previous = false;
      for (let x = 0; x < 128; x++) {
        const selected = mask(x, y, 1);
        transitions += Number(selected !== previous);
        previous = selected;
      }
      expect(transitions).toBe(1);
    }
  });

  it.each([12, 91, 153028, 153034, 153035, 153050, 153058, 153059, 153060])('restricts curves to flat lowland beaches for seed %i', seed => {
    const island = generateIslandLandform(seed), before = structuredClone(island);
    const shore = createIslandShoreField(island.world);
    const raw = createIslandSurface(island.world, shore, island.ascents, island.edges, island.beach);
    const rounded = createIslandSurface(island.world, shore, island.ascents, island.edges, island.beach,
      undefined, island.coast ?? island.cove, island.triangles);
    const { world } = island, size = world.tileSize;
    let changed = 0, retainedWet = 0;
    for (let y = 0; y < world.height * size; y += 2) for (let x = 0; x < world.width * size; x += 2) {
      const px = x + 0.5, py = y + 0.5, cell = { x: Math.floor(px / size), y: Math.floor(py / size) };
      const index = cell.y * world.width + cell.x;
      if (!world.cells[index]) continue;
      const a = raw.material(px, py), b = rounded.material(px, py);
      if (a === 'wet-sand') { expect(b).toBe(a); retainedWet++; }
      if (a === b) continue;
      expect([a, b].sort()).toEqual(['dry-sand', 'turf']);
      expect(world.elevations![index]).toBe(0);
      expect(world.rampIds![index]).toBe(-1);
      expect(islandBeachHeightAt(world, island.beach, cell, { x: px, y: py }) ?? 0).toBe(0);
      if (shore.distance(px, py) > -8) {
        expect(b).toBe('dry-sand');
        expect(shore.sample(px, py).beachWeight).toBeGreaterThan(0.5);
      }
      changed++;
    }
    for (const triangle of [...island.triangles, ...island.beach.underwaterTriangles]) {
      if (triangle.plane === 'top' && !triangle.submerged && triangle.level === 0 && triangle.ascentId === undefined) continue;
      const point = {
        x: triangle.vertices.reduce((sum, p) => sum + p.x, 0) / 3,
        y: triangle.vertices.reduce((sum, p) => sum + p.y, 0) / 3,
        z: triangle.vertices.reduce((sum, p) => sum + p.z, 0) / 3,
      };
      // Sand edges lose the retired green finish; other side materials retain their source.
      expect(rounded.regions(triangle, point)).toEqual(raw.regions(triangle, point));
    }
    expect(changed).toBeGreaterThan(0);
    expect(retainedWet).toBeGreaterThan(0);
    expect(island).toEqual(before);
  });
});
