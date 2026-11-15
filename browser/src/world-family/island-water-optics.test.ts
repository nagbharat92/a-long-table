import { describe, expect, it } from 'vitest';
import { ISLAND_WATER_HEIGHT } from './core/island-water-level';
import { waterBedOpticalDepth } from './render/island-water-optics';
import { waterBedTransmission } from './render/island-water-color';
import { waterViewDirection } from './render/island-water-surface';
import { generateIslandLandform } from './core/island-landform';
import { islandOrbitCenter, islandOrbitViewport } from './core/island-view';
import { createIslandEnvironment } from './render/island-environment';
import { createDefaultLayersInspection } from './render/landform-diagnostics';
import { DEFAULT_SUN } from './render/island-sun';

describe('submerged shelves behind displaced water', () => {
  it('transmits real submerged tops but never the directly visible vertical risers', () => {
    const island = generateIslandLandform(153028);
    const environment = createIslandEnvironment(island, { ...DEFAULT_SUN, mapSize: 512 });
    const camera = { center: islandOrbitCenter(island.triangles), yaw: Math.PI };
    const viewport = islandOrbitViewport([...island.triangles, ...island.beach.underwaterTriangles], 'oblique', camera);
    const normal = createDefaultLayersInspection(), hidden = createDefaultLayersInspection();
    hidden.water.seabedVisibility = false;
    const shown = environment.render('oblique', viewport, undefined, { layers: normal }, camera);
    const obscured = environment.render('oblique', viewport, undefined, { layers: hidden }, camera);
    let walls = 0, topChanges = 0;
    for (const seconds of [0, 2, 4, 6]) {
      shown.animate(seconds); obscured.animate(seconds);
      for (let i = 0; i < shown.raster.depth.length; i++) {
        if (!shown.raster.submerged?.[i]) continue;
        const changed = [0, 1, 2].some(c => shown.raster.pixels[i * 4 + c] !== obscured.raster.pixels[i * 4 + c]);
        if (shown.raster.submergedTop?.[i]) topChanges += Number(changed);
        else { walls++; expect(changed).toBe(false); }
      }
    }
    expect(walls).toBeGreaterThan(100);
    expect(topChanges).toBeGreaterThan(100);
  });

  it.each(['current', 'oblique'] as const)('preserves flat-water clarity in %s', projection => {
    const view = waterViewDirection(projection);
    for (const depth of [0, 0.75, 2, 3.5, 4.75]) {
      expect(waterBedOpticalDepth(ISLAND_WATER_HEIGHT, ISLAND_WATER_HEIGHT - depth, view.z)).toBe(depth);
    }
  });

  it.each(['current', 'oblique'] as const)('obscures a sea-level shelf through a full run-up in %s', projection => {
    const optical = waterBedOpticalDepth(ISLAND_WATER_HEIGHT + 2, ISLAND_WATER_HEIGHT,
      waterViewDirection(projection).z);
    expect(optical).toBeGreaterThan(2);
    expect(waterBedTransmission(optical, true)).toBeLessThan(0.08);
  });

  it.each(['current', 'oblique'] as const)('obscures shelves behind lower approaching crests in %s', projection => {
    for (const rise of [0.55, 0.65, 0.78]) {
      const optical = waterBedOpticalDepth(ISLAND_WATER_HEIGHT + rise, ISLAND_WATER_HEIGHT,
        waterViewDirection(projection).z);
      expect(waterBedTransmission(optical, true)).toBeLessThan(0.05);
    }
  });

  it('returns continuously to the original attenuation during retreat', () => {
    let previous = 0.75;
    for (let rise = 0; rise <= 2; rise += 0.01) {
      const depth = waterBedOpticalDepth(ISLAND_WATER_HEIGHT + rise, ISLAND_WATER_HEIGHT - 0.75, 0.5);
      expect(depth).toBeGreaterThanOrEqual(previous);
      expect(depth - previous).toBeLessThan(0.101);
      previous = depth;
    }
  });

  it('does not count air below an uncovered surface as water', () => {
    expect(waterBedOpticalDepth(-2.5, 0, 0.5)).toBe(0);
    expect(waterBedOpticalDepth(-0.5, -1, 0.5)).toBe(5);
  });

  it('rejects invalid inputs', () => {
    for (const view of [0, -1, 2, NaN, Infinity]) {
      expect(() => waterBedOpticalDepth(-2, -3, view)).toThrow('Water optics');
    }
    expect(() => waterBedOpticalDepth(Infinity, -3, 0.5)).toThrow('Water optics');
  });
});
