import { ISLAND_WATER_HEIGHT } from '../core/island-water-level';
import type { IslandOcean, IslandOceanFrame, OceanColor } from './island-ocean';
import type { IslandSun } from './island-sun';

const UP = { x: 0, y: 0, z: 1 };

export interface SunlitOceanFrame extends IslandOceanFrame {
  readonly unlitPixels: Uint8ClampedArray;
  readonly visibility: Uint8Array;
  shade(index: number, color: readonly number[]): OceanColor;
}

export interface SunlitOcean extends IslandOcean {
  prepare(points: Float32Array | Float64Array): SunlitOceanFrame;
}

export function createSunlitOcean(ocean: IslandOcean, sun: IslandSun): SunlitOcean {
  // Sunlight is static between edits. Animation only looks up already-lit colors.
  const table = new Uint8Array(256 * 256 * 3);
  for (let visibility = 0; visibility < 256; visibility++) {
    for (let value = 0; value < 256; value++) {
      table.set(sun.shade([value, value, value], UP, visibility / 255), (visibility * 256 + value) * 3);
    }
  }
  function visibilityAt(x: number, y: number): number {
    return Math.round(sun.visibility({ x, y, z: ISLAND_WATER_HEIGHT }, UP) * 255);
  }
  function shade(visibility: number, color: readonly number[]): OceanColor {
    const offset = visibility * 256 * 3;
    if (color.length !== 3 || !color.every(Number.isFinite)) throw new RangeError('Water lighting requires three finite RGB components.');
    const channel = (value: number) => Math.round(Math.max(0, Math.min(255, value)));
    return [
      table[offset + channel(color[0]) * 3],
      table[offset + channel(color[1]) * 3 + 1],
      table[offset + channel(color[2]) * 3 + 2],
    ];
  }
  return {
    bake: ocean.bake,
    sample(x, y, seconds) {
      const color = ocean.sample(x, y, seconds);
      return shade(visibilityAt(x, y), color);
    },
    prepare(points) {
      const raw = ocean.prepare(points);
      const count = points.length / 2;
      const visibility = new Uint8Array(count);
      const pixels = new Uint8ClampedArray(count * 4);
      for (let i = 0; i < count; i++) visibility[i] = visibilityAt(points[i * 2], points[i * 2 + 1]);
      const frame: SunlitOceanFrame = {
        pixels,
        basePixels: raw.basePixels,
        patchLevels: raw.patchLevels,
        unlitPixels: raw.pixels,
        visibility,
        shade(index, color) {
          return shade(visibility[index], color);
        },
        animate(seconds) {
          raw.animate(seconds);
          for (let i = 0; i < count; i++) {
            const offset = i * 4, light = visibility[i] * 256 * 3;
            pixels[offset] = table[light + raw.pixels[offset] * 3];
            pixels[offset + 1] = table[light + raw.pixels[offset + 1] * 3 + 1];
            pixels[offset + 2] = table[light + raw.pixels[offset + 2] * 3 + 2];
            pixels[offset + 3] = 255;
          }
        },
      };
      frame.animate(0);
      return frame;
    },
  };
}
