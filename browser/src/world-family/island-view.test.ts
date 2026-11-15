import { describe, expect, it } from 'vitest';
import { islandOrbitCenter, islandOrbitViewport, islandTurnProgress, islandViewFromParameters, ISLAND_FRAME_PADDING, ISLAND_TURN_DURATION, QUARTER_TURN } from './core/island-view';
import { generateIslandLandform } from './core/island-landform';
import { projectLandVertex } from './core/landform-study';
import { waterWorldPoint, worldHeightFromDepth } from './render/island-environment';

describe('fixed island views', () => {
  it('rotates around the land footprint instead of the generation rectangle', () => {
    const island = generateIslandLandform(152941);
    const center = islandOrbitCenter(island.triangles);
    const points = island.triangles.flatMap(triangle => triangle.vertices);
    expect(center.x).toBe((Math.min(...points.map(p => p.x)) + Math.max(...points.map(p => p.x))) / 2);
    expect(center.y).toBe((Math.min(...points.map(p => p.y)) + Math.max(...points.map(p => p.y))) / 2);
    expect(center).not.toEqual({ x: island.world.width * island.world.tileSize / 2, y: island.world.height * island.world.tileSize / 2 });
    for (const projection of ['oblique', 'current', 'plan'] as const) {
      const projected = projectLandVertex({ ...center, z: 0 }, projection);
      for (let step = 0; step < 32; step++) {
        expect(projectLandVertex({ ...center, z: 0 }, projection, { center, yaw: step * Math.PI / 16 })).toEqual(projected);
      }
    }
    expect(() => islandOrbitCenter([])).toThrow('terrain triangles');
  });

  it('accepts only the four saved views', () => {
    expect(islandViewFromParameters(new URLSearchParams())).toBe(0);
    for (let view = 0; view < 4; view++) expect(islandViewFromParameters(new URLSearchParams({ view: String(view) }))).toBe(view);
    for (const view of ['-1', '4', 'NaN', '1.5', '', '01']) {
      expect(() => islandViewFromParameters(new URLSearchParams({ view }))).toThrow('Island view');
    }
  });

  it('eases monotonically between exact stops with gentle starts and finishes', () => {
    expect(islandTurnProgress(0)).toBe(0);
    expect(islandTurnProgress(ISLAND_TURN_DURATION / 2)).toBeCloseTo(0.5);
    expect(islandTurnProgress(ISLAND_TURN_DURATION)).toBe(1);
    expect(islandTurnProgress(ISLAND_TURN_DURATION * 2)).toBe(1);
    expect(islandTurnProgress(10)).toBeLessThan(0.001);
    expect(islandTurnProgress(ISLAND_TURN_DURATION - 10)).toBeGreaterThan(0.999);
    let previous = 0;
    for (let ms = 0; ms <= ISLAND_TURN_DURATION; ms++) {
      const progress = islandTurnProgress(ms);
      expect(progress).toBeGreaterThanOrEqual(previous);
      previous = progress;
    }
    expect(() => islandTurnProgress(NaN)).toThrow();
    expect(() => islandTurnProgress(-1)).toThrow();
  });

  it.each(['current', 'oblique', 'plan'] as const)('keeps world-space water, depth and framing consistent in %s', projection => {
    const island = generateIslandLandform(12);
    const center = islandOrbitCenter(island.triangles);
    const before = structuredClone(island.triangles);
    const viewport = islandOrbitViewport(island.triangles, projection, { yaw: 0, center });
    for (let step = -4; step <= 16; step++) {
      const camera = { center, yaw: step * QUARTER_TURN / 4 };
      expect(islandOrbitViewport(island.triangles, projection, camera)).toEqual(viewport);
      const water = { x: 73, y: 125, z: projection === 'plan' ? 0 : -2.5 };
      const screen = projectLandVertex(water, projection, camera);
      const reconstructed = waterWorldPoint(screen.x, screen.y, projection, camera);
      expect(reconstructed.x).toBeCloseTo(water.x, 8);
      expect(reconstructed.y).toBeCloseTo(water.y, 8);
      expect(worldHeightFromDepth(screen.y, screen.z, projection)).toBeCloseTo(water.z, 8);
      for (const triangle of island.triangles) for (const vertex of triangle.vertices) {
        const point = projectLandVertex(vertex, projection, camera);
        expect(point.x + viewport.origin.x).toBeGreaterThanOrEqual(ISLAND_FRAME_PADDING - 0.01);
        expect(point.x + viewport.origin.x).toBeLessThan(viewport.width - ISLAND_FRAME_PADDING + 1);
        expect(point.y + viewport.origin.y).toBeGreaterThanOrEqual(ISLAND_FRAME_PADDING - 0.01);
        expect(point.y + viewport.origin.y).toBeLessThan(viewport.height - ISLAND_FRAME_PADDING + 1);
      }
    }
    expect(island.triangles).toEqual(before);
  });
});
