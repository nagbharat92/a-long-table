import { RIG_HEIGHT, RIG_WIDTH, type RigLayer } from './character-rig';
import type { Point, Rectangle } from './contracts';

export type Color = readonly [number, number, number, number];
export type Palette = Readonly<Record<string, Color>>;
export const SIZE = RIG_WIDTH * RIG_HEIGHT * 4;

export function color(value: string): Color {
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error('Authored artwork colors must use six-digit hex values.');
  return [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16), 255];
}

export function mix(a: Color, b: Color, weight: number): Color {
  return [
    Math.round(a[0] + (b[0] - a[0]) * weight),
    Math.round(a[1] + (b[1] - a[1]) * weight),
    Math.round(a[2] + (b[2] - a[2]) * weight), 255,
  ];
}

export function stamp(pixels: Uint8ClampedArray, x: number, y: number, rows: readonly string[], palette: Palette): void {
  rows.forEach((row, dy) => {
    [...row].forEach((role, dx) => {
      if (role === ' ') return;
      if (x + dx < 0 || x + dx >= RIG_WIDTH || y + dy < 0 || y + dy >= RIG_HEIGHT) {
        throw new RangeError('Authored artwork must stay inside its 18 by 29 canvas.');
      }
      if (!Object.hasOwn(palette, role)) throw new Error(`Unknown authored artwork pixel symbol: ${JSON.stringify(role)}.`);
      pixels.set(palette[role], ((y + dy) * RIG_WIDTH + x + dx) * 4);
    });
  });
}

export function composite(buffers: readonly Uint8ClampedArray[]): Uint8ClampedArray {
  const result = new Uint8ClampedArray(SIZE);
  for (const pixels of buffers) {
    for (let i = 0; i < SIZE; i += 4) {
      if (pixels[i + 3]) result.set(pixels.subarray(i, i + 4), i);
    }
  }
  return result;
}

export function bounds(pixels: Uint8ClampedArray): Rectangle {
  let left = RIG_WIDTH, top = RIG_HEIGHT, right = 0, bottom = 0;
  for (let y = 0; y < RIG_HEIGHT; y++) {
    for (let x = 0; x < RIG_WIDTH; x++) {
      if (!pixels[(y * RIG_WIDTH + x) * 4 + 3]) continue;
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
    }
  }
  return right > left ? { x: left, y: top, width: right - left, height: bottom - top }
    : { x: 0, y: 0, width: 0, height: 0 };
}

export function part(id: RigLayer['id'], pixels: Uint8ClampedArray, pivot: Point): RigLayer {
  const padding = new Uint8ClampedArray(SIZE);
  for (let y = 0; y < RIG_HEIGHT; y++) {
    for (let x = 0; x < RIG_WIDTH; x++) {
      const i = (y * RIG_WIDTH + x) * 4;
      if (pixels[i + 3] && Math.hypot(x + 0.5 - pivot.x, y + 0.5 - pivot.y) <= 2.5) {
        padding.set(pixels.subarray(i, i + 4), i);
      }
    }
  }
  return { id, pixels, padding, bounds: bounds(pixels) };
}
