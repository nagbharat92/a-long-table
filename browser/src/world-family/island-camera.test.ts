import { describe, expect, it } from 'vitest';
import { clampIslandCenter, stepIslandZoom } from './core/island-camera';

describe('island zoom spring', () => {
  it('reaches the target quickly, overshoots a little, then settles', () => {
    const min = 1;
    const max = 32;
    const start = 4;
    const target = 5;
    const near = stepIslandZoom(start, target, 0, 0.06, min, max);
    expect(near.zoom).toBeGreaterThan(4.85);
    const peak = stepIslandZoom(start, target, 0, 0.1, min, max);
    expect(peak.zoom).toBeGreaterThan(target);
    expect(peak.zoom).toBeLessThan(5.1);
    const settled = stepIslandZoom(start, target, 0, 0.4, min, max);
    expect(settled).toEqual({ zoom: target, velocity: 0 });
  });

  it.each([15, 30, 60, 120, 144])('has the same response at %i Hz', hz => {
    let sample = { zoom: 4, velocity: 0 };
    const seconds = 0.15;
    const frames = Math.floor(seconds * hz);
    for (let frame = 0; frame < frames; frame++) sample = stepIslandZoom(sample.zoom, 5, sample.velocity, 1 / hz, 1, 32);
    sample = stepIslandZoom(sample.zoom, 5, sample.velocity, seconds - frames / hz, 1, 32);
    const expected = stepIslandZoom(4, 5, 0, seconds, 1, 32);
    expect(sample.zoom).toBeCloseTo(expected.zoom, 10);
    expect(sample.velocity).toBeCloseTo(expected.velocity, 10);
  });

  it('honors hard zoom limits even with spring momentum', () => {
    for (const [zoom, target, velocity] of [[30, 32, 4], [2, 1, -4]]) {
      let sample = { zoom, velocity };
      for (let frame = 0; frame < 60; frame++) {
        sample = stepIslandZoom(sample.zoom, target, sample.velocity, 1 / 60, 1, 32);
        expect(sample.zoom).toBeGreaterThanOrEqual(1);
        expect(sample.zoom).toBeLessThanOrEqual(32);
      }
      expect(sample).toEqual({ zoom: target, velocity: 0 });
    }
  });
});

describe('island pan bounds', () => {
  const island = { x: 10, y: 20, width: 200, height: 100 };
  const viewport = { width: 1000, height: 800 };
  it('locks the fitted island at the center', () => {
    expect(clampIslandCenter({ x: -9999, y: 9999 }, island, viewport, 4, 4)).toEqual({ x: 110, y: 70 });
  });
  it('clamps all four sides and allows immediate reversal off an edge', () => {
    expect(clampIslandCenter({ x: -9999, y: -9999 }, island, viewport, 8, 4)).toEqual({ x: 47.5, y: 20 });
    expect(clampIslandCenter({ x: 9999, y: 9999 }, island, viewport, 8, 4)).toEqual({ x: 172.5, y: 120 });
    expect(clampIslandCenter({ x: 48, y: 21 }, island, viewport, 8, 4)).toEqual({ x: 48, y: 21 });
  });
});
