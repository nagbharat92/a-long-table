import type { Rectangle } from './contracts';
import { islandColumnTriangles, type IslandSurfacePolygon } from './island-columns';
import { optimizeLandformMesh } from './landform-mesh';
import type { LandTriangle } from './landform-study';

export interface SteppedLandformSample {
  level: number;
  anchored: boolean;
}

export interface SteppedLandformCell extends SteppedLandformSample {
  x: number;
  y: number;
  component: number;
}

export interface SteppedLandform {
  cellSize: number;
  cells: SteppedLandformCell[];
  components: { anchored: boolean; cellCount: number }[];
  triangles: LandTriangle[];
  sourceTriangleCount: number;
}

export interface SteppedLandformOptions {
  /** Bounds in integer grid cells; samples receive world-space cell centers. */
  bounds: Rectangle;
  cellSize: number;
  heights: readonly number[];
  floor: number;
  minFragmentCells: number;
  maxFragmentCells: number;
  sample(x: number, y: number): SteppedLandformSample | undefined;
}

/** Shared flat cell tops, for standalone volumes or patches joined into existing terrain. */
export function steppedLandformSurfaces(
  cells: readonly { x: number; y: number; level: number }[], cellSize: number, heights: readonly number[],
): IslandSurfacePolygon[] {
  if (!Number.isFinite(cellSize) || cellSize <= 0 || !heights.length || heights.some(z => !Number.isFinite(z))) {
    throw new RangeError('Stepped surfaces require a positive cell size and finite heights.');
  }
  return cells.map(cell => {
    if (!Number.isSafeInteger(cell.x) || !Number.isSafeInteger(cell.y)
      || !Number.isInteger(cell.level) || cell.level < 0 || cell.level >= heights.length) {
      throw new RangeError('Stepped surface cells require integer coordinates and valid height levels.');
    }
    const x = cell.x * cellSize, y = cell.y * cellSize, z = heights[cell.level];
    return { level: cell.level, vertices: [
      { x, y, z }, { x: x + cellSize, y, z },
      { x: x + cellSize, y: y + cellSize, z }, { x, y: y + cellSize, z },
    ] };
  });
}

/** Surface patches retain occupancy; standalone volumes may also remove diagonal-only cells. */
export function resolveSteppedLandformContacts(
  samples: (SteppedLandformSample | undefined)[], width: number, height: number, heightCount: number,
  preserveFootprint = false,
): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
    || samples.length !== width * height || !Number.isInteger(heightCount) || heightCount < 1) {
    throw new RangeError('Stepped contacts require a valid sample grid and height count.');
  }
  // Diagonal-only contacts create four walls sharing one edge, not a solid manifold.
  const pending: number[] = [];
  const queued = new Uint8Array(samples.length);
  function enqueue(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) return;
    const index = y * width + x;
    if (!queued[index]) { queued[index] = 1; pending.push(index); }
  }
  for (let y = 0; y < height - 1; y++) for (let x = 0; x < width - 1; x++) enqueue(x, y);
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const index = pending[cursor];
    queued[index] = 0;
    const corners = [index, index + 1, index + width + 1, index + width];
    for (let level = 0; level < heightCount - Number(preserveFootprint); level++) {
      const bits = corners.reduce((mask, i, corner) =>
        mask | (samples[i] && samples[i]!.level <= level ? 1 << corner : 0), 0);
      if (bits !== 5 && bits !== 10) continue;
      const candidates = corners.filter((i, corner) => (bits & (1 << corner)) && !samples[i]!.anchored);
      let changed: number;
      if (candidates.length) {
        changed = candidates.reduce((a, b) => samples[a]!.level >= samples[b]!.level ? a : b);
        samples[changed] = level + 1 < heightCount ? { level: level + 1, anchored: false } : undefined;
      } else {
        const lower = preserveFootprint ? corners.filter(i => samples[i] && !samples[i]!.anchored && samples[i]!.level > level) : [];
        if (!lower.length) throw new Error('Stepped landform anchors cannot meet only along a diagonal edge.');
        changed = lower[0];
        samples[changed] = { level, anchored: false };
      }
      const x = changed % width, y = Math.floor(changed / width);
      for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) enqueue(x + dx, y + dy);
      break;
    }
  }
}

/** Field rules choose occupancy and levels; this builder owns topology and solid meshing. */
export function createSteppedLandform(options: SteppedLandformOptions): SteppedLandform {
  const { bounds, cellSize, heights, floor, minFragmentCells, maxFragmentCells, sample } = options;
  if (!Object.values(bounds).every(Number.isSafeInteger) || bounds.width <= 0 || bounds.height <= 0
    || bounds.width * bounds.height > 1000000
    || !Number.isFinite(cellSize) || cellSize <= 0 || !Number.isFinite(floor)
    || !heights.length || heights.some((z, i) => !Number.isFinite(z) || z <= floor || (i > 0 && z >= heights[i - 1]))
    || !Number.isSafeInteger(minFragmentCells) || minFragmentCells < 1
    || !Number.isSafeInteger(maxFragmentCells) || maxFragmentCells < minFragmentCells) {
    throw new RangeError('Stepped landforms require bounded integer grids, descending heights above their floor and valid fragment limits.');
  }
  const { width, height } = bounds;
  const samples: (SteppedLandformSample | undefined)[] = new Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = sample((bounds.x + x + 0.5) * cellSize, (bounds.y + y + 0.5) * cellSize);
    if (value && (!Number.isInteger(value.level) || value.level < 0 || value.level >= heights.length
      || typeof value.anchored !== 'boolean')) {
      throw new RangeError('Stepped landform samples require a valid height level and an explicit anchor flag.');
    }
    samples[y * width + x] = value && { ...value };
  }
  resolveSteppedLandformContacts(samples, width, height, heights.length);
  const visited = new Uint8Array(samples.length);
  const cells: SteppedLandformCell[] = [];
  const components: SteppedLandform['components'] = [];
  for (let first = 0; first < samples.length; first++) {
    if (visited[first] || !samples[first]) continue;
    const queue = [first];
    visited[first] = 1;
    let anchored = false;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor], x = index % width, y = Math.floor(index / width);
      anchored ||= samples[index]!.anchored;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        const next = ny * width + nx;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || visited[next] || !samples[next]) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }
    if (!anchored && (queue.length < minFragmentCells || queue.length > maxFragmentCells)) continue;
    const component = components.length;
    components.push({ anchored, cellCount: queue.length });
    for (const index of queue) cells.push({
      ...samples[index]!, x: bounds.x + index % width, y: bounds.y + Math.floor(index / width), component,
    });
  }
  const surfaces = steppedLandformSurfaces(cells, cellSize, heights);
  const triangles = islandColumnTriangles(surfaces, floor);
  // Close the undersides too: these are volumes, not double-sided surface sheets.
  for (const surface of surfaces) {
    const [a, b, c, d] = surface.vertices.map(p => ({ ...p, z: floor }));
    triangles.push(
      { vertices: [a, c, b], plane: 'dark', level: 0, wallTop: floor, wallBottom: floor },
      { vertices: [a, d, c], plane: 'dark', level: 0, wallTop: floor, wallBottom: floor },
    );
  }
  return {
    cellSize, cells, components,
    triangles: optimizeLandformMesh(triangles), sourceTriangleCount: triangles.length,
  };
}
