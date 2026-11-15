import { PATCH_SIZE } from './generation';
import type { CanopyPoint } from './canopy';

export type PatchLayout = 'spaced' | 'stacked';
export interface CanopyOffset { x: number; y: number }

export function stackedCanopyOffsets(shapes: readonly (readonly CanopyPoint[])[], seed: number): CanopyOffset[] {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Invalid canopy layout seed.');
  if (shapes.some(shape => !shape.length || shape.some(p => !Number.isInteger(p.x) || !Number.isInteger(p.y)))) {
    throw new Error('Canopy layout needs populated pixel silhouettes.');
  }
  const offsets = shapes.map(() => ({ x: 0, y: 0 }));
  if (shapes.length < 2) return offsets;
  const { width, height } = PATCH_SIZE;
  const outlines = shapes.map((shape, owner) => {
    const xs = shape.map(p => p.x), ys = shape.map(p => p.y);
    const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
    const mask = new Set(shape.map(p => p.y * width + p.x));
    return { owner, left, right, top, bottom, cx: (left + right) / 2,
      mask, warm: shape.filter(p => p.region === 3).map(p => p.y * width + p.x) };
  }).sort((a, b) => b.bottom - b.top - (a.bottom - a.top) || b.mask.size - a.mask.size);
  const occupied = new Uint8Array(width * height);
  const placed: { mask: number[]; warm: number[]; covered: Set<number>; depth: number }[] = [];
  const side = seed % 2 ? 1 : -1;
  const backDepth = Math.max(172, 100 + outlines[0].bottom - outlines[0].top);
  for (let rank = 0; rank < outlines.length; rank++) {
    const shape = outlines[rank];
    const targetX = 142 + (rank === 0 ? 0 : rank % 2 ? side * 23 : -side * 19);
    const targetDepth = backDepth + rank * 8;
    let best: CanopyOffset | undefined, bestScore = Infinity;
    if (!rank) best = { x: Math.round(targetX - shape.cx), y: targetDepth - shape.bottom };
    else {
      const overlapBase = Math.min(shape.mask.size, Math.max(...placed.map(p => p.mask.length)));
      const minDepth = Math.max(targetDepth - 10, placed[placed.length - 1].depth + 3);
      for (const radius of [42, 96]) {
        if (best) break;
        const maxDepth = Math.min(radius === 42 ? targetDepth + 10 : 236, 236 - (outlines.length - rank - 1) * 3);
        for (let depth = minDepth; depth <= maxDepth; depth += 3) for (let cx = targetX - radius; cx <= targetX + radius; cx += 3) {
          const x = Math.round(cx - shape.cx), y = depth - shape.bottom, shift = y * width + x;
          if (shape.left + x < 24 || shape.right + x > 266 || shape.top + y < 100 || shape.bottom + y > 236) continue;
          let overlap = 0;
          for (const pixel of shape.mask) overlap += occupied[pixel + shift];
          if (overlap < overlapBase * 0.12 || overlap > overlapBase * 0.55) continue;
          const hidesTooMuch = placed.some(p => {
            let covered = p.covered.size;
            for (const pixel of p.mask) if (!p.covered.has(pixel) && shape.mask.has(pixel - shift)) covered++;
            return covered > p.mask.length * 0.55
              || p.warm.filter(pixel => p.covered.has(pixel) || shape.mask.has(pixel - shift)).length > p.warm.length * 0.35;
          });
          if (hidesTooMuch) continue;
          const score = Math.hypot(shape.cx + x - targetX, depth - targetDepth)
            + Math.abs(overlap / overlapBase - 0.24) * 60;
          if (score < bestScore) { best = { x, y }; bestScore = score; }
        }
      }
    }
    if (!best || shape.left + best.x < 24 || shape.right + best.x > 266
      || shape.top + best.y < 100 || shape.bottom + best.y > 236) {
      throw new Error('Could not stack these canopies. Try another seed or the Spaced arrangement.');
    }
    const shift = best.y * width + best.x, mask = [...shape.mask].map(pixel => pixel + shift);
    for (const p of placed) for (const pixel of p.mask) if (shape.mask.has(pixel - shift)) p.covered.add(pixel);
    for (const pixel of mask) occupied[pixel] = 1;
    placed.push({ mask, warm: shape.warm.map(pixel => pixel + shift), covered: new Set(), depth: shape.bottom + best.y });
    offsets[shape.owner] = best;
  }
  return offsets;
}
