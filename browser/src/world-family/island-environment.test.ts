import { describe, expect, it } from 'vitest';
import { buildIslandLandform, generateIslandLandform } from './core/island-landform';
import { projectLandVertex } from './core/landform-study';
import type { World } from './core/contracts';
import { createCoastField, createIslandEnvironment, waterWorldPoint, worldHeightFromDepth } from './render/island-environment';
import type { RabbitPixels } from './render/landform-study';
import { createDefaultLayersInspection } from './render/landform-diagnostics';

const viewport = { width: 820, height: 600, origin: { x: 350, y: 120 } };
const rabbit: RabbitPixels = { width: 3, height: 8, pixels: new Uint8ClampedArray(3 * 8 * 4) };
for (let i = 0; i < rabbit.pixels.length; i += 4) rabbit.pixels.set([255, 0, 255, 255], i);

describe('world-space V2 island environment', () => {
  it.each(['current','oblique'] as const)('renders %s flat ground without raised grass pixels',projection => {
    const world: World = {
      seed: 153025,generatorVersion: 'detail-fixture',provenance: 'test-fixture',
      width: 16,height: 16,tileSize: 8,seaLevel: 0,
      cells: new Uint8Array(256).fill(1),heights: new Float32Array(256).fill(1),
      elevations: new Uint8Array(256),rampIds: new Int32Array(256).fill(-1),ramps: [],
    };
    const environment = createIslandEnvironment(buildIslandLandform(world));
    const view = { width: 320,height: 320,origin: projection === 'oblique' ? { x: 160,y: 80 } : { x: 80,y: 80 } };
    const frame = environment.render(projection,view,undefined,{}, { yaw: 0.37,center: { x: 64,y: 64 } });
    let groundPixels = 0;
    for (let i = 0; i < frame.raster.depth.length; i++) {
      const depth = frame.raster.depth[i];
      if (!Number.isFinite(depth)) continue;
      const height = worldHeightFromDepth(Math.floor(i/view.width)+0.5-view.origin.y,depth,projection);
      expect(height).toBeLessThan(1e-6);
      groundPixels++;
    }
    expect(groundPixels).toBeGreaterThan(1000);
    expect(frame.grassCount).toBe(0);
  });

  it('measures wet and dry distances against actual cell boundaries, including outside the map', () => {
    const world: World = {
      seed: 1, generatorVersion: 'test', width: 3, height: 3, tileSize: 8, seaLevel: 0,
      heights: new Float32Array(9), cells: new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0, 0]),
      provenance: 'test-fixture',
    };
    const coast = createCoastField(world);
    expect(coast.sample(8, 12)).toBeCloseTo(0);
    expect(coast.sample(7.5, 12)).toBeCloseTo(0.5);
    expect(coast.sample(8.5, 12)).toBeCloseTo(-0.5);
    expect(coast.sample(12, 12)).toBeLessThan(-3);
    expect(coast.sample(-20, 12)).toBeCloseTo(28);
  });

  it.each(['current', 'oblique', 'plan'] as const)('maps water pixels back to the same world location in %s', projection => {
    const source = { x: 32, y: 74, z: projection === 'plan' ? 0 : -2.5 };
    const screen = projectLandVertex(source, projection);
    const point = waterWorldPoint(screen.x, screen.y, projection);
    expect(point.x).toBeCloseTo(source.x, 8);
    expect(point.y).toBeCloseTo(source.y, 8);
  });

  it.each([12, 41, 902479])('retains the source geometry and produces repeatable water without grass for seed %i', seed => {
    const island = generateIslandLandform(seed);
    const before = structuredClone(island);
    const environment = createIslandEnvironment(island);
    const first = environment.render('oblique', viewport, rabbit);
    const second = environment.render('oblique', viewport, rabbit);
    expect(first.raster.pixels.every((value, i) => value === second.raster.pixels[i])).toBe(true);
    expect(first.grassCount).toBe(0);
    expect(first.waterPixels).toBeGreaterThan(1000);
    expect(island).toEqual(before);
  });

  it('animates the normal surface without foam or changes to exposed terrain, rabbits or geometry', () => {
    const environment = createIslandEnvironment(generateIslandLandform(12));
    const flatLayers = createDefaultLayersInspection();
    flatLayers.water.surfaceResponse = false;
    flatLayers.water.shoreFoam = false;
    flatLayers.water.colorPatches = false;
    const calm = environment.render('oblique', viewport, rabbit, { layers: flatLayers });
    const still = calm.raster.pixels.slice();
    calm.animate(2.5);
    expect(calm.raster.pixels).toEqual(still);
    expect(calm.foamPixels).toBe(0);
    const layers = createDefaultLayersInspection();
    layers.water.shoreFoam = false;
    const frame = environment.render('oblique', viewport, rabbit, { layers });
    const before = frame.raster.pixels.slice();
    frame.animate(2.5);
    let changed = 0, visibleRabbit = 0, changedSolid = 0;
    for (let i = 0; i < frame.raster.depth.length; i++) {
      const offset = i * 4;
      if (!frame.waterMask[i]) {
        if ([0, 1, 2, 3].some(channel => frame.raster.pixels[offset + channel] !== before[offset + channel])) changedSolid++;
      } else if (frame.raster.pixels[offset] !== before[offset]
        || frame.raster.pixels[offset + 1] !== before[offset + 1]
        || frame.raster.pixels[offset + 2] !== before[offset + 2]) changed++;
      if (before[offset] === 255 && before[offset + 1] === 0 && before[offset + 2] === 255) visibleRabbit++;
    }
    expect(changed).toBeGreaterThan(500);
    expect(changedSolid).toBe(0);
    expect(frame.submergedPixels).toBeGreaterThan(0);
    expect(frame.foamPixels).toBe(0);
    expect(frame.raster.depth).toEqual(calm.raster.depth);
    expect(frame.waterMask).toEqual(calm.waterMask);
    expect(frame.submergedMask).toEqual(calm.submergedMask);
    expect(visibleRabbit).toBeGreaterThan(10);
    frame.animate(0);
    expect(frame.raster.pixels.every((value, i) => value === before[i])).toBe(true);
    expect(() => frame.animate(NaN)).toThrow('finite');
  });

  it('keeps the elevation plan diagnostic and rejects invalid raster dimensions', () => {
    const environment = createIslandEnvironment(generateIslandLandform(12));
    const frame = environment.render('plan', viewport, rabbit);
    const before = frame.raster.pixels.slice();
    expect(frame.grassCount).toBe(0);
    expect(frame.waterPixels).toBe(0);
    frame.animate(3);
    expect(frame.raster.pixels.every((value, i) => value === before[i])).toBe(true);
    expect(() => environment.render('oblique', { ...viewport, width: 0 })).toThrow('viewport');
  });
});
