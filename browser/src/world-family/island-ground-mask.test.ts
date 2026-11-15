import { createHash } from 'node:crypto';
import FastNoiseLite from 'fastnoise-lite';
import { describe, expect, it } from 'vitest';
import { islandColumnTriangles } from './core/island-columns';
import { generateIslandLandform } from './core/island-landform';
import type { LandTriangle, LandVertex } from './core/landform-study';
import { createGroundBeachClearance, createIslandGroundMask } from './render/island-ground-mask';
import { createIslandSurface, GROUND_PATCH_COLORS } from './render/island-surface';
import { createDefaultLayersInspection } from './render/landform-diagnostics';
import { createIslandSun, DEFAULT_SUN } from './render/island-sun';
import { surfaceNormal } from './render/surface-projection';

function rectangle(x: number, y: number, width: number, height: number, z: number) {
  return [{ x, y, z }, { x: x + width, y, z }, { x: x + width, y: y + height, z }, { x, y: y + height, z }];
}
const center = (triangle: LandTriangle): LandVertex => ({
  x: triangle.vertices.reduce((sum, p) => sum + p.x, 0) / 3,
  y: triangle.vertices.reduce((sum, p) => sum + p.y, 0) / 3,
  z: triangle.vertices.reduce((sum, p) => sum + p.z, 0) / 3,
});

describe('terrain-junction ground patch mask', () => {
  it.each([153028, 153050, 153058, 153059, 153060])('lights the unchanged ground masks on seed %i', seed => {
    const island = generateIslandLandform(seed), before = structuredClone(island);
    const triangles = [...island.triangles, ...island.beach.underwaterTriangles];
    let sun = createIslandSun(triangles, { ...DEFAULT_SUN, elevation: 15, shadowMode: 'hard' });
    const surface = createIslandSurface(island.world, undefined, island.ascents, island.edges, island.beach,
      () => sun, island.coast ?? island.cove, island.triangles);
    const width = island.world.width * island.world.tileSize, height = island.world.height * island.world.tileSize;
    const sand = Uint8Array.from({ length: width * height }, (_, i) =>
      Number(surface.material(i % width + 0.5, Math.floor(i / width) + 0.5).includes('sand')));
    const mask = createIslandGroundMask(island.triangles, seed, createGroundBeachClearance(width, height, sand));
    const colours = new Set<number>();
    const points: { triangle: LandTriangle; point: LandVertex }[] = [];
    let shadowed = 0;
    for (const triangle of island.triangles) {
      const point = center(triangle);
      if (triangle.plane !== 'top' || triangle.submerged || surface.material(point.x, point.y).includes('sand')) continue;
      const shade = mask.shade(point, triangle.ascentId === undefined ? triangle.level : triangle.ascentId + 64);
      const color = GROUND_PATCH_COLORS[shade], normal = surfaceNormal(triangle);
      const visibility = sun.visibility(point, normal);
      const expected = sun.shade(color, normal, visibility);
      colours.add(shade);
      expect(surface.shade(triangle, point)).toEqual(expected);
      expect(surface.shadeLayer(triangle, point)).toEqual(expected);
      expect(surface.shadeLayer(triangle, point, { ...createDefaultLayersInspection().base, lighting: false })).toEqual(color);
      expect(surface.shadeLayer(triangle, point, { ...createDefaultLayersInspection().base, textures: false, lighting: false }))
        .toEqual(GROUND_PATCH_COLORS[shade]);
      expect(surface.shadeLayer(triangle, point, undefined, { groundMask: true })).toEqual([shade, shade, shade]);
      if (visibility < 0.5) {
        const unshadowed = sun.shade(color, normal, 1);
        const difference = unshadowed.reduce((sum, value, channel) => sum + value - expected[channel], 0);
        expect(difference).toBeGreaterThan(0);
        if (difference > 30) shadowed++;
      }
      points.push({ triangle, point });
    }
    expect(colours.has(245)).toBe(true);
    expect(colours.has(255)).toBe(true);
    if (seed === 153028) {
      expect(colours).toEqual(new Set([120, 245, 255]));
      expect(shadowed).toBeGreaterThan(10);
    }
    sun = createIslandSun(triangles, { ...DEFAULT_SUN, intensity: 0, skyFill: 0 });
    for (const { triangle, point } of points) {
      expect(surface.shade(triangle, point)).toEqual([0, 0, 0]);
      expect(surface.shadeLayer(triangle, point)).toEqual([0, 0, 0]);
    }
    expect(island).toEqual(before);
  });

  it('reproduces the coordinated single-tone footprint', () => {
    const mask = createIslandGroundMask(islandColumnTriangles([
      { level: 1, vertices: rectangle(0, 0, 80, 20, 8) },
      { level: 0, vertices: rectangle(0, 20, 80, 40, 0) },
    ]), 42);
    const hash = createHash('sha256');
    for (let y = 0; y < 60; y++) for (let x = 0; x < 80; x++) {
      hash.update(String(Number(mask.sample({ x: x + 0.5, y: y + 0.5, z: y < 20 ? 8 : 0 }))));
    }
    expect(hash.digest('hex')).toMatchInlineSnapshot(`"61e17187fe90be97278231b1e7a4c34eaef1f00393ddbc8638bd8f255a283ba5"`);
  });

  it('joins crevice lobes into base green without yellow slivers at their boundary', () => {
    const triangles = islandColumnTriangles([
      { level: 1, vertices: rectangle(0, 0, 256, 20, 8) },
      { level: 0, vertices: rectangle(0, 20, 256, 60, 0) },
    ]);
    for (const seed of [12, 42, 91, 153035]) {
      const mask = createIslandGroundMask(triangles, seed);
      let joined = 0, yellowContacts = 0;
      for (let x = 1; x < 255; x++) for (let y = 21; y < 50; y++) {
        const point = { x: x + 0.5, y: y + 0.5, z: 0 };
        if (mask.shade(point, 0) !== 120) continue;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const neighbour = mask.shade({ ...point, x: point.x + dx, y: point.y + dy }, 0);
          joined += Number(neighbour === 255);
          yellowContacts += Number(neighbour === 245);
        }
      }
      expect(joined).toBeGreaterThan(200);
      expect(yellowContacts).toBe(0);
    }
  });

  it('tapers crevices before final sand without editing sand or projecting its setback onto uplands', () => {
    const width = 128, height = 80;
    const sand = Uint8Array.from({ length: width * height }, (_, i) => Number(i % width < 40));
    const before = sand.slice(), clearance = createGroundBeachClearance(width, height, sand);
    expect(clearance({ x: 39.5, y: 30.5, z: 0 })).toBe(0);
    expect(clearance({ x: 40.5, y: 30.5, z: 0 })).toBe(1);
    expect(clearance({ x: 50.5, y: 30.5, z: 0 })).toBe(11);
    expect(clearance({ x: 40.5, y: 30.5, z: 8 })).toBe(28);
    const triangles = islandColumnTriangles([
      { level: 1, vertices: rectangle(0, 0, width, 20, 8) },
      { level: 0, vertices: rectangle(0, 20, width, 60, 0) },
    ]);
    const mask = createIslandGroundMask(triangles, 42, clearance);
    for (let x = 0; x < 43; x++) for (let y = 20; y < 40; y++) {
      expect(mask.tone({ x: x + 0.5, y: y + 0.5, z: 0 })).toBe(0);
    }
    let coastal = 0, inland = 0;
    const untapered = createIslandGroundMask(triangles, 42);
    for (let y = 20; y < 40; y++) {
      coastal += mask.tone({ x: 45.5, y: y + 0.5, z: 0 });
      inland += untapered.tone({ x: 45.5, y: y + 0.5, z: 0 });
    }
    expect(coastal).toBeGreaterThan(0);
    expect(coastal).toBeLessThan(inland);
    expect(sand).toEqual(before);
    expect(() => createGroundBeachClearance(0, height, sand)).toThrow('bounded binary');
    expect(() => clearance({ x: NaN, y: 0, z: 0 })).toThrow('finite');
    expect(() => createIslandGroundMask(triangles, 42, () => -1).shade({ x: 0, y: 20, z: 0 }, 0))
      .toThrow('clearance');
  });

  it.each([12, 42, 91, 153035])('uses 96-unit base noise without a coastal pullback on seed %i', seed => {
    const noise = new FastNoiseLite(seed ^ 0x68b4d925);
    noise.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2S);
    noise.SetFrequency(1);
    const mask = createIslandGroundMask([], seed, () => 1);
    let differsFrom64 = 0, yellow = 0;
    for (const surfaceId of [0, 1, 64]) for (let y = 0; y < 384; y += 8) for (let x = 0; x < 512; x += 8) {
      const variation = noise.GetNoise((x + 0.5) / 96 + surfaceId * 137 + 311,
        (y + 0.5) / 96 - surfaceId * 89 - 173);
      const previous = noise.GetNoise((x + 0.5) / 64 + surfaceId * 137 + 311,
        (y + 0.5) / 64 - surfaceId * 89 - 173);
      const expected = variation < 0 ? 245 : 255;
      expect(mask.shade({ x: x + 0.5, y: y + 0.5, z: 0 }, surfaceId)).toBe(expected);
      differsFrom64 += Number((variation < 0) !== (previous < 0));
      yellow += Number(expected === 245);
    }
    expect(differsFrom64).toBeGreaterThan(1000);
    expect(yellow).toBeGreaterThan(1000);
  });

  it('follows lower junctions, not upper rims, interiors or same-height joins', () => {
    const triangles = islandColumnTriangles([
      { level: 1, vertices: rectangle(0, 0, 80, 20, 8) },
      { level: 0, vertices: rectangle(0, 20, 40, 40, 0) },
      { level: 0, vertices: rectangle(40, 20, 40, 40, 0) },
    ]);
    const mask = createIslandGroundMask(triangles, 42);
    expect(mask.sample({ x: 30.5, y: 20.5, z: 0 })).toBe(true);
    expect(mask.sample({ x: 30.5, y: 19.5, z: 8 })).toBe(false);
    expect(mask.sample({ x: 30.5, y: 40.5, z: 0 })).toBe(false);
    expect(mask.sample({ x: 40.5, y: 40.5, z: 0 })).toBe(false);
    const widths = [];
    for (let x = 12; x < 68; x++) {
      let width = 0;
      for (let y = 20; y < 37; y++) width += Number(mask.sample({ x: x + 0.5, y: y + 0.5, z: 0 }));
      widths.push(width);
    }
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...widths) - Math.min(...widths)).toBeGreaterThanOrEqual(3);
  });

  it('follows a sloping gully bank but not its same-height connected side', () => {
    const low = [{ x: 0, y: 20, z: 0 }, { x: 80, y: 20, z: 8 }, { x: 80, y: 40, z: 8 }, { x: 0, y: 40, z: 0 }];
    const high = rectangle(0, 0, 80, 20, 8);
    const continuation = low.map(point => ({ ...point, y: point.y + 20 }));
    const mask = createIslandGroundMask(islandColumnTriangles([
      { level: 1, vertices: high }, { level: 1, ascentId: 0, vertices: low },
      { level: 1, ascentId: 0, vertices: continuation },
    ]), 42);
    expect(mask.sample({ x: 30.5, y: 20.5, z: 3.05 })).toBe(true);
    expect(mask.sample({ x: 30.5, y: 40.5, z: 3.05 })).toBe(false);
    expect(mask.sample({ x: 30.5, y: 19.5, z: 8 })).toBe(false);
    expect(() => mask.sample({ x: NaN, y: 0, z: 0 })).toThrow('finite');
  });

  it('does not use coastal or beach height changes as patch sources', () => {
    const coastal = islandColumnTriangles([
      { level: 0, vertices: rectangle(0, 0, 80, 20, 2) },
      { level: 0, vertices: rectangle(0, 20, 80, 40, 0) },
    ]);
    const beach = coastal.map(triangle => ({ ...triangle, level: 1, layer: 'beaches' as const }));
    for (const triangles of [coastal, beach]) {
      expect(createIslandGroundMask(triangles, 42).sample({ x: 30.5, y: 20.5, z: 0 })).toBe(false);
    }
  });

  it('broadens the light skirt into smooth, wall-attached lobes without a second tone', () => {
    const triangles = islandColumnTriangles([
      { level: 1, vertices: rectangle(0, 0, 256, 20, 8) },
      { level: 0, vertices: rectangle(0, 20, 256, 40, 0) },
    ]);
    const mask = createIslandGroundMask(triangles, 42), again = createIslandGroundMask(triangles, 42);
    const widths = new Array<number>(256).fill(0);
    const tones = new Set<number>();
    for (let y = 0; y < 20; y++) for (let x = 0; x < 256; x++) {
      const point = { x: x + 0.5, y: y + 20.5, z: 0 }, tone = mask.tone(point);
      expect(tone).toBe(again.tone(point));
      expect(tone > 0).toBe(mask.sample(point));
      tones.add(tone);
      widths[x] += tone;
      if (tone) {
        expect(mask.shade(point, 0)).toBe(120);
        for (let inward = 0; inward < y; inward++) {
          expect(mask.tone({ ...point, y: inward + 20.5 })).toBe(1);
        }
      }
    }
    expect(tones).toEqual(new Set([0, 1]));
    expect(widths.reduce((sum, width) => sum + width, 0) / widths.length).toBeGreaterThan(7);
    expect(Math.max(...widths)).toBeGreaterThanOrEqual(11);
    expect(Math.max(...widths)).toBeLessThanOrEqual(16);
    expect(Math.max(...widths) - Math.min(...widths)).toBeGreaterThanOrEqual(5);
    for (let x = 0; x < 256; x++) {
      expect(mask.tone({ x: x + 0.5, y: 20.5, z: 0 })).toBe(1);
      if (x) expect(Math.abs(widths[x] - widths[x - 1])).toBeLessThanOrEqual(2);
    }
  });

  it('preserves broad white/off-white areas outside the single wall-patch grey', () => {
    const mask = createIslandGroundMask([], 42), again = createIslandGroundMask([], 42);
    const counts = new Map<number, number>();
    let changedTerrace = 0, matchingNeighbours = 0, longestRun = 0;
    const rowTransitions: number[] = [];
    for (let y = 0; y < 96; y++) {
      let run = 0, previous = 0, transitions = 0;
      for (let x = 0; x < 128; x++) {
        const point = { x: x * 4 + 0.5, y: y * 4 + 0.5, z: 0 };
        const shade = mask.shade(point, 0);
        expect(shade).toBe(again.shade(point, 0));
        expect([255, 245]).toContain(shade);
        counts.set(shade, (counts.get(shade) ?? 0) + 1);
        changedTerrace += Number(shade !== mask.shade(point, 1));
        matchingNeighbours += Number(shade === mask.shade({ ...point, x: point.x + 1 }, 0));
        if (previous && previous !== shade) { transitions++; run = 0; }
        run++;
        longestRun = Math.max(longestRun, run);
        previous = shade;
      }
      rowTransitions.push(transitions);
      expect(transitions).toBeLessThanOrEqual(16);
    }
    expect(counts.get(255)).toBeGreaterThan(500);
    expect(counts.get(245)).toBeGreaterThan(500);
    expect(longestRun * 4).toBeGreaterThanOrEqual(64);
    expect(Math.max(...rowTransitions)).toBeGreaterThanOrEqual(6);
    expect(changedTerrace).toBeGreaterThan(128 * 96 * 0.2);
    expect(matchingNeighbours).toBeGreaterThan(128 * 96 * 0.96);
    expect(() => mask.shade({ x: 0, y: 0, z: 0 }, -1)).toThrow('surface ID');
    const walls = createIslandGroundMask(islandColumnTriangles([
      { level: 1, vertices: rectangle(0, 0, 256, 20, 8) },
      { level: 0, vertices: rectangle(0, 20, 256, 40, 0) },
    ]), 42);
    for (let y = 20; y < 32; y++) for (let x = 0; x < 256; x++) {
      const point = { x: x + 0.5, y: y + 0.5, z: 0 }, density = walls.tone(point);
      if (density) expect(walls.shade(point, 0)).toBe(120);
    }
  });

  it.each([12, 91, 153028])('uses three unlit top colours and preserves excluded surfaces on seed %i', seed => {
    const island = generateIslandLandform(seed), before = structuredClone(island);
    const surface = createIslandSurface(island.world, undefined, island.ascents, island.edges, island.beach,
      undefined, island.coast ?? island.cove, island.triangles);
    const colours = new Set<string>();
    for (const triangle of [...island.triangles, ...island.beach.underwaterTriangles]) {
      const point = center(triangle);
      const baseline = surface.shadeLayer(triangle, point);
      const preview = surface.shadeLayer(triangle, point, undefined, { groundMask: true });
      if (triangle.plane !== 'top' || triangle.submerged || surface.material(point.x, point.y).includes('sand')) {
        expect(preview).toEqual(baseline);
      } else {
        expect([[255, 255, 255], [245, 245, 245], [120, 120, 120]]).toContainEqual(preview);
        colours.add(preview.join(','));
      }
      expect(surface.shadeLayer(triangle, point)).toEqual(baseline);
    }
    expect(colours).toEqual(new Set(['255,255,255', '245,245,245', '120,120,120']));
    expect(island).toEqual(before);
  });
});
