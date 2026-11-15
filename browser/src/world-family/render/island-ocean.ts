export type OceanColor = readonly [number, number, number];

export interface IslandOceanFrame {
  pixels: Uint8ClampedArray;
  readonly basePixels: Uint8ClampedArray;
  readonly patchLevels: Uint8Array;
  animate(seconds: number): void;
}

export interface IslandOcean {
  /** Immutable-by-contract lookup tables, shared with the GPU presentation. */
  readonly bake: { readonly patches: Uint8Array; readonly palette: Uint8Array; readonly waves: Int8Array };
  sample(x: number, y: number, seconds: number): OceanColor;
  prepare(points: Float32Array | Float64Array): IslandOceanFrame;
}

const MAX_POINTS = 2048 * 2048;
const PATCH_SIZE = 256;
const WORLD_PERIOD = PATCH_SIZE * 4;
const WAVE_SIZE = 512;
const WAVE_MASK = WAVE_SIZE - 1;
const TIME_PERIOD = 2560;

const finite = (value: number, name: string) => {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
};
const wrap = (value: number, period: number) => ((value % period) + period) % period;

// Snap inverse-projection roundoff, not genuine positions on either side of a pixel.
function texel(value: number, period: number): number {
  const wrapped = wrap(value, period);
  const nearest = Math.round(wrapped);
  return Math.floor(Math.abs(wrapped - nearest) < 1e-8 ? nearest : wrapped) % period;
}

function hash(x: number, y: number, seed: number): number {
  let value = Math.imul(x ^ seed, 0x45d9f3b) ^ Math.imul(y, 0x27d4eb2d);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function noise(x: number, y: number, cells: number, seed: number, rows = cells): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const gradient = (cx: number, cy: number, dx: number, dy: number) => {
    const angle = hash(wrap(cx, cells), wrap(cy, rows), seed) * Math.PI * 2;
    return Math.cos(angle) * dx + Math.sin(angle) * dy;
  };
  const sx = fade(fx), sy = fade(fy);
  const a = gradient(ix, iy, fx, fy), b = gradient(ix + 1, iy, fx - 1, fy);
  const c = gradient(ix, iy + 1, fx, fy - 1), d = gradient(ix + 1, iy + 1, fx - 1, fy - 1);
  return 0.5 + ((a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy) * 0.8;
}

/**
 * World-anchored, one-unit surface pixels with quiet, low-contrast color variation.
 * Optional inspection crests drift at 0.2, 0.4 units/s; normal water omits them.
 * No coast/depth assumptions: callers composite this surface over their seabed.
 */
export function createIslandOcean(seed: number): IslandOcean {
  finite(seed, 'Ocean seed');
  const seeded = (seed ^ Math.floor(seed / 4294967296)) | 0;
  const patches = new Uint8Array(PATCH_SIZE * PATCH_SIZE);
  const palette = new Uint8Array(256 * 3);
  for (let level = 0; level < 256; level++) {
    const t = level / 255, offset = level * 3;
    palette[offset] = Math.round(43 + t * 3);
    palette[offset + 1] = Math.round(98 + t * 4);
    palette[offset + 2] = Math.round(111 + t * 4);
  }
  for (let y = 0; y < PATCH_SIZE; y++) {
    for (let x = 0; x < PATCH_SIZE; x++) {
      const wx = (noise(x / 32, y / 32, 8, seeded + 41) - 0.5) * 32;
      const wy = (noise(x / 32, y / 32, 8, seeded + 53) - 0.5) * 32;
      const px = x + wx, py = y + wy;
      const breadth = noise(px / 16, py / 8, 16, seeded, 32) * 0.6
        + noise(px / 32, py / 16, 8, seeded + 11, 16) * 0.25
        + noise(px / 8, py / 4, 32, seeded + 29, 64) * 0.15;
      const t = Math.max(0, Math.min(1, (breadth - 0.25) / 0.5));
      patches[y * PATCH_SIZE + x] = Math.round(t * t * (3 - 2 * t) * 255);
    }
  }

  function baseColor(x: number, y: number, pixels: Uint8ClampedArray, offset: number): number {
    const px = x >>> 2, py = y >>> 2, fx = (x & 3) / 4, fy = (y & 3) / 4;
    const a = patches[py * PATCH_SIZE + px] * 3;
    const b = patches[py * PATCH_SIZE + ((px + 1) % PATCH_SIZE)] * 3;
    const c = patches[((py + 1) % PATCH_SIZE) * PATCH_SIZE + px] * 3;
    const d = patches[((py + 1) % PATCH_SIZE) * PATCH_SIZE + ((px + 1) % PATCH_SIZE)] * 3;
    for (let channel = 0; channel < 3; channel++) {
      pixels[offset + channel] = Math.round(
        (palette[a + channel] * (1 - fx) + palette[b + channel] * fx) * (1 - fy)
        + (palette[c + channel] * (1 - fx) + palette[d + channel] * fx) * fy);
    }
    pixels[offset + 3] = 255;
    return Math.round((patches[py * PATCH_SIZE + px] * (1 - fx)
      + patches[py * PATCH_SIZE + ((px + 1) % PATCH_SIZE)] * fx) * (1 - fy)
      + (patches[((py + 1) % PATCH_SIZE) * PATCH_SIZE + px] * (1 - fx)
        + patches[((py + 1) % PATCH_SIZE) * PATCH_SIZE + ((px + 1) % PATCH_SIZE)] * fx) * fy);
  }

  const waves = new Int8Array(WAVE_SIZE * WAVE_SIZE);
  const put = (x: number, y: number, value: number) => {
    const index = (y & WAVE_MASK) * WAVE_SIZE + (x & WAVE_MASK);
    if (Math.abs(value) > Math.abs(waves[index])) waves[index] = value;
  };
  for (let row = 0; row < 16; row++) {
    for (let column = 0; column < 8; column++) {
      if (hash(column, row, seeded + 101) > 0.65) continue;
      const x = column * 64 + Math.floor(hash(column, row, seeded + 103) * 64);
      const y = row * 32 + Math.floor(hash(column, row, seeded + 107) * 32);
      const length = 9 + Math.floor(hash(column, row, seeded + 109) * 20);
      const glint = hash(column, row, seeded + 113) > 0.88;
      for (let step = 0; step < length; step++) {
        if (step > length * 0.55 && step < length * 0.55 + 2) continue;
        const py = y + Math.floor(step * 0.14);
        const strength = glint && step < length * 0.45 ? 28 : 9;
        put(x + step, py, strength);
        put(x + step, py + 1, 5);
        put(x + step - 1, py + 2, -5);
      }
    }
  }

  function shade(pixels: Uint8ClampedArray, offset: number, base: Uint8ClampedArray, wave: number,
    dx: number, dy: number, fx: number, fy: number): void {
    const x = ((wave & WAVE_MASK) - dx) & WAVE_MASK;
    const y = ((wave >>> 9) - dy) & WAVE_MASK;
    const left = (x - 1) & WAVE_MASK, above = ((y - 1) & WAVE_MASK) * WAVE_SIZE;
    const row = y * WAVE_SIZE;
    const a = waves[row + x] * (1 - fx) + waves[row + left] * fx;
    const b = waves[above + x] * (1 - fx) + waves[above + left] * fx;
    const crest = a * (1 - fy) + b * fy;
    pixels[offset] = Math.round(base[offset] + crest);
    pixels[offset + 1] = Math.round(base[offset + 1] + crest * 1.12);
    pixels[offset + 2] = Math.round(base[offset + 2] + crest);
    pixels[offset + 3] = 255;
  }

  function prepare(points: Float32Array | Float64Array): IslandOceanFrame {
    if (!(points instanceof Float32Array || points instanceof Float64Array)
      || points.length % 2 !== 0 || points.length / 2 > MAX_POINTS) {
      throw new RangeError('Ocean points must be paired Float32/64 coordinates, at most 4,194,304 points.');
    }
    // Validate before allocating the large buffers; descriptors snapshot caller input.
    for (let i = 0; i < points.length; i++) finite(points[i], 'Ocean coordinate');
    const count = points.length / 2;
    const positions = new Uint32Array(count);
    const patchLevels = new Uint8Array(count);
    const pixels = new Uint8ClampedArray(count * 4);
    const basePixels = new Uint8ClampedArray(count * 4);
    for (let i = 0; i < count; i++) {
      const x = texel(points[i * 2], WORLD_PERIOD), y = texel(points[i * 2 + 1], WORLD_PERIOD);
      patchLevels[i] = baseColor(x, y, basePixels, i * 4);
      positions[i] = (y & WAVE_MASK) * WAVE_SIZE + (x & WAVE_MASK);
    }
    const frame: IslandOceanFrame = {
      pixels,
      basePixels,
      patchLevels,
      animate(seconds) {
        finite(seconds, 'Ocean time');
        const time = wrap(seconds, TIME_PERIOD);
        const x = time * 0.2, y = time * 0.4;
        const dx = Math.floor(x), dy = Math.floor(y), fx = x - dx, fy = y - dy;
        for (let i = 0; i < count; i++) shade(pixels, i * 4, basePixels, positions[i], dx, dy, fx, fy);
      },
    };
    frame.animate(0);
    return frame;
  }

  // One scratch pixel per sampler; sample never mutates any prepared frame.
  const pixel = new Uint8ClampedArray(4);
  const base = new Uint8ClampedArray(4);
  return {
    bake: { patches, palette, waves },
    prepare,
    sample(x, y, seconds) {
      finite(x, 'Ocean x');
      finite(y, 'Ocean y');
      finite(seconds, 'Ocean time');
      const px = texel(x, WORLD_PERIOD), py = texel(y, WORLD_PERIOD);
      const time = wrap(seconds, TIME_PERIOD), tx = time * 0.2, ty = time * 0.4;
      const dx = Math.floor(tx), dy = Math.floor(ty);
      baseColor(px, py, base, 0);
      shade(pixel, 0, base,
        (py & WAVE_MASK) * WAVE_SIZE + (px & WAVE_MASK), dx, dy, tx - dx, ty - dy);
      return [pixel[0], pixel[1], pixel[2]];
    },
  };
}
