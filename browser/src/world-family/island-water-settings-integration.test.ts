import { describe, expect, it } from 'vitest';
import { generateIslandLandform } from './core/island-landform';
import { createIslandEnvironment } from './render/island-environment';
import { resetWaterSettings } from './render/island-water-settings';

describe('water settings integration', () => {
  it('updates independent immutable settings without invalidating geometry, sun or cached depth', () => {
    const island = generateIslandLandform(153028);
    const environment = createIslandEnvironment(island);
    const depth = environment.waterDepth, shore = environment.shoreMesh, sun = environment.sun;
    const triangles = JSON.stringify([island.triangles, island.beach.underwaterTriangles]);
    const settings = resetWaterSettings();
    settings.deep = [30, 95, 110];
    environment.setWaterSettings(settings);
    settings.deep = [250, 0, 0];
    expect(environment.waterSettings.deep).toEqual([30, 95, 110]);
    expect(Object.isFrozen(environment.waterSettings)).toBe(true);
    expect(Object.isFrozen(environment.waterSettings.deep)).toBe(true);
    expect(environment.waterDepth).toBe(depth);
    expect(environment.shoreMesh).toBe(shore);
    expect(environment.sun).toBe(sun);
    expect(JSON.stringify([island.triangles, island.beach.underwaterTriangles])).toBe(triangles);
    const previous = environment.waterSettings;
    expect(() => environment.setWaterSettings({ ...settings, noiseSpeed: NaN })).toThrow('Water noiseSpeed');
    expect(environment.waterSettings).toBe(previous);
  });
});
