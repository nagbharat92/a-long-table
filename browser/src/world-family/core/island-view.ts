import { projectLandVertex, type LandCamera, type LandProjection, type LandTriangle } from './landform-study';

export const ISLAND_TURN_DURATION = 480;
export const QUARTER_TURN = Math.PI / 2;
export const ISLAND_FRAME_PADDING = 24;

export function islandOrbitCenter(triangles: readonly LandTriangle[]) {
  if (!triangles.length) throw new Error('Island rotation requires terrain triangles.');
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const triangle of triangles) for (const point of triangle.vertices) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

export function islandViewFromParameters(parameters: URLSearchParams): number {
  const value = parameters.get('view') ?? '0';
  if (!/^[0-3]$/.test(value)) throw new Error('Island view must be a whole number from 0 to 3.');
  return Number(value);
}

export function islandTurnProgress(elapsed: number): number {
  if (!Number.isFinite(elapsed) || elapsed < 0) throw new RangeError('Island turn needs finite, non-negative elapsed time.');
  const t = Math.min(1, elapsed / ISLAND_TURN_DURATION);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function islandOrbitViewport(triangles: readonly LandTriangle[], projection: LandProjection, camera: LandCamera) {
  if (!triangles.length) throw new Error('Island framing requires terrain triangles.');
  const center = projectLandVertex({ ...camera.center, z: 0 }, projection);
  const horizontal = projection === 'oblique' ? Math.SQRT2 * 0.85 : 1;
  const vertical = projection === 'oblique' ? Math.SQRT2 * 0.425 : 1;
  let radius = 0, top = Infinity, bottom = -Infinity;
  for (const triangle of triangles) for (const point of triangle.vertices) {
    const r = Math.hypot(point.x - camera.center.x, point.y - camera.center.y);
    radius = Math.max(radius, r);
    const height = projection === 'plan' ? 0 : point.z;
    top = Math.min(top, center.y - r * vertical - height - 12);
    bottom = Math.max(bottom, center.y + r * vertical - height);
  }
  return {
    width: Math.ceil(radius * horizontal * 2 + ISLAND_FRAME_PADDING * 2),
    height: Math.ceil(bottom - top + ISLAND_FRAME_PADDING * 2),
    origin: { x: ISLAND_FRAME_PADDING - center.x + radius * horizontal, y: ISLAND_FRAME_PADDING - top },
  };
}
