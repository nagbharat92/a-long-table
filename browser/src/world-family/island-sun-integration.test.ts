import { describe, expect, it } from 'vitest';
import { generateIslandLandform } from './core/island-landform';
import { activeIslandLandTriangles, activeIslandSeabedTriangles, ISLAND_MESH_LAYER_IDS } from './core/island-layers';
import { createIslandEnvironment, waterWorldPoint } from './render/island-environment';
import { createDefaultLayersInspection } from './render/landform-diagnostics';
import { createIslandOcean } from './render/island-ocean';
import { WATER_MAX_DEPTH } from './render/island-water-color';
import { projectedWaterColor } from './render/island-water-projection';
import { DEFAULT_SUN, createIslandSun } from './render/island-sun';
import { createSunlitOcean } from './render/island-sun-water';
import { createWaterSurfaceResponse } from './render/island-water-surface';

const viewport = { width: 820, height: 600, origin: { x: 350, y: 120 } };

describe('shared island and ocean sunlight', () => {
  it('uses only visible meshes as casters, including standalone foundation and upland geometry', () => {
    const island = generateIslandLandform(77), before = structuredClone(island);
    const settings = { ...DEFAULT_SUN, elevation: 10, shadowMode: 'hard' as const };
    const environment = createIslandEnvironment(island, settings);
    const originalSun = environment.sun, originalBake = environment.oceanBake;
    for (const hidden of ISLAND_MESH_LAYER_IDS) {
      const layers = createDefaultLayersInspection();
      layers[hidden].visible = false;
      environment.setLayers(layers);
      const visibility = {
        base: layers.base.visible, uplands: layers.uplands.visible,
        beaches: layers.beaches.visible, seabed: layers.seabed.visible,
      };
      const expected = createIslandSun([
        ...activeIslandLandTriangles(island, visibility),
        ...activeIslandSeabedTriangles(island, visibility),
      ], settings);
      for (let y = -100; y < 500; y += 24) for (let x = -100; x < 500; x += 24) {
        for (const z of [-2.5, 0, 20]) {
          expect(environment.sun.visibility({ x, y, z })).toBe(expected.visibility({ x, y, z }));
        }
      }
      const currentSun = environment.sun, currentOcean = environment.ocean;
      layers.water.visible = false;
      layers.base.wireframe = true;
      layers.uplands.textures = false;
      environment.setLayers(layers);
      expect(environment.sun).toBe(currentSun);
      expect(environment.ocean).toBe(currentOcean);
      environment.setSun({ ...settings, azimuth: 30 });
      expect(environment.sun.settings.azimuth).toBe(30);
      environment.setLayers(layers);
      expect(environment.sun.settings.azimuth).toBe(30);
      environment.setSun(settings);
    }
    environment.setLayers();
    for (let y = 0; y < 400; y += 16) for (let x = 0; x < 400; x += 16) {
      expect(environment.sun.visibility({ x, y, z: -2.5 })).toBe(originalSun.visibility({ x, y, z: -2.5 }));
    }
    expect(environment.oceanBake).toBe(originalBake);
    expect(island).toEqual(before);
  });

  it('removes hidden island shadows from CPU water and restores them when layers return', () => {
    const island = generateIslandLandform(77);
    const environment = createIslandEnvironment(island, { ...DEFAULT_SUN, elevation: 10, shadowMode: 'hard' });
    const original = environment.render('oblique', viewport).raster.pixels.slice();
    const layers = createDefaultLayersInspection();
    for (const id of ISLAND_MESH_LAYER_IDS) layers[id].visible = false;
    const waterOnly = environment.render('oblique', viewport, undefined, { layers });
    expect(waterOnly.waterPixels).toBe(viewport.width * viewport.height);
    const shadowedSun = environment.sun;
    for (let y = -100; y < 600; y += 16) for (let x = -100; x < 600; x += 16) {
      expect(shadowedSun.visibility({ x, y, z: -2.5 })).toBe(1);
    }
    environment.setSun({ ...shadowedSun.settings, shadowStrength: 0 });
    const withoutShadows = environment.render('oblique', viewport, undefined, { layers });
    expect(waterOnly.raster.pixels).toEqual(withoutShadows.raster.pixels);
    environment.setSun({ ...shadowedSun.settings });
    const restored = environment.render('oblique', viewport);
    expect(restored.raster.pixels).toEqual(original);
  });

  it('changes land and water illumination without regenerating or mutating the island', () => {
    const island = generateIslandLandform(77), before = structuredClone(island);
    const environment = createIslandEnvironment(island, { ...DEFAULT_SUN, elevation: 20, shadowMode: 'hard' });
    const first = environment.render('oblique', viewport);
    const original = first.raster.pixels.slice();
    environment.setSun({ ...environment.sun.settings, azimuth: (environment.sun.settings.azimuth + 180) % 360, warmth: 0.9 });
    const second = environment.render('oblique', viewport);
    let land = 0, water = 0;
    for (let i = 0; i < first.waterMask.length; i++) {
      if (![0, 1, 2].some(channel => original[i * 4 + channel] !== second.raster.pixels[i * 4 + channel])) continue;
      if (first.waterMask[i]) water++;
      else land++;
    }
    expect(land).toBeGreaterThan(1000);
    expect(water).toBeGreaterThan(1000);
    expect(second.raster.depth).toEqual(first.raster.depth);
    expect(second.waterMask).toEqual(first.waterMask);
    expect(second.grassCount).toBe(first.grassCount);
    expect(island).toEqual(before);
  });

  it('casts geometric island shadows onto ocean water, not just a shoreline darkening band', () => {
    const island = generateIslandLandform(77);
    const environment = createIslandEnvironment(island, { ...DEFAULT_SUN, azimuth: 270, elevation: 10, shadowMode: 'hard' });
    const first = environment.render('oblique', viewport);
    environment.setSun({ ...environment.sun.settings, shadowStrength: 0 });
    const unshadowed = environment.render('oblique', viewport);
    let shadowedOcean = 0, shadowedLand = 0;
    for (let i = 0; i < first.waterMask.length; i++) {
      const offset = i * 4;
      const difference = [0, 1, 2].reduce((sum, channel) =>
        sum + unshadowed.raster.pixels[offset + channel] - first.raster.pixels[offset + channel], 0);
      if (difference <= 10) continue;
      if (!first.waterMask[i]) shadowedLand++;
      if (first.waterMask[i] && !first.submergedMask[i]) {
        const point = waterWorldPoint(i % viewport.width + 0.5 - viewport.origin.x,
          Math.floor(i / viewport.width) + 0.5 - viewport.origin.y, 'oblique');
        if (environment.shore.distance(point.x, point.y) > 12) shadowedOcean++;
      }
    }
    expect(shadowedLand).toBeGreaterThan(100);
    expect(shadowedOcean).toBeGreaterThan(100);
  });

  it('keeps sunlight out of checker, material masks and elevation-plan diagnostics', () => {
    const environment = createIslandEnvironment(generateIslandLandform(41));
    const variants = [
      { projection: 'oblique', diagnostics: { checker: true } },
      { projection: 'oblique', diagnostics: { regions: true } },
      { projection: 'plan', diagnostics: {} },
    ] as const;
    const first = variants.map(({ projection, diagnostics }) => environment.render(projection, viewport, undefined, diagnostics));
    environment.setSun({ ...DEFAULT_SUN, intensity: 0, skyFill: 0.1, warmth: 1 });
    variants.forEach(({ projection, diagnostics }, index) => {
      const next = environment.render(projection, viewport, undefined, diagnostics);
      let changed = 0;
      for (let i = 0; i < next.waterMask.length; i++) {
        if (next.waterMask[i]) continue;
        if ([0, 1, 2, 3].some(channel =>
          next.raster.pixels[i * 4 + channel] !== first[index].raster.pixels[i * 4 + channel])) changed++;
      }
      expect(changed).toBe(0);
    });
  });

  it('rejects invalid sun edits without replacing the current light or ocean', () => {
    const environment = createIslandEnvironment(generateIslandLandform(41));
    const { sun, ocean } = environment;
    expect(() => environment.setSun({ ...DEFAULT_SUN, elevation: NaN })).toThrow();
    expect(environment.sun).toBe(sun);
    expect(environment.ocean).toBe(ocean);
  });

  it('leaves no unlit grass, foam or water glow when both light contributions are zero', () => {
    const environment = createIslandEnvironment(generateIslandLandform(41), { ...DEFAULT_SUN, intensity: 0, skyFill: 0 });
    const frame = environment.render('oblique', viewport);
    for (const seconds of [0, 1.6]) {
      frame.animate(seconds);
      let glowing = 0;
      for (let i = 0; i < frame.raster.pixels.length; i += 4) {
        if (frame.raster.pixels[i] || frame.raster.pixels[i + 1] || frame.raster.pixels[i + 2]) glowing++;
      }
      expect(glowing).toBe(0);
    }
    expect(environment.ocean.sample(-100, -100, 1.6)).toEqual([0, 0, 0]);
  });

  it('uses identical lit water samples in the island raster and full-scene ocean', () => {
    const environment = createIslandEnvironment(generateIslandLandform(77));
    const frame = environment.render('oblique', viewport);
    const response = createWaterSurfaceResponse(environment.sun, 'oblique');
    for (const seconds of [0, 1.75, 0]) {
      frame.animate(seconds);
      let checked = 0;
      for (let i = 0; i < frame.oceanOnlyMask.length; i += 83) {
        if (!frame.oceanOnlyMask[i]) continue;
        const point = waterWorldPoint(i % viewport.width + 0.5 - viewport.origin.x,
          Math.floor(i / viewport.width) + 0.5 - viewport.origin.y, 'oblique');
        const ocean = environment.ocean.prepare(new Float64Array([point.x, point.y]));
        const body = projectedWaterColor(WATER_MAX_DEPTH, environment.oceanBake.patches,
          point.x, point.y, seconds, environment.waterSettings, true);
        const lit = ocean.shade(0, body);
        expect([...frame.raster.pixels.subarray(i * 4, i * 4 + 3)])
          .toEqual(response(lit, point.x, point.y, seconds, 0, ocean.visibility[0] / 255));
        checked++;
      }
      expect(checked).toBeGreaterThan(100);
    }
  });

  it('caches water shadow visibility between animation frames and relights foam through the same lookup', () => {
    const raw = createIslandOcean(77), sun = createIslandSun([], { ...DEFAULT_SUN, intensity: 0.7, warmth: 1 });
    let queries = 0;
    const ocean = createSunlitOcean(raw, {
      ...sun,
      visibility(point, normal) { queries++; return sun.visibility(point, normal); },
    });
    const points = new Float64Array([2, 4, 33, 75, -10, -20]);
    const frame = ocean.prepare(points);
    expect(queries).toBe(3);
    const first = frame.pixels.slice();
    frame.animate(2);
    frame.animate(0);
    expect(queries).toBe(3);
    expect(frame.pixels).toEqual(first);
    expect(frame.shade(0, [205, 226, 207])).toEqual(sun.shade([205, 226, 207], { x: 0, y: 0, z: 1 }, 1));
    points.fill(0);
    frame.animate(0);
    expect(frame.pixels).toEqual(first);
  });
});
