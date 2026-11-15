import { describe, expect, it, vi } from 'vitest';
import { bushPixels, generateBushPatch, MOUND_BASE, type BushPatch } from '../src/bush-patch/generation';
import * as random from '../src/foliage-family/core/random';

const STRIDE = 512;
function visible(patch: BushPatch, cluster: number): Set<number> {
  const pixels = new Set<number>();
  for (const bush of patch.bushes.filter(bush => bush.cluster === cluster)) {
    bushPixels(bush).forEach((row, y) => row.forEach((tone, x) => {
      if (tone) pixels.add((y + bush.y - MOUND_BASE) * STRIDE + x + bush.x - 30);
    }));
  }
  return pixels;
}

function footprint(pixels: Set<number>) {
  const points = [...pixels].map(pixel => [pixel % STRIDE, Math.floor(pixel / STRIDE)]);
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const cx = mean(points.map(p => p[0])), cy = mean(points.map(p => p[1]));
  const xx = mean(points.map(p => (p[0] - cx) ** 2)), yy = mean(points.map(p => (p[1] - cy) ** 2));
  const xy = mean(points.map(p => (p[0] - cx) * (p[1] - cy)));
  const angle = Math.atan2(2 * xy, xx - yy) / 2, c = Math.cos(angle), s = Math.sin(angle);
  const spread = Math.hypot(xx - yy, 2 * xy);
  const aspect = Math.sqrt((xx + yy + spread) / (xx + yy - spread));
  const rotated = points.map(p => [(p[0] - cx) * c + (p[1] - cy) * s, -(p[0] - cx) * s + (p[1] - cy) * c]);
  const left = Math.min(...rotated.map(p => p[0])), right = Math.max(...rotated.map(p => p[0]));
  const bins = Array.from({ length: 12 }, (_, i) => rotated.filter(p => Math.min(11,
    Math.floor((p[0] - left) / (right - left) * 12)) === i).map(p => p[1]));
  const widths = bins.map(bin => Math.max(...bin) - Math.min(...bin) + 1);
  const centers = bins.map(mean);
  const bend = Math.abs(mean(centers.slice(5, 7)) - (mean(centers.slice(2, 4)) + mean(centers.slice(8, 10))) / 2);
  const ends = [mean(widths.slice(2, 4)), mean(widths.slice(8, 10))];
  const taper = Math.max(...ends) / Math.min(...ends);
  return { cx, cy, angle, aspect, bend, taper, length: right - left, widths,
    thickness: Math.sqrt((xx + yy - spread) / 2) };
}

function localWidth(pixels: Set<number>, x: number, y: number): number {
  let best = 0;
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const center = Math.round(y - 8 + dy) * STRIDE + Math.round(x + dx);
    let radius = 0, whole = pixels.has(center);
    while (whole && radius < 20) {
      radius++;
      for (let offset = -radius; offset <= radius && whole; offset++) {
        whole = pixels.has(center - radius * STRIDE + offset) && pixels.has(center + radius * STRIDE + offset)
          && pixels.has(center + offset * STRIDE - radius) && pixels.has(center + offset * STRIDE + radius);
      }
    }
    best = Math.max(best, radius - 1);
  }
  return best;
}

function connectedFraction(pixels: Set<number>): number {
  const remaining = new Set(pixels);
  let largest = 0;
  while (remaining.size) {
    const pending = [remaining.values().next().value!];
    remaining.delete(pending[0]);
    let size = 0;
    while (pending.length) {
      const pixel = pending.pop()!;
      size++;
      for (const offset of [-STRIDE, -1, 1, STRIDE]) {
        if (remaining.delete(pixel + offset)) pending.push(pixel + offset);
      }
    }
    largest = Math.max(largest, size);
  }
  return largest / pixels.size;
}

// Empty enclosed pixels measure interior holes without treating a curved strip's outside as a hole.
function holeFraction(pixels: Set<number>): number {
  const xs = [...pixels].map(p => p % STRIDE), ys = [...pixels].map(p => Math.floor(p / STRIDE));
  const left = Math.min(...xs) - 1, right = Math.max(...xs) + 1;
  const back = Math.min(...ys) - 1, front = Math.max(...ys) + 1;
  const outside = new Set<number>(), pending = [back * STRIDE + left];
  outside.add(pending[0]);
  while (pending.length) {
    const pixel = pending.pop()!;
    for (const offset of [-STRIDE, -1, 1, STRIDE]) {
      const next = pixel + offset, x = next % STRIDE, y = Math.floor(next / STRIDE);
      if (x < left || x > right || y < back || y > front || pixels.has(next) || outside.has(next)) continue;
      outside.add(next); pending.push(next);
    }
  }
  return ((right - left + 1) * (front - back + 1) - outside.size - pixels.size) / pixels.size;
}

describe('independently shaped bush clusters', () => {
  it('terminates pathological repeated proposals with a recoverable exhaustion error', () => {
    let calls = 0;
    const repeated = () => {
      if (++calls > 1_000_000) throw new Error('Fixture exceeded RNG call limit.');
      return 0;
    };
    const spy = vi.spyOn(random, 'seededRandom').mockReturnValue(repeated);
    try {
      expect(() => generateBushPatch(9)).toThrow('Bush patch generation failed. Try another seed.');
      expect(calls).toBeLessThan(1_000_000);
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps whole, densely connected visible interiors and true 2D gaps across 300 seeds', () => {
    for (let seed = 0; seed < 300; seed++) {
      const patch = generateBushPatch(seed);
      expect(patch.clusters.length).toBeGreaterThanOrEqual(2);
      expect(patch.clusters.length).toBeLessThanOrEqual(3);
      expect(patch.bushes.length).toBeLessThanOrEqual(100);
      expect(patch.footprint).toEqual(patch.clusters.flat());
      expect(patch.clusterForms.some(form => form === 'Compact' || form === 'Broken')).toBe(true);
      expect(patch.clusterForms.some(form => form === 'Elongated' || form === 'Winding')).toBe(true);
      const masks = patch.clusters.map((_, cluster) => {
        const members = patch.bushes.filter(bush => bush.cluster === cluster);
        expect(members.length, `seed ${seed}, cluster ${cluster}`).toBeGreaterThan(15);
        expect(patch.clusters[cluster].length).toBeGreaterThanOrEqual(3);
        for (const bush of members) {
          expect(bush.x).toBeGreaterThanOrEqual(28); expect(bush.x).toBeLessThanOrEqual(256);
          expect(bush.y).toBeGreaterThanOrEqual(132); expect(bush.y).toBeLessThanOrEqual(214);
        }
        const mask = visible(patch, cluster);
        expect(connectedFraction(mask), `seed ${seed}, cluster ${cluster}: detached fringe`).toBeGreaterThan(0.99);
        expect(holeFraction(mask), `seed ${seed}, cluster ${cluster}: interior holes`).toBeLessThan(0.035);
        // Every footprint lobe must be populated, including the tips and narrow joins of long groups.
        for (const lobe of patch.clusters[cluster]) {
          expect(members.some(bush => Math.hypot(bush.x - lobe.x, bush.y - lobe.y) < lobe.rx + 3),
            `seed ${seed}, cluster ${cluster}: populated lobe`).toBe(true);
        }
        return mask;
      });
      for (let i = 0; i < masks.length; i++) for (let j = i + 1; j < masks.length; j++) {
        for (const pixel of masks[i]) for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
          if (masks[j].has(pixel + dy * STRIDE + dx)) throw new Error(`seed ${seed}: touching canopies ${i}/${j}`);
        }
      }
    }
  }, 120_000);

  it('exhibits visible elongation, bends, taper and bulges, mixed sizes and non-row placements', () => {
    const counts = new Set<number>(), orientations = new Set<number>();
    let long = 0, compact = 0, curved = 0, tapered = 0, lobed = 0, mixed = 0, staggered = 0, triangles = 0;
    let minCount = Infinity, maxCount = 0, xOverlap = 0;
    for (let seed = 0; seed < 300; seed++) {
      const patch = generateBushPatch(seed);
      const shapes = patch.clusters.map((_, cluster) => {
        const mask = visible(patch, cluster), shape = footprint(mask);
        const count = patch.bushes.filter(bush => bush.cluster === cluster).length;
        counts.add(count); minCount = Math.min(minCount, count); maxCount = Math.max(maxCount, count);
        orientations.add(Math.floor((shape.angle + Math.PI / 2) / Math.PI * 8));
        if (shape.aspect > 2.8 && shape.length > 65) long++;
        if (shape.aspect < 1.5) compact++;
        if (patch.clusterForms[cluster] === 'Winding' && shape.bend > 4) curved++;
        if (patch.clusterForms[cluster] === 'Elongated' && shape.taper > 1.3) tapered++;
        let neckRatio = 0;
        if (patch.clusterForms[cluster] === 'Broken') {
          const lobes = patch.clusters[cluster];
          const widths = [0, 4, 9, 14, 18].map(index => localWidth(mask, lobes[index].x, lobes[index].y));
          neckRatio = (widths[0] + widths[2] + widths[4]) / 3 / Math.max(1, (widths[1] + widths[3]) / 2);
          if (neckRatio > 1.2) lobed++;
        }
        return { ...shape, count, neckRatio, xs: [...mask].map(pixel => pixel % STRIDE) };
      });
      expect(Math.max(...shapes.map(shape => shape.aspect)) - Math.min(...shapes.map(shape => shape.aspect)),
        `seed ${seed}: visibly distinct cluster proportions, not just different labels`).toBeGreaterThanOrEqual(0.6);
      expect(Math.min(...shapes.map(shape => shape.aspect)), `seed ${seed}: a genuinely broad group`).toBeLessThanOrEqual(1.7);
      expect(Math.max(...shapes.map(shape => shape.aspect)), `seed ${seed}: a genuinely long group`).toBeGreaterThanOrEqual(2.6);
      expect(Math.max(...shapes.map(shape => shape.thickness)) / Math.min(...shapes.map(shape => shape.thickness)),
        `seed ${seed}: not equally thin bands`).toBeGreaterThanOrEqual(1.3);
      if ([0, 9, 42].includes(seed)) console.info(`Representative seed ${seed}:`, shapes.map((shape, i) => ({
        form: patch.clusterForms[i], aspect: +shape.aspect.toFixed(2), thickness: +shape.thickness.toFixed(2),
        neckRatio: +shape.neckRatio.toFixed(2), count: shape.count,
      })));
      if (new Set(patch.clusterForms).size > 1 && Math.max(...shapes.map(s => s.aspect))
        - Math.min(...shapes.map(s => s.aspect)) > 0.6) mixed++;
      if (Math.max(...shapes.map(s => s.cy)) - Math.min(...shapes.map(s => s.cy)) > 20) staggered++;
      if (shapes.length === 3) {
        const [a, b, c] = shapes;
        if (Math.abs((b.cx - a.cx) * (c.cy - a.cy) - (b.cy - a.cy) * (c.cx - a.cx)) > 500) triangles++;
      }
      if (shapes.some((a, i) => shapes.some((b, j) => i < j &&
        Math.min(Math.max(...a.xs), Math.max(...b.xs)) - Math.max(Math.min(...a.xs), Math.min(...b.xs)) > 8))) xOverlap++;
    }
    const metrics = { long, compact, curved, tapered, lobed, mixed, staggered, triangles, xOverlap,
      distinctCounts: counts.size, minCount, maxCount, orientations: orientations.size };
    console.info('Rendered bush-cluster metrics (300 seeds):', metrics);
    expect(long, 'genuinely long rendered shapes').toBeGreaterThan(35);
    expect(compact).toBeGreaterThan(40);
    expect(curved, 'curvature survives unchanged crowns').toBeGreaterThan(20);
    expect(tapered, 'taper survives unchanged crowns').toBeGreaterThan(25);
    expect(lobed, 'bulges and narrow joins survive unchanged crowns').toBeGreaterThan(15);
    expect(mixed).toBe(300);
    expect(staggered).toBeGreaterThan(100);
    expect(triangles).toBeGreaterThan(25);
    expect(xOverlap, 'non-row groups can share their x projection while remaining separated').toBeGreaterThan(30);
    expect(counts.size).toBeGreaterThan(20);
    expect(maxCount / minCount).toBeGreaterThan(2);
    expect(orientations.size).toBe(8);
  }, 120_000);
});
