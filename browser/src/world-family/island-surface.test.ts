import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { World } from './core/contracts';
import { buildIslandLandform, generateIslandLandform } from './core/island-landform';
import type { LandTriangle, LandVertex } from './core/landform-study';
import { generateIslandWorld, terrainAt } from './core/world';
import { createIslandGroundField } from './render/island-ground-field';
import { createIslandSurface, GROUND_PATCH_COLORS, type SurfaceColor } from './render/island-surface';
import { createGroundBeachClearance, createIslandGroundMask } from './render/island-ground-mask';
import { createIslandSun, DEFAULT_SUN } from './render/island-sun';
import { MATERIAL_COLORS, MATERIAL_PALETTES } from './render/island-textures';
import { surfaceNormal } from './render/surface-projection';
import { createDefaultLayersInspection } from './render/landform-diagnostics';

const brightness = (color: SurfaceColor) => color.reduce((sum, channel) => sum + channel, 0);
const top: LandTriangle = {
  vertices: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 4, z: 0 }],
  plane: 'top', level: 0,
};
function fixture(height = 0.06): World {
  return {
    seed: 42, generatorVersion: 'surface-test', provenance: 'test-fixture',
    width: 16, height: 16, tileSize: 4, seaLevel: 0,
    heights: new Float32Array(256).fill(height), cells: new Uint8Array(256).fill(1),
    elevations: new Uint8Array(256), rampIds: new Int32Array(256).fill(-1), ramps: [],
  };
}
function center(triangle: LandTriangle): LandVertex {
  return {
    x: triangle.vertices.reduce((sum, v) => sum + v.x, 0) / 3,
    y: triangle.vertices.reduce((sum, v) => sum + v.y, 0) / 3,
    z: triangle.vertices.reduce((sum, v) => sum + v.z, 0) / 3,
  };
}

describe('V2 world-space surface materials', () => {
  it.each([12, 91, 153028])('keeps turf classification while colouring inland tops, including gullies, for seed %i', seed => {
    const island = generateIslandLandform(seed);
    const before = structuredClone(island);
    const surface = createIslandSurface(island.world, undefined, island.ascents, island.edges, island.beach,
      undefined, undefined, island.triangles);
    const width = island.world.width * island.world.tileSize, height = island.world.height * island.world.tileSize;
    const sand = Uint8Array.from({ length: width * height }, (_, i) =>
      Number(surface.material(i % width + 0.5, Math.floor(i / width) + 0.5).includes('sand')));
    const mask = createIslandGroundMask(island.triangles, seed, createGroundBeachClearance(width, height, sand));
    const found = new Set<string>();
    const inspection = createDefaultLayersInspection().base;
    inspection.lighting = false;
    for (let y = 0; y < island.world.height * island.world.tileSize; y++) {
      for (let x = 0; x < island.world.width * island.world.tileSize; x++) {
        const cell = Math.floor(y / island.world.tileSize) * island.world.width + Math.floor(x / island.world.tileSize);
        if (!island.world.cells[cell]) continue;
        const selected = surface.material(x + 0.5, y + 0.5);
        if (selected === 'dry-sand' || selected === 'wet-sand') continue;
        expect(selected).toBe('turf');
        found.add(selected);
      }
    }
    for (const triangle of island.triangles) {
      if (triangle.plane !== 'top') continue;
      const point = center(triangle), selected = surface.material(point.x, point.y);
      expect(selected).not.toBe('earth');
      expect(surface.regions(triangle, point)).toEqual(MATERIAL_COLORS[selected]);
      if (surfaceNormal(triangle).z === 1) {
        if (selected.includes('sand')) {
          expect(MATERIAL_PALETTES[selected]).toContainEqual(surface.shadeLayer(triangle, point, inspection));
        } else {
          const tone = mask.shade(point, triangle.ascentId === undefined ? triangle.level : triangle.ascentId + 64);
          expect(surface.shadeLayer(triangle, point, inspection))
            .toEqual(GROUND_PATCH_COLORS[tone]);
          expect(surface.shadeLayer(triangle, point, { ...inspection, textures: false }))
            .toEqual(GROUND_PATCH_COLORS[tone]);
        }
      }
    }
    expect([...found]).toEqual(['turf']);
    expect(island).toEqual(before);
  });

  it('replaces earth on tops without repainting the earth texture on a cliff lip', () => {
    const world = fixture(0.35), surface = createIslandSurface(world);
    const wall: LandTriangle = {
      vertices: [{ x: 0, y: 0, z: 4 }, { x: 0, y: 0, z: 0 }, { x: 64, y: 0, z: 0 }],
      plane: 'middle', level: 1,
    };
    let replaced = 0;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const point = { x: x + 0.5, y: y + 0.25, z: 4 };
      if (surface.regions(wall, point) !== MATERIAL_COLORS.earth) continue;
      expect(surface.material(point.x, point.y + 0.25)).toBe('turf');
      expect(surface.regions(top, { ...point, y: point.y + 0.25 })).not.toEqual(MATERIAL_COLORS.earth);
      replaced++;
    }
    expect(replaced).toBeGreaterThan(0);
  });

  it('preserves cliff sides, sands and submerged surfaces from the pre-earth-removal baseline', () => {
    const hashes: Record<number, string> = {};
    for (const seed of [12, 91, 153028]) {
      const island = generateIslandLandform(seed);
      const surface = createIslandSurface(island.world, undefined, island.ascents, island.edges, island.beach);
      const hash = createHash('sha256');
      const inspection = createDefaultLayersInspection().base;
      inspection.lighting = false;
      for (const triangle of [...island.triangles, ...island.beach.underwaterTriangles]) {
        const points = [center(triangle), ...triangle.vertices];
        if (triangle.plane === 'top' && !triangle.submerged) {
          if (!points.every(point => ['dry-sand', 'wet-sand'].includes(surface.material(point.x, point.y)))) continue;
        }
        for (const point of points) {
          hash.update(JSON.stringify([
            surface.regions(triangle, point),
            surface.shade(triangle, point),
            surface.shadeLayer(triangle, point, inspection),
          ]));
        }
      }
      hashes[seed] = hash.digest('hex');
    }
    expect(hashes).toMatchInlineSnapshot(`
      {
        "12": "ccfaf547a8efe372659ac40c11e5f8bbb780837b8968e726b12f98f28bcae5f9",
        "153028": "2728023a09b1889d6c783c445e71371ae92fe3d1706a4ea539cf1c17d36e669e",
        "91": "2e5bfdf7453e70b6ff0cf9c5841912bf4f028410ab69275c286d2b7dd61a1b1f",
      }
    `);
  });

  it('uses wet sand on submerged formation tops and rock on their exposed sides', () => {
    const island = generateIslandLandform(153025);
    const surface = createIslandSurface(island.world, undefined, island.ascents, island.edges, island.beach);
    const top = island.beach.underwaterTriangles.find(t => t.plane === 'top')!;
    const side = island.beach.underwaterTriangles.find(t => Math.abs(surfaceNormal(t).z) < 1e-8)!;
    expect(surface.regions(top, center(top))).toEqual(MATERIAL_COLORS['wet-sand']);
    expect(surface.regions(side, center(side))).toEqual(MATERIAL_COLORS.rock);
  });

  it('shows existing ground materials on Base when Beaches are hidden without repainting visible layers', () => {
    const surface = createIslandSurface(fixture());
    const layers = createDefaultLayersInspection();
    const base: LandTriangle = { ...top, layer: 'base' };
    const beach: LandTriangle = { ...top, layer: 'beaches' };
    const upland: LandTriangle = { ...top, layer: 'uplands', ascentId: 0 };
    const point = { x: 42, y: 42, z: 0 };
    const shade = (triangle: LandTriangle) => surface.shadeLayer(triangle, point, layers.base, { layers, regions: true });
    const original = shade(base);
    expect(original).toEqual(MATERIAL_COLORS['dry-sand']);
    layers.beaches.visible = false;
    expect(shade(base)).toEqual(MATERIAL_COLORS.turf);
    expect(shade(beach)).toEqual(original);
    expect(shade(upland)).toEqual(original);
    expect(surface.regions(base, point)).toEqual(original);
    layers.beaches.visible = true;
    expect(shade(base)).toEqual(original);
  });

  it.each([12, 153025, 902479])('lifts only low coastal walls without changing materials or geometry for seed %i', seed => {
    const island = generateIslandLandform(seed), before = structuredClone(island);
    const sun = createIslandSun(island.triangles);
    const surface = createIslandSurface(island.world, undefined, island.ascents, island.edges, island.beach, () => sun);
    let lifted = 0, unchanged = 0, darkWalls = 0;
    for (const triangle of island.triangles) {
      const point = center(triangle), normal = surfaceNormal(triangle);
      const unlit = createDefaultLayersInspection().base;
      unlit.lighting = false;
      const color = surface.shadeLayer(triangle, point, unlit);
      const visibility = sun.visibility(point, normal);
      const baseline = sun.shade(color, normal, visibility);
      const actual = surface.shade(triangle, point);
      const coastal = triangle.plane !== 'top' && triangle.level === 0
        && triangle.ascentId === undefined && !triangle.submerged && Math.abs(normal.z) < 1e-8;
      if (coastal) {
        expect(actual).toEqual(sun.shade(color, normal, visibility, 1.75));
        expect(brightness(actual)).toBeGreaterThan(brightness(baseline));
        lifted++;
        if (normal.x * sun.direction.x + normal.y * sun.direction.y <= 0) {
          expect(brightness(actual) - brightness(baseline)).toBeGreaterThan(30);
          darkWalls++;
        }
      } else {
        expect(actual).toEqual(baseline);
        unchanged++;
      }
    }
    expect(lifted).toBeGreaterThan(0);
    expect(darkWalls).toBeGreaterThan(0);
    expect(unchanged).toBeGreaterThan(0);
    expect(unchanged + lifted).toBe(island.triangles.length);
    expect(island).toEqual(before);
  });

  it('keeps coastal fill tied to sky light and excludes stairs, slopes and submerged faces', () => {
    const world = fixture(), sun = createIslandSun([], { ...DEFAULT_SUN, skyFill: 0 });
    const surface = createIslandSurface(world, undefined, undefined, undefined, undefined, () => sun);
    const coastal: LandTriangle = {
      vertices: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -4 }, { x: 4, y: 0, z: -4 }],
      plane: 'middle', level: 0,
    };
    const point = { x: 2, y: 0, z: -3 };
    expect(surface.shade(coastal, point)).toEqual(surface.shade({ ...coastal, level: 1 }, point));
    const filled = createIslandSurface(world);
    for (const excluded of [
      { ...coastal, ascentId: 0 },
      { ...coastal, submerged: true },
      { ...top, vertices: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: -2 }, { x: 4, y: 4, z: -2 }] },
    ] satisfies LandTriangle[]) {
      expect(filled.shade(excluded, point)).toEqual(filled.shade({ ...excluded, level: 1 }, point));
    }
  });

  it.each([12, 42, 902479])('is deterministic, finite, varied and non-mutating for seed %i', seed => {
    const world = generateIslandWorld(seed);
    const before = structuredClone(world);
    const surface = createIslandSurface(world), again = createIslandSurface(world);
    const { triangles } = buildIslandLandform(world);
    const sand: SurfaceColor[] = [], grass: SurfaceColor[] = [], cliffs: SurfaceColor[] = [];
    for (let i = 0; i < triangles.length; i++) {
      const triangle = triangles[i], point = center(triangle);
      const color = surface.shade(triangle, point);
      expect(color).toEqual(again.shade(triangle, point));
      expect(color.every(value => Number.isInteger(value) && value >= 0 && value <= 255)).toBe(true);
      expect(brightness(color)).toBeGreaterThan(105);
      if (triangle.plane !== 'top') cliffs.push(color);
      else if (terrainAt(world, { x: Math.floor(point.x / 4), y: Math.floor(point.y / 4) }) === 'sand') sand.push(color);
      else grass.push(color);
    }
    expect(sand.length).toBeGreaterThan(0);
    expect(grass.length).toBeGreaterThan(0);
    expect(cliffs.length).toBeGreaterThan(0);
    expect(sand.some(color => color[0] > color[1] && color[0] - color[2] > 45)).toBe(true);
    expect(grass.some(color => color[1] - color[0] > 20)).toBe(true);
    expect(new Set(grass.map(color => color.join(','))).size).toBeGreaterThanOrEqual(2);
    expect(world).toEqual(before);
  });

  it('exposes the unchanged V1 field for grass placement', () => {
    const world = fixture(), surface = createIslandSurface(world), field = createIslandGroundField(world);
    for (const [x, y] of [[0, 0], [17.25, 28.5], [63, 63]]) {
      expect(surface.ground(x, y)).toEqual(field.sample(x, y));
    }
  });

  it('lights outward wall normals rather than semantic plane labels', () => {
    const surface = createIslandSurface(fixture());
    const north: LandTriangle = {
      vertices: [{ x: 0, y: 0, z: 20 }, { x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
      plane: 'middle', level: 1,
    };
    const south: LandTriangle = { ...north, vertices: [north.vertices[0], north.vertices[2], north.vertices[1]] };
    const point = { x: 2, y: 0, z: 8 };
    expect(brightness(surface.shade(north, point))).toBeGreaterThan(brightness(surface.shade(south, point)) + 40);
    expect(surface.shade({ ...north, plane: 'dark' }, point)).toEqual(surface.shade(north, point));
    expect(Math.min(...surface.shade(south, point))).toBeGreaterThan(55);
  });

  it('uses the actual sloped normal on ramps', () => {
    const surface = createIslandSurface(fixture());
    const toward: LandTriangle = {
      ...top, vertices: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 4 }, { x: 4, y: 4, z: 4 }],
    };
    const away: LandTriangle = {
      ...top, vertices: [{ x: 0, y: 0, z: 4 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 4, z: 0 }],
    };
    const point = { x: 2, y: 2, z: 2 };
    expect(brightness(surface.shade(toward, point))).toBeGreaterThan(brightness(surface.shade(away, point)) + 40);
  });

  it('distinguishes wet and dry sand by distance to the beach rather than inland source height', () => {
    const surface = createIslandSurface(fixture(0.012));
    const point = { x: 42, y: 42, z: 0 }, edge = { x: 0.5, y: 42, z: 0 };
    expect(surface.material(edge.x, edge.y)).toBe('wet-sand');
    expect(surface.material(point.x, point.y)).toBe('dry-sand');
    expect(brightness(surface.shade(top, point))).toBeGreaterThan(brightness(surface.shade(top, edge)) + 90);
    const island = generateIslandLandform(91), ascent = island.ascents.find(ascent => ascent.kind !== 'gully')!;
    const center = {
      x: ascent.origin.x + ascent.direction.x * ascent.length / 2,
      y: ascent.origin.y + ascent.direction.y * ascent.length / 2,
    };
    expect(createIslandSurface(island.world, undefined, island.ascents).material(center.x, center.y)).toBe('dry-sand');
  });

  it('casts geometric shadows toward the actual light while retaining sky fill', () => {
    const clear = fixture(), blocked = fixture(), opposite = fixture();
    blocked.elevations![8 * 16 + 8] = 1;
    opposite.elevations![12 * 16 + 12] = 1;
    const point = { x: 42, y: 42, z: 0 };
    const lit = brightness(createIslandSurface(clear).shade(top, point));
    const shaded = brightness(createIslandSurface(blocked).shade(top, point));
    const mesh = buildIslandLandform(blocked);
    const sky = createIslandSun(mesh.triangles, { ...DEFAULT_SUN, intensity: 0 });
    const filled = brightness(createIslandSurface(blocked, undefined, mesh.ascents, mesh.edges, mesh.beach, () => sky).shade(top, point));
    expect(shaded).toBeLessThan(lit - 15);
    expect(shaded).toBeGreaterThanOrEqual(filled);
    expect(filled).toBeGreaterThan(0);
    expect(createIslandSurface(opposite).shade(top, point)).toEqual(createIslandSurface(clear).shade(top, point));
  });

  it('keeps materials continuous across a top triangulation seam', () => {
    const surface = createIslandSurface(fixture(0.35));
    const other: LandTriangle = { ...top, vertices: [top.vertices[0], top.vertices[2], { x: 0, y: 4, z: 0 }] };
    const point = { x: 2, y: 2, z: 0 };
    expect(surface.shade(top, point)).toEqual(surface.shade(other, point));
    const near = surface.shade(top, { ...point, x: point.x + 0.1 });
    expect(near.every((channel, index) => Math.abs(channel - surface.shade(top, point)[index]) <= 2)).toBe(true);
  });

  it('restores textured rock and grassy lips without periodic decorative cliff bands', () => {
    const surface = createIslandSurface(fixture(0.35));
    const wall: LandTriangle = {
      vertices: [{ x: 0, y: 0, z: 48 }, { x: 0, y: 0, z: 0 }, { x: 64, y: 0, z: 0 }],
      plane: 'middle', level: 2,
    };
    const colors = Array.from({ length: 35 }, (_, i) => surface.shade(wall, { x: 24, y: 0, z: 5 + i }));
    for (let channel = 0; channel < 3; channel++) {
      const values = colors.map(color => color[channel]);
      expect(Math.max(...values) - Math.min(...values)).toBeLessThan(20);
    }
    // The former sine pattern repeated exactly every 2π / 0.67 height units.
    const period = 2 * Math.PI / 0.67;
    const differences = Array.from({ length: 24 }, (_, i) => {
      const first = surface.shade(wall, { x: 24, y: 0, z: 5 + i });
      const next = surface.shade(wall, { x: 24, y: 0, z: 5 + i + period });
      return Math.max(...first.map((value, channel) => Math.abs(value - next[channel])));
    });
    expect(differences.some(value => value > 0)).toBe(true);
    const lip = surface.shade(wall, { x: 24, y: 0, z: 48 });
    expect(surface.regions(wall, { x: 24, y: 0, z: 48 })).toEqual(MATERIAL_COLORS.meadow);
    expect(surface.material(24, 0.25)).toBe('turf');
    expect(lip).not.toEqual(colors[0]);
    const other: LandTriangle = {
      ...wall, vertices: [wall.vertices[0], wall.vertices[2], { x: 64, y: 0, z: 48 }],
    };
    expect(surface.shade(wall, { x: 24, y: 0, z: 24 }))
      .toEqual(surface.shade(other, { x: 24, y: 0, z: 24 }));
  });

  it('keeps meadow and moss available without applying their habitat noise to tops', () => {
    const world = generateIslandWorld(12), surface = createIslandSurface(world);
    const candidates: { point: LandVertex; meadow: number; moss: number }[] = [];
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        const index = y * world.width + x;
        if (terrainAt(world, { x, y }) !== 'grass' || world.rampIds![index] >= 0) continue;
        const point = { x: (x + 0.5) * 4, y: (y + 0.5) * 4, z: 0 };
        const ground = surface.ground(point.x, point.y);
        if (ground.earth > 0.01 || ground.shelter > 0.01) continue;
        candidates.push({ point, meadow: ground.meadow / ground.turf, moss: ground.moss / ground.turf });
      }
    }
    const meadow = candidates.reduce((a, b) => a.meadow - a.moss > b.meadow - b.moss ? a : b);
    const moss = candidates.reduce((a, b) => a.moss - a.meadow > b.moss - b.meadow ? a : b);
    const meadowColor = surface.regions(top, meadow.point), mossColor = surface.regions(top, moss.point);
    expect(meadow.meadow).toBeGreaterThan(moss.meadow);
    expect(moss.moss).toBeGreaterThan(meadow.moss);
    expect(MATERIAL_COLORS.meadow).not.toEqual(MATERIAL_COLORS.turf);
    expect(MATERIAL_COLORS.moss).not.toEqual(MATERIAL_COLORS.turf);
    expect(meadowColor).toEqual(MATERIAL_COLORS.turf);
    expect(mossColor).toEqual(MATERIAL_COLORS.turf);
    for (const { point } of [meadow, moss]) {
      const base = surface.regions(top, point);
      const nearby = surface.regions(top, { ...point, x: point.x + 1, y: point.y + 1 });
      expect(nearby).toEqual(base);
    }
  });
});
