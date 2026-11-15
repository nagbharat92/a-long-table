import type { World } from '../core/contracts';
import type { LandTriangle, LandVertex } from '../core/landform-study';
import { BEACH_WASH_REACH, BEACH_WAVE_OFFSHORE, DEFAULT_BEACH_WAVE_END_SOFTNESS, beachWaveAt, validateBeachWaveEndSoftness } from './island-beach-wash';
import type { IslandShoreField } from './island-shore-field';

export const SHORE_MESH_STRIDE = 10;
const SPACING = 1;
const MAX_VERTICES = 1_500_000;

export interface IslandShoreMesh {
  /** XY, signed offshore distance, beach weight, phase, breakup, distance gradient XY, beach gradient XY. */
  vertices: Float32Array;
}

export interface ShoreMeshTriangle extends LandTriangle {
  shore: readonly [Float32Array, Float32Array, Float32Array];
}

/** A non-overlapping tessellated beach band avoids ribbon folds in concave coves. */
export function createIslandShoreMesh(world: World, shore: IslandShoreField): IslandShoreMesh {
  const width = world.width * world.tileSize, height = world.height * world.tileSize;
  if (![width, height].every(value => Number.isInteger(value) && value > 0 && value <= 2048)) {
    throw new RangeError('Shore meshes require world dimensions from 1 to 2048 units.');
  }
  const padding = BEACH_WAVE_OFFSHORE + SPACING;
  const columns = width + padding * 2 + 1;
  const vertices: number[] = [];
  let previous: (Float32Array | undefined)[] | undefined;
  for (let y = -padding; y <= height + padding; y += SPACING) {
    const row: (Float32Array | undefined)[] = [];
    for (let x = -padding; x <= width + padding; x += SPACING) {
      const distance = shore.distance(x, y);
      if (distance < -BEACH_WASH_REACH - SPACING * 2 || distance > BEACH_WAVE_OFFSHORE + SPACING * 2) {
        row.push(undefined);
      } else {
        const sample = shore.sample(x, y);
        row.push(new Float32Array([x, y, distance, sample.beachWeight, sample.phase, sample.breakup,
          shore.distance(x + 0.5, y) - shore.distance(x - 0.5, y),
          shore.distance(x, y + 0.5) - shore.distance(x, y - 0.5),
          shore.sample(x + 0.5, y).beachWeight - shore.sample(x - 0.5, y).beachWeight,
          shore.sample(x, y + 0.5).beachWeight - shore.sample(x, y - 0.5).beachWeight]));
      }
    }
    if (previous) for (let x = 0; x < columns - 1; x++) {
      const a = previous[x], b = previous[x + 1], c = row[x], d = row[x + 1];
      if (!a || !b || !c || !d) continue;
      for (const triangle of [[a, b, d], [a, d, c]]) {
        if (triangle.every(p => p[3] <= 0.6)
          || triangle.every(p => p[2] <= -BEACH_WASH_REACH)
          || triangle.every(p => p[2] >= BEACH_WAVE_OFFSHORE)) continue;
        if (vertices.length / SHORE_MESH_STRIDE + 3 > MAX_VERTICES) throw new RangeError('Shore mesh exceeds the 1,500,000-vertex budget.');
        for (const point of triangle) vertices.push(...point);
      }
    }
    previous = row;
  }
  return { vertices: new Float32Array(vertices) };
}

export function shoreMeshTriangles(
  mesh: IslandShoreMesh, seconds: number, endSoftness = DEFAULT_BEACH_WAVE_END_SOFTNESS,
): ShoreMeshTriangle[] {
  if (!Number.isFinite(seconds)) throw new RangeError('Shore mesh time must be finite.');
  validateBeachWaveEndSoftness(endSoftness);
  const result: ShoreMeshTriangle[] = [];
  for (let i = 0; i < mesh.vertices.length; i += SHORE_MESH_STRIDE * 3) {
    const a = mesh.vertices.subarray(i, i + SHORE_MESH_STRIDE);
    const b = mesh.vertices.subarray(i + SHORE_MESH_STRIDE, i + SHORE_MESH_STRIDE * 2);
    const c = mesh.vertices.subarray(i + SHORE_MESH_STRIDE * 2, i + SHORE_MESH_STRIDE * 3);
    const vertex = (p: Float32Array): LandVertex => ({
      x: p[0], y: p[1], z: beachWaveAt(p[2], p[4], p[3], seconds, endSoftness).height,
    });
    result.push({ vertices: [vertex(a), vertex(b), vertex(c)], shore: [a, b, c], plane: 'top', level: 0 });
  }
  return result;
}

export function shoreMeshSample(triangle: ShoreMeshTriangle, point: LandVertex): Float32Array {
  const [a, b, c] = triangle.shore;
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const v = ((point.x - a[0]) * (c[1] - a[1]) - (point.y - a[1]) * (c[0] - a[0])) / area;
  const w = ((b[0] - a[0]) * (point.y - a[1]) - (b[1] - a[1]) * (point.x - a[0])) / area;
  return Float32Array.from(a, (value, i) => value * (1 - v - w) + b[i] * v + c[i] * w);
}
