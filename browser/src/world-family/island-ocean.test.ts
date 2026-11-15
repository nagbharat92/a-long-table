import { describe, expect, it } from 'vitest';
import { createIslandOcean } from './render/island-ocean';

function grid(width: number, height: number, origin = 0): Float64Array {
  const points = new Float64Array(width * height * 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 2;
      points[offset] = x + origin;
      points[offset + 1] = y + origin;
    }
  }
  return points;
}

describe('world-anchored island ocean', () => {
  it('is seeded, independent of query order, and exactly replays paused frames', () => {
    const ocean = createIslandOcean(71), again = createIslandOcean(71), other = createIslandOcean(72);
    const points = grid(96, 64, -43);
    const first = ocean.prepare(points), second = again.prepare(points), different = other.prepare(points);
    first.animate(2);
    second.animate(2);
    different.animate(2);
    expect(first.pixels).toEqual(second.pixels);
    expect(first.pixels).not.toEqual(different.pixels);
    const identity = first.pixels, paused = first.pixels.slice();
    first.animate(0);
    first.animate(-3);
    first.animate(2);
    expect(first.pixels).toBe(identity);
    expect(first.pixels).toEqual(paused);
    for (let i = 20; i >= 0; i--) {
      expect(ocean.sample(i - 4, i * 7, 2)).toEqual(again.sample(i - 4, i * 7, 2));
    }
    const zero = ocean.prepare(points).pixels.slice();
    first.animate(0);
    expect(first.pixels).toEqual(zero);
  });

  it.each([Float32Array, Float64Array])('matches prepared pixels exactly for %s world coordinates', ArrayType => {
    const ocean = createIslandOcean(19);
    const points = new ArrayType([
      0, 0, -0.01, -0.01, -1024, 1024, -1024.5, 2048.75,
      1e9 + 0.25, -1e9 - 0.75, 1e30, -1e30, 104, 51, 511.999999, -512.000001,
    ]);
    const frame = ocean.prepare(points);
    for (const seconds of [0, 0.125, 2, -2, 2560, 1e30, Number.MAX_VALUE]) {
      frame.animate(seconds);
      for (let i = 0; i < points.length / 2; i++) {
        expect([...frame.pixels.slice(i * 4, i * 4 + 4)]).toEqual([
          ...ocean.sample(points[i * 2], points[i * 2 + 1], seconds), 255,
        ]);
      }
    }
    const before = frame.pixels.slice();
    points.fill(0);
    frame.animate(Number.MAX_VALUE);
    expect(frame.pixels).toEqual(before);
  });

  it('wraps negatives and large coordinates, stabilizing only tiny boundary errors', () => {
    const ocean = createIslandOcean(71);
    for (const time of [0, 2.125, -17]) {
      for (let x = -1030; x < 1030; x += 7) {
        const y = x * 3;
        const expected = ocean.sample(x, y, time);
        expect(ocean.sample(x - 1e-12, y + 1e-12, time)).toEqual(expected);
        expect(ocean.sample(x + 1e-12, y - 1e-12, time)).toEqual(expected);
        expect(ocean.sample(x + 1024 * 1000, y - 1024 * 1000, time)).toEqual(expected);
        expect(ocean.sample(x - 1e-7, y, time)).toEqual(ocean.sample(x - 0.5, y, time));
      }
      expect(ocean.sample(-0.01, -0.01, time)).toEqual(ocean.sample(1023.99, 1023.99, time));
    }
    expect(ocean.sample(Number.MAX_VALUE, -Number.MAX_VALUE, 0).every(Number.isFinite)).toBe(true);
  });

  it('has quiet cool variation and retains optional connected inspection crests', () => {
    const ocean = createIslandOcean(71);
    const width = 512, frame = ocean.prepare(grid(width, width));
    const colors = new Set<string>();
    let glints = 0, connected = 0, xEdges = 0, yEdges = 0, near = 0, far = 0;
    const pixels = frame.pixels;
    for (let y = 0; y < width - 1; y++) {
      for (let x = 0; x < width - 1; x++) {
        const offset = (y * width + x) * 4;
        const r = pixels[offset], g = pixels[offset + 1], b = pixels[offset + 2];
        colors.add(`${r},${g},${b}`);
        expect(r >= 38 && r <= 78 && g >= 92 && g <= 145 && b >= 106 && b <= 150).toBe(true);
        expect(b > r + 50 && g > r + 40 && pixels[offset + 3] === 255).toBe(true);
        if (r - frame.basePixels[offset] > 20) {
          glints++;
          if (pixels[offset + 4] - frame.basePixels[offset + 4] > 20
            || (x > 0 && pixels[offset - 4] - frame.basePixels[offset - 4] > 20)) connected++;
        }
        const crest = r - frame.basePixels[offset];
        if (crest !== pixels[offset + 4] - frame.basePixels[offset + 4]) xEdges++;
        if (crest !== pixels[offset + width * 4] - frame.basePixels[offset + width * 4]) yEdges++;
        near += Math.abs(frame.basePixels[offset] - frame.basePixels[offset + 4]);
        far += Math.abs(frame.basePixels[offset] - frame.basePixels[(y * width + ((x + 101) % width)) * 4]);
      }
    }
    expect(colors.size).toBeGreaterThan(15);
    expect(glints).toBeGreaterThan(50);
    expect(glints / (width * width)).toBeLessThan(0.01);
    expect(connected / glints).toBeGreaterThan(0.9);
    expect(yEdges).toBeGreaterThan(xEdges * 1.1);
    expect(far).toBeGreaterThan(near * 8);
  });

  it('moves a small connected fraction slowly rather than flickering the whole surface', () => {
    const ocean = createIslandOcean(71), width = 512;
    const frame = ocean.prepare(grid(width, width)), initial = frame.pixels.slice();
    frame.animate(0.125);
    let changed = 0, connected = 0, difference = 0, maximum = 0;
    const changedAt = (index: number) => frame.pixels[index * 4] !== initial[index * 4];
    for (let i = 0; i < width * width; i++) {
      const delta = Math.abs(frame.pixels[i * 4] - initial[i * 4]);
      maximum = Math.max(maximum, delta);
      difference += delta;
      if (delta) {
        changed++;
        if ((i % width > 0 && changedAt(i - 1))
          || (i % width < width - 1 && changedAt(i + 1))
          || (i >= width && changedAt(i - width))
          || (i < width * (width - 1) && changedAt(i + width))) connected++;
      }
    }
    expect(changed / (width * width)).toBeGreaterThan(0.001);
    expect(changed / (width * width)).toBeLessThan(0.06);
    // At a fractional-pixel drift some stair-step corners round independently.
    // Random sparse flicker would have very few directly touching changed pixels.
    expect(connected / changed).toBeGreaterThan(0.7);
    expect(maximum).toBeLessThanOrEqual(3);
    expect(difference / (width * width)).toBeLessThan(0.08);
    frame.animate(2);
    expect(frame.pixels).not.toEqual(initial);
    frame.animate(0);
    expect(frame.pixels).toEqual(initial);
  });

  it('rejects invalid input and bounds allocation to a 2048-square raster', () => {
    for (const invalid of [NaN, Infinity, -Infinity]) {
      expect(() => createIslandOcean(invalid)).toThrow(RangeError);
      const ocean = createIslandOcean(0), frame = ocean.prepare(new Float64Array([0, 0]));
      expect(() => ocean.sample(invalid, 0, 0)).toThrow(RangeError);
      expect(() => ocean.sample(0, invalid, 0)).toThrow(RangeError);
      expect(() => ocean.sample(0, 0, invalid)).toThrow(RangeError);
      expect(() => ocean.prepare(new Float64Array([0, invalid]))).toThrow(RangeError);
      const before = frame.pixels.slice();
      expect(() => frame.animate(invalid)).toThrow(RangeError);
      expect(frame.pixels).toEqual(before);
    }
    const ocean = createIslandOcean(0);
    expect(() => ocean.prepare(new Float32Array(3))).toThrow(RangeError);
    expect(() => ocean.prepare(new Float32Array((2048 * 2048 + 1) * 2))).toThrow(RangeError);
    expect(() => ocean.prepare([0, 0] as unknown as Float32Array)).toThrow(RangeError);
    const empty = ocean.prepare(new Float64Array());
    empty.animate(-2);
    expect(empty.pixels.length).toBe(0);
  });

  it('updates a representative backdrop in-place without rebuilding spatial descriptors', () => {
    const start = performance.now(), ocean = createIslandOcean(71);
    const created = performance.now();
    const frame = ocean.prepare(grid(640, 480, -256));
    const prepared = performance.now(), identity = frame.pixels;
    for (let i = 0; i < 24; i++) frame.animate(i / 8);
    const elapsed = performance.now() - prepared;
    expect(frame.pixels).toBe(identity);
    expect(frame.pixels.length).toBe(640 * 480 * 4);
    console.info(`Ocean: create ${(created - start).toFixed(1)}ms; prepare 307,200 points `
      + `${(prepared - created).toFixed(1)}ms; animate ${(elapsed / 24).toFixed(2)}ms/frame.`);
  });
});
