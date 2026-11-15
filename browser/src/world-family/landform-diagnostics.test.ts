import { describe, expect, it } from 'vitest';
import type { LandTriangle } from './core/landform-study';
import {
  createDefaultLayersInspection,
  createProjectionChecker,
  diagnosticSetting,
  layersFromParameters,
  serializeLayersParameter,
  soloIslandLayer,
} from './render/landform-diagnostics';
import { rasterLandform, type LandPalette, type LandRaster } from './render/landform-study';
import {
  activeIslandLandTriangles,
  activeIslandSeabedTriangles,
  generateIslandLandform,
  islandMeshLayers,
} from './core/island-landform';
import { createIslandEnvironment } from './render/island-environment';

const palette: LandPalette = {
  water: [0, 0, 100], top: [80, 160, 80], light: [150, 140, 100],
  middle: [120, 110, 80], dark: [90, 80, 60],
  levels: [[80, 160, 80], [160, 180, 90], [200, 200, 120]],
};
const triangle = (vertices: LandTriangle['vertices']): LandTriangle => ({ vertices, plane: 'top', level: 0 });
const top = triangle([{ x: 0, y: 0, z: 0 }, { x: 24, y: 0, z: 0 }, { x: 24, y: 24, z: 0 }]);
const pixel = (raster: LandRaster, x: number, y: number) =>
  Array.from(raster.pixels.slice((y * raster.width! + x) * 4, (y * raster.width! + x) * 4 + 3));
const topArea = (tris: readonly LandTriangle[]) =>
  tris.filter(t => t.plane === 'top').reduce((sum, { vertices: [a, b, c] }) =>
    sum + Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2, 0);

describe('projection and triangle inspection', () => {
  it('uses equal world-sized XY squares on tops, independent of elevation', () => {
    const sample = createProjectionChecker();
    expect(sample(top, { x: 1, y: 1, z: 0 })).toEqual([92, 92, 92]);
    expect(sample(top, { x: 9, y: 1, z: 0 })).toEqual([232, 232, 232]);
    expect(sample(top, { x: 9, y: 9, z: 48 })).toEqual([92, 92, 92]);
    expect(sample(top, { x: -1, y: 1, z: 0 })).toEqual([232, 232, 232]);
  });

  it.each([
    [[{ x: 0, y: 0, z: 0 }, { x: 0, y: 24, z: 0 }, { x: 0, y: 24, z: 24 }], { x: 0, y: 9, z: 1 }],
    [[{ x: 0, y: 0, z: 0 }, { x: 24, y: 0, z: 0 }, { x: 24, y: 0, z: 24 }], { x: 9, y: 0, z: 1 }],
  ] as const)('uses side coordinates on vertical cliffs with either normal sign', (vertices, point) => {
    const sample = createProjectionChecker();
    expect(sample(triangle(vertices), point)).toEqual([232, 232, 232]);
    expect(sample(triangle([vertices[2], vertices[1], vertices[0]]), point)).toEqual([232, 232, 232]);
  });

  it('blends projections using the actual slope normal, not its top classification', () => {
    const slope = triangle([{ x: 0, y: 0, z: 4 }, { x: 16, y: 0, z: 4 }, { x: 0, y: 16, z: 20 }]);
    expect(createProjectionChecker()(slope, { x: 1, y: 6, z: 10 })).toEqual([162, 162, 162]);
    expect(() => createProjectionChecker(0)).toThrow('positive');
    expect(() => createProjectionChecker()(triangle([top.vertices[0], top.vertices[0], top.vertices[0]]), top.vertices[0])).toThrow('non-degenerate');
  });

  it('draws real diagonal edges without changing solid coverage or depth', () => {
    const options = { triangles: [top], viewport: { width: 32, height: 32, origin: { x: 4, y: 4 } } };
    const plain = rasterLandform('plan', palette, [], options);
    const wire = rasterLandform('plan', palette, [], { ...options, diagnostics: { wireframe: true } });
    expect(pixel(wire, 16, 16)).toEqual([25, 38, 42]);
    expect(pixel(wire, 20, 10)).toEqual(pixel(plain, 20, 10));
    expect(wire.depth).toEqual(plain.depth);
    expect(wire.levels).toEqual(plain.levels);
    const checker = rasterLandform('plan', palette, [], { ...options, diagnostics: { checker: true } });
    expect(pixel(checker, 13, 5)).toEqual([232, 232, 232]);
    const both = rasterLandform('plan', palette, [], { ...options, diagnostics: { checker: true, wireframe: true } });
    expect(pixel(both, 16, 16)).toEqual([25, 38, 42]);
    expect(pixel(both, 13, 5)).toEqual(pixel(checker, 13, 5));
  });

  it('does not draw occluded triangle edges through foreground terrain, regardless of draw order', () => {
    const foreground = triangle([{ x: -10, y: -10, z: 20 }, { x: 100, y: -10, z: 20 }, { x: -10, y: 100, z: 20 }]);
    const viewport = { width: 32, height: 32, origin: { x: 4, y: 4 } };
    const render = (triangles: LandTriangle[]) => rasterLandform('plan', palette, [], {
      triangles, viewport, diagnostics: { wireframe: true },
    });
    const visibleOnly = render([foreground]);
    expect(render([top, foreground]).pixels).toEqual(visibleOnly.pixels);
    expect(render([foreground, top]).pixels).toEqual(visibleOnly.pixels);
  });

  it('keeps diagnostic land stable during water animation and restores the original environment', () => {
    const island = generateIslandLandform(12), before = structuredClone(island);
    const environment = createIslandEnvironment(island);
    const viewport = { width: 640, height: 480, origin: { x: 300, y: 60 } };
    const original = environment.render('oblique', viewport);
    const checked = environment.render('oblique', viewport, undefined, { checker: true, wireframe: true });
    expect(checked.grassCount).toBe(0);
    const land = checked.raster.pixels.slice();
    checked.animate(2);
    for (let i = 0; i < checked.raster.levels.length; i++) {
      if (checked.raster.levels[i] < 0) continue;
      expect(checked.raster.pixels.slice(i * 4, i * 4 + 4)).toEqual(land.slice(i * 4, i * 4 + 4));
    }
    expect(environment.render('oblique', viewport).raster.pixels).toEqual(original.raster.pixels);
    expect(island).toEqual(before);
  });

  it('validates reproducible URL settings', () => {
    expect(diagnosticSetting(new URLSearchParams(), 'checker')).toBe(false);
    expect(diagnosticSetting(new URLSearchParams('checker=1'), 'checker')).toBe(true);
    expect(diagnosticSetting(new URLSearchParams('wireframe=0'), 'wireframe')).toBe(false);
    expect(() => diagnosticSetting(new URLSearchParams('checker=yes'), 'checker')).toThrow('diagnostic setting');
  });

  it('partitions the island into disconnected mesh layers and fills base ground when uplands are hidden', () => {
    const island = generateIslandLandform(153025);
    const layers = islandMeshLayers(island);
    expect(layers.base.triangles.length).toBeGreaterThan(0);
    expect(layers.uplands.triangles.length).toBeGreaterThan(0);
    expect(layers.beaches.triangles.length).toBeGreaterThan(0);
    expect(layers.seabed.triangles.length).toBe(island.beach.underwaterTriangles.length);
    expect(
      layers.base.triangles.length + layers.uplands.triangles.length + layers.beaches.triangles.length,
    ).toBe(island.triangles.length);

    const baseOnly = activeIslandLandTriangles(island, { base: true, uplands: false, beaches: false });
    expect(topArea(baseOnly)).toBeGreaterThan(topArea(layers.base.triangles));
    expect(activeIslandSeabedTriangles(island, { seabed: false })).toHaveLength(0);
  });

  it.each([12, 77, 153025])('fills only hidden footprints without covering visible beaches or uplands for seed %i', seed => {
    for (const conditionEdges of [false, true]) {
      const island = generateIslandLandform(seed, { conditionEdges }), before = structuredClone(island);
      const { world } = island, layers = islandMeshLayers(island);
      const landArea = world.cells.reduce((sum, cell) => sum + cell * world.tileSize ** 2, 0);
      for (const uplands of [false, true]) for (const beaches of [false, true]) {
        const active = activeIslandLandTriangles(island, { base: true, uplands, beaches });
        expect(topArea(active)).toBeCloseTo(landArea, 5);
        const base = active.filter(t => t.layer === 'base');
        expect(base.length).toBeGreaterThan(0);
        expect(base.filter(t => t.plane === 'top').every(t => t.vertices.every(v => Math.abs(v.z) < 1e-6))).toBe(true);
        const width = world.width * world.tileSize, height = world.height * world.tileSize;
        const colors = { ...palette, levels: Array.from({ length: 7 }, () => palette.levels[0]) };
        const plan = rasterLandform('plan', colors, [], { triangles: active, viewport: { width, height, origin: { x: 0, y: 0 } } });
        for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
          const index = (y * world.tileSize + 1) * width + x * world.tileSize + 1;
          expect(plan.levels[index] >= 0).toBe(Boolean(world.cells[y * world.width + x]));
        }
        expect(active.filter(t => t.layer === 'uplands')).toEqual(uplands ? layers.uplands.triangles : []);
        expect(active.filter(t => t.layer === 'beaches')).toEqual(beaches ? layers.beaches.triangles : []);
        if (!uplands && !beaches) {
          expect(topArea(base)).toBeCloseTo(landArea, 5);
          const walls = base.filter(t => t.plane !== 'top');
          expect(walls.every(t => {
            const [a, b, c] = t.vertices;
            return (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.x - c.x) < 1e-6)
              || (Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.y - c.y) < 1e-6);
          })).toBe(true);
        }
      }
      expect(activeIslandLandTriangles(island, { base: false, uplands: false, beaches: true }))
        .toEqual(layers.beaches.standaloneTriangles);
      expect(activeIslandLandTriangles(island, { base: false, uplands: true, beaches: false }))
        .toEqual(layers.uplands.standaloneTriangles);
      expect(island).toEqual(before);
    }
  });

  it('serializes, solos and renders per-layer appearance, geometry, UV and water treatments independently', () => {
    const island = generateIslandLandform(12);
    const environment = createIslandEnvironment(island);
    const viewport = { width: 480, height: 360, origin: { x: 220, y: 60 } };
    const baseline = environment.render('oblique', viewport);

    // Soloing uplands hides water, seabed, base and beaches without regenerating the island.
    const soloUplands = soloIslandLayer(createDefaultLayersInspection(), 'uplands');
    expect(soloUplands.uplands.visible).toBe(true);
    expect(soloUplands.base.visible).toBe(false);
    expect(soloUplands.water.visible).toBe(false);
    const uplandsFrame = environment.render('oblique', viewport, undefined, { layers: soloUplands });
    expect(uplandsFrame.waterPixels).toBe(0);
    expect(uplandsFrame.raster.pixels).not.toEqual(baseline.raster.pixels);

    // Soloing again restores all layers.
    const restored = soloIslandLayer(soloUplands, 'uplands');
    expect(serializeLayersParameter(restored)).toBeUndefined();

    // Per-layer inspection toggles on uplands change uplands pixels while preserving URL round-trip.
    const custom = createDefaultLayersInspection();
    custom.uplands.wireframe = true;
    custom.uplands.vertices = true;
    custom.uplands.boundaries = true;
    custom.beaches.uvChecker = true;
    custom.beaches.uvSeams = true;
    custom.base.materials = false;
    custom.base.lighting = false;
    custom.water.colorPatches = false;
    custom.water.depthColor = false;
    custom.water.surfaceResponse = false;
    custom.water.surfaceHighlights = false;
    custom.water.waves = false;
    custom.water.shoreFoam = false;
    custom.water.seabedVisibility = false;

    const encoded = serializeLayersParameter(custom);
    expect(encoded).toBeDefined();
    const parsed = layersFromParameters(new URLSearchParams(`layers=${encodeURIComponent(encoded!)}`));
    expect(parsed).toEqual(custom);

    const inspected = environment.render('oblique', viewport, undefined, { layers: custom });
    expect(inspected.raster.pixels).not.toEqual(baseline.raster.pixels);
    expect(inspected.foamPixels).toBe(0);
  });
});
