import earcut, { deviation } from 'earcut';
import type { LandPoint, LandTriangle, LandVertex } from './landform-study';
import { openMeshEdges } from './mesh-boundaries';

const EPSILON = 1e-7;
const key = (value: number) => Math.round(value / EPSILON);
const pointKey = (point: LandPoint) => `${key(point.x)},${key(point.y)}`;
interface Edge { from: LandPoint; to: LandPoint }
interface PlaneGroup {
  source: LandTriangle[];
  project(point: LandVertex): LandPoint;
  restore(point: LandPoint): LandVertex;
}

function planeGroup(triangle: LandTriangle): { id: string; group: PlaneGroup } {
  const [a, b, c] = triangle.vertices;
  const u = [b.x - a.x, b.y - a.y, b.z - a.z], v = [c.x - a.x, c.y - a.y, c.z - a.z];
  const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const length = Math.hypot(...normal);
  if (!Number.isFinite(length) || length <= EPSILON) throw new Error('Mesh optimization requires finite, non-degenerate triangles.');
  const [nx, ny, nz] = normal.map(value => value / length);
  const offset = nx * a.x + ny * a.y + nz * a.z;
  const axis = Math.abs(nx) > Math.abs(ny) && Math.abs(nx) > Math.abs(nz) ? 0
    : Math.abs(ny) > Math.abs(nz) ? 1 : 2;
  const sign = Math.sign([nx, ny, nz][axis]);
  // Cliff lip shading depends on the source wall's upper edge, not its new triangulation.
  const lip = triangle.plane === 'top' ? '' : key(triangle.wallTop ?? Math.max(...triangle.vertices.map(point => point.z)));
  const base = triangle.plane === 'top' ? '' : key(triangle.wallBottom ?? Math.min(...triangle.vertices.map(point => point.z)));
  return {
    id: `${triangle.plane}:${triangle.level}:${[nx, ny, nz, offset].map(key).join(',')}:${lip}:${base}:${triangle.ascentId ?? ''}:${Number(Boolean(triangle.submerged))}:${triangle.layer ?? ''}`,
    group: {
      source: [],
      project: point => axis === 0 ? { x: point.y, y: point.z * sign }
        : axis === 1 ? { x: point.z, y: point.x * sign } : { x: point.x, y: point.y * sign },
      restore: point => {
        if (axis === 0) {
          const y = point.x, z = point.y * sign;
          return { x: (offset - ny * y - nz * z) / nx, y, z };
        }
        if (axis === 1) {
          const z = point.x, x = point.y * sign;
          return { x, y: (offset - nx * x - nz * z) / ny, z };
        }
        const x = point.x, y = point.y * sign;
        return { x, y, z: (offset - nx * x - ny * y) / nz };
      },
    },
  };
}

function boundaryEdges(group: PlaneGroup): Edge[] {
  const edges: { from: LandVertex; to: LandVertex }[] = [];
  for (const triangle of group.source) {
    const points = triangle.vertices.map(point => ({ ...group.project(point), z: 0 }));
    for (let i = 0; i < 3; i++) {
      edges.push({ from: points[i], to: points[(i + 1) % 3] });
    }
  }
  return openMeshEdges(edges).map(({ from, to }) => ({ from, to }));
}

function signedArea(ring: readonly LandPoint[]): number {
  return ring.reduce((sum, point, i) => {
    const next = ring[(i + 1) % ring.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function boundaryRings(edges: Edge[]): LandPoint[][] {
  const outgoing = new Map<string, Edge[]>();
  for (const edge of edges) {
    const id = pointKey(edge.from), list = outgoing.get(id);
    if (list) list.push(edge);
    else outgoing.set(id, [edge]);
  }
  const visited = new Set<Edge>(), rings: LandPoint[][] = [];
  for (const first of edges) {
    if (visited.has(first)) continue;
    const ring: LandPoint[] = [];
    let edge = first;
    while (!visited.has(edge)) {
      visited.add(edge);
      ring.push(edge.from);
      if (pointKey(edge.to) === pointKey(first.from)) break;
      const candidates = (outgoing.get(pointKey(edge.to)) ?? []).filter(next => !visited.has(next));
      if (!candidates.length) throw new Error('Mesh boundary is not closed.');
      const dx = edge.to.x - edge.from.x, dy = edge.to.y - edge.from.y;
      const turn = (next: Edge) => Math.atan2(dx * (next.to.y - next.from.y) - dy * (next.to.x - next.from.x),
        dx * (next.to.x - next.from.x) + dy * (next.to.y - next.from.y));
      // Take the leftmost exit to keep regions that only touch at a corner separate.
      edge = candidates.reduce((best, next) => turn(next) > turn(best) ? next : best);
    }
    const corners = ring.filter((point, i) => {
      const before = ring[(i + ring.length - 1) % ring.length], after = ring[(i + 1) % ring.length];
      return Math.abs((point.x - before.x) * (after.y - point.y) - (point.y - before.y) * (after.x - point.x)) > EPSILON;
    });
    if (corners.length < 3 || Math.abs(signedArea(corners)) <= EPSILON) throw new Error('Mesh boundary has no surface area.');
    rings.push(corners);
  }
  return rings;
}

function contains(ring: readonly LandPoint[], point: LandPoint): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function triangulateGroup(group: PlaneGroup): LandTriangle[] {
  if (group.source.length === 1) return group.source;
  const rings = boundaryRings(boundaryEdges(group));
  const polygons = rings.filter(ring => signedArea(ring) > 0)
    .map(outer => ({ outer, holes: [] as LandPoint[][], area: signedArea(outer) }));
  for (const hole of rings.filter(ring => signedArea(ring) < 0)) {
    const [a, b] = hole, length = Math.hypot(b.x - a.x, b.y - a.y);
    const interior = { x: (a.x + b.x) / 2 + (b.y - a.y) / length * 1e-5,
      y: (a.y + b.y) / 2 - (b.x - a.x) / length * 1e-5 };
    const parent = polygons.filter(polygon => contains(polygon.outer, interior)).sort((a, b) => a.area - b.area)[0];
    if (!parent) throw new Error('Mesh hole has no containing surface.');
    parent.holes.push(hole);
  }
  const triangles: LandTriangle[] = [];
  for (const polygon of polygons) {
    const points = [...polygon.outer], holes: number[] = [];
    for (const hole of polygon.holes) { holes.push(points.length); points.push(...hole); }
    const coordinates = points.flatMap(point => [point.x, point.y]);
    const indices = earcut(coordinates, holes, 2);
    if (!indices.length || deviation(coordinates, holes, 2, indices) > 1e-8) throw new Error('Optimized mesh does not cover its source surface.');
    const vertices = points.map(group.restore);
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i];
      let b = indices[i + 1], c = indices[i + 2];
      if (signedArea([points[a], points[b], points[c]]) < 0) [b, c] = [c, b];
      const source = group.source[0];
      triangles.push({
        ...source, vertices: [vertices[a], vertices[b], vertices[c]],
        ...(source.plane === 'top' ? {} : {
          wallTop: source.wallTop ?? Math.max(...source.vertices.map(point => point.z)),
          wallBottom: source.wallBottom ?? Math.min(...source.vertices.map(point => point.z)),
        }),
      });
    }
  }
  return triangles;
}

export function optimizeLandformMesh(source: readonly LandTriangle[]): LandTriangle[] {
  const groups = new Map<string, PlaneGroup>();
  for (const triangle of source) {
    const { id, group } = planeGroup(triangle);
    const existing = groups.get(id);
    if (existing) existing.source.push(triangle);
    else { group.source.push(triangle); groups.set(id, group); }
  }
  return [...groups.values()].flatMap(triangulateGroup);
}
