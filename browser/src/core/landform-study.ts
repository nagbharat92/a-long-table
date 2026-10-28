export interface LandPoint { x: number; y: number }
export interface LandVertex extends LandPoint { z: number }
export type LandProjection = 'current' | 'oblique' | 'plan';
export type LandPlane = 'top' | 'light' | 'middle' | 'dark';
export interface LandMass {
  id: string;
  floor: number;
  height: number;
  boundary: readonly LandPoint[];
}
export interface LandTriangle {
  vertices: readonly [LandVertex, LandVertex, LandVertex];
  plane: LandPlane;
  level: number;
}

function boundary(points: readonly (readonly [number, number])[]): readonly LandPoint[] {
  return points.map(([x, y]) => ({ x, y }));
}

export const LANDFORM_FIXTURE: readonly LandMass[] = [
  {
    id: 'low-base', floor: -4, height: 0,
    boundary: boundary([
      [-84, -44], [-60, -62], [-16, -65], [20, -58], [48, -45],
      [66, -20], [72, 8], [63, 28], [55, 30], [48, 24],
      [41, 36], [48, 49], [12, 61], [-14, 57], [-32, 45],
      [-57, 48], [-78, 30], [-85, 6], [-77, -15],
    ]),
  },
  {
    id: 'middle-shelf', floor: 0, height: 20,
    boundary: boundary([
      [-64, -40], [-36, -57], [-2, -55], [25, -41], [32, -23],
      [50, -16], [56, 4], [40, 24], [13, 28], [1, 14],
      [-20, 18], [-30, 8], [-54, 12], [-66, -5],
    ]),
  },
  {
    id: 'high-shoulder', floor: 20, height: 48,
    boundary: boundary([
      [-60, -32], [-41, -43], [-13, -40], [2, -24], [0, -5],
      [-12, 5], [-33, -1], [-46, 10], [-60, -2],
    ]),
  },
];

export const ASCENT_RESERVATION = boundary([[26, 42], [36, 23], [38, -5], [22, -23], [2, -28]]);
export const RABBIT_WORLD_HEIGHT = 12;
export const RABBIT_WORLD_FOOTPRINT = 4.7;
export const SCALE_PLACEMENTS: readonly LandVertex[] = [
  { x: -42, y: 33, z: 0 },
  { x: 28, y: 13, z: 20 },
  { x: -31, y: -22, z: 48 },
];
export const OCCLUSION_PLACEMENT: LandVertex = { x: -36, y: -59, z: 0 };

function cross(a: LandPoint, b: LandPoint, c: LandPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

export function containsLandPoint(points: readonly LandPoint[], point: LandPoint): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j], b = points[i];
    if (Math.abs(cross(a, b, point)) < 1e-8
      && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x)
      && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y)) return true;
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function landHeightAt(point: LandPoint): number | undefined {
  for (let i = LANDFORM_FIXTURE.length - 1; i >= 0; i--) {
    if (containsLandPoint(LANDFORM_FIXTURE[i].boundary, point)) return LANDFORM_FIXTURE[i].height;
  }
  return undefined;
}

function triangulate(points: readonly LandPoint[]): [LandPoint, LandPoint, LandPoint][] {
  const remaining = [...points];
  const triangles: [LandPoint, LandPoint, LandPoint][] = [];
  while (remaining.length > 3) {
    let clipped = false;
    for (let i = 0; i < remaining.length; i++) {
      const a = remaining[(i + remaining.length - 1) % remaining.length];
      const b = remaining[i], c = remaining[(i + 1) % remaining.length];
      if (cross(a, b, c) <= 0) continue;
      if (remaining.some(p => p !== a && p !== b && p !== c
        && cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0)) continue;
      triangles.push([a, b, c]);
      remaining.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) throw new Error('The landform boundary could not be triangulated.');
  }
  triangles.push([remaining[0], remaining[1], remaining[2]]);
  return triangles;
}

export function landformTriangles(): LandTriangle[] {
  const triangles: LandTriangle[] = [];
  for (const [level, mass] of LANDFORM_FIXTURE.entries()) {
    const vertex = (p: LandPoint, z: number): LandVertex => ({ ...p, z });
    for (const points of triangulate(mass.boundary)) {
      triangles.push({
        vertices: [vertex(points[0], mass.height), vertex(points[1], mass.height), vertex(points[2], mass.height)],
        plane: 'top', level,
      });
    }
    for (let i = 0; i < mass.boundary.length; i++) {
      const a = mass.boundary[i], b = mass.boundary[(i + 1) % mass.boundary.length];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const light = ((b.y - a.y) * -0.8 - (b.x - a.x) * 0.6) / length;
      const plane = light > 0.25 ? 'light' : light < -0.25 ? 'dark' : 'middle';
      const upperA = vertex(a, mass.height), upperB = vertex(b, mass.height);
      const lowerA = vertex(a, mass.floor), lowerB = vertex(b, mass.floor);
      triangles.push(
        { vertices: [upperA, lowerA, lowerB], plane, level },
        { vertices: [upperA, lowerB, upperB], plane, level },
      );
    }
  }
  return triangles;
}

export function projectLandVertex(point: LandVertex, projection: LandProjection): LandVertex {
  if (projection === 'plan') return { x: point.x, y: point.y, z: point.z };
  if (projection === 'current') return { x: point.x, y: point.y - point.z, z: point.y + point.z };
  return {
    x: (point.x - point.y) * 0.85,
    y: (point.x + point.y) * 0.425 - point.z,
    z: (point.x + point.y) * 0.85 + point.z * 0.7225,
  };
}
