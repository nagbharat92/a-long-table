import type { LandTriangle, LandVertex } from '../core/landform-study';

export interface SurfaceNormal { x: number; y: number; z: number }
export type ProjectionWeights = readonly [number, number, number];

/** Keep padded texture-atlas receivers on their face, not its extrapolated plane. */
export function closestSurfacePoint(triangle: LandTriangle, point: LandVertex): LandVertex {
  const [a, b, c] = triangle.vertices;
  const normal = surfaceNormal(triangle);
  const distance = (point.x - a.x) * normal.x + (point.y - a.y) * normal.y + (point.z - a.z) * normal.z;
  const projected = { x: point.x - normal.x * distance, y: point.y - normal.y * distance, z: point.z - normal.z * distance };
  let nearest = projected, best = Infinity, inside = true;
  for (const [start, end] of [[a, b], [b, c], [c, a]]) {
    const x = end.x - start.x, y = end.y - start.y, z = end.z - start.z;
    const px = projected.x - start.x, py = projected.y - start.y, pz = projected.z - start.z;
    if ((y * pz - z * py) * normal.x + (z * px - x * pz) * normal.y + (x * py - y * px) * normal.z < -1e-8) inside = false;
    const t = Math.max(0, Math.min(1, (px * x + py * y + pz * z) / (x * x + y * y + z * z)));
    const candidate = { x: start.x + t * x, y: start.y + t * y, z: start.z + t * z };
    const squared = (candidate.x - projected.x) ** 2 + (candidate.y - projected.y) ** 2 + (candidate.z - projected.z) ** 2;
    if (squared < best) { best = squared; nearest = candidate; }
  }
  return inside ? projected : nearest;
}

export function surfaceNormal(triangle: LandTriangle): SurfaceNormal {
  const [a, b, c] = triangle.vertices;
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
  const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
  const length = Math.hypot(x, y, z);
  if (!Number.isFinite(length) || length <= 1e-10) throw new Error('Surface projection requires a finite, non-degenerate triangle.');
  return { x: x / length, y: y / length, z: z / length };
}

export function projectionWeights(normal: SurfaceNormal): ProjectionWeights {
  const x = normal.x ** 4, y = normal.y ** 4, z = normal.z ** 4;
  const total = x + y + z;
  return [x / total, y / total, z / total];
}

export function sampleProjectedTexture(
  point: LandVertex, weights: ProjectionWeights,
  sample: (u: number, v: number) => readonly number[],
): readonly [number, number, number] {
  const a = weights[0] ? sample(point.y, point.z) : [0, 0, 0];
  const b = weights[1] ? sample(point.x, point.z) : [0, 0, 0];
  const c = weights[2] ? sample(point.x, point.y) : [0, 0, 0];
  return [
    a[0] * weights[0] + b[0] * weights[1] + c[0] * weights[2],
    a[1] * weights[0] + b[1] * weights[1] + c[1] * weights[2],
    a[2] * weights[0] + b[2] * weights[1] + c[2] * weights[2],
  ];
}
