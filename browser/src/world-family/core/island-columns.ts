import type { LandPlane, LandPoint, LandTriangle, LandVertex } from './landform-study';

const EPSILON = 1e-7;
export interface IslandSurfacePolygon {
  vertices: LandVertex[];
  level: number;
  ascentId?: number;
  layer?: 'base' | 'uplands' | 'beaches';
}
const area = (points: readonly LandPoint[]) => points.reduce((sum, point, i) => {
  const next = points[(i + 1) % points.length];
  return sum + point.x * next.y - next.x * point.y;
}, 0) / 2;

function clean(points: LandPoint[]): LandPoint[] {
  const unique = points.filter((point, i) => {
    const previous = points[(i + points.length - 1) % points.length];
    return Math.hypot(point.x - previous.x, point.y - previous.y) > EPSILON;
  });
  if (unique.length < 3 || Math.abs(area(unique)) <= EPSILON) return [];
  return unique;
}

function halfPlane(subject: readonly LandPoint[], a: LandPoint, b: LandPoint, inside: boolean): LandPoint[] {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const distance = (point: LandPoint) => {
    const value = ((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)) / length;
    return Math.abs(value) <= EPSILON ? 0 : value;
  };
  const result: LandPoint[] = [];
  for (let i = 0; i < subject.length; i++) {
    const from = subject[i], to = subject[(i + 1) % subject.length];
    const da = distance(from), db = distance(to);
    const keepA = inside ? da >= 0 : da <= 0, keepB = inside ? db >= 0 : db <= 0;
    if (keepA) result.push(from);
    if (keepA !== keepB) {
      const t = da / (da - db);
      result.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
    }
  }
  return clean(result);
}

export function intersectIslandPolygon(subject: readonly LandPoint[], clip: readonly LandPoint[]): LandPoint[] {
  let result = [...subject];
  for (let i = 0; i < clip.length && result.length; i++) result = halfPlane(result, clip[i], clip[(i + 1) % clip.length], true);
  return result;
}

export function subtractIslandPolygon(subject: readonly LandPoint[], clip: readonly LandPoint[]): LandPoint[][] {
  const result: LandPoint[][] = [];
  let remaining = [...subject];
  for (let i = 0; i < clip.length && remaining.length; i++) {
    const outside = halfPlane(remaining, clip[i], clip[(i + 1) % clip.length], false);
    if (outside.length) result.push(outside);
    remaining = halfPlane(remaining, clip[i], clip[(i + 1) % clip.length], true);
  }
  return result;
}

interface Edge {
  a: LandVertex;
  b: LandVertex;
  start: number;
  end: number;
  direction: number;
  surface: IslandSurfacePolygon;
}
interface Event { position: number; starts: Edge[]; ends: Edge[] }

export function islandColumnTriangles(surfaces: readonly IslandSurfacePolygon[], floor = -4): LandTriangle[] {
  const triangles: LandTriangle[] = [];
  const lines = new Map<string, Map<number, Event>>();
  const key = (value: number) => Math.round(value / EPSILON);
  function triangle(a: LandVertex, b: LandVertex, c: LandVertex, plane: LandPlane, surface: IslandSurfacePolygon, wallTop?: number, wallBottom?: number): void {
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) <= EPSILON) return;
    triangles.push({
      vertices: [a, b, c], plane, level: surface.level,
      ...(surface.ascentId === undefined ? {} : { ascentId: surface.ascentId }),
      ...(surface.layer === undefined ? {} : { layer: surface.layer }),
      ...(wallTop === undefined ? {} : { wallTop }),
      ...(wallBottom === undefined ? {} : { wallBottom }),
    });
  }
  for (const surface of surfaces) {
    const { vertices } = surface;
    if (vertices.length < 3 || area(vertices) <= EPSILON) throw new Error('Island surface polygons must have positive area and outward winding.');
    for (let i = 1; i < vertices.length - 1; i++) triangle(vertices[0], vertices[i], vertices[i + 1], 'top', surface);
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i], b = vertices[(i + 1) % vertices.length];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length <= EPSILON) continue;
      let tx = (b.x - a.x) / length, ty = (b.y - a.y) / length;
      if (tx < -EPSILON || (Math.abs(tx) <= EPSILON && ty < 0)) { tx = -tx; ty = -ty; }
      const start = tx * a.x + ty * a.y, end = tx * b.x + ty * b.y;
      const edge: Edge = { a, b, start, end, direction: Math.sign(end - start), surface };
      const id = `${key(tx)},${key(ty)},${key(-ty * a.x + tx * a.y)}`;
      let events = lines.get(id);
      if (!events) { events = new Map(); lines.set(id, events); }
      for (const [position, enter] of [[Math.min(start, end), true], [Math.max(start, end), false]] as const) {
        const index = key(position);
        let event = events.get(index);
        if (!event) { event = { position, starts: [], ends: [] }; events.set(index, event); }
        (enter ? event.starts : event.ends).push(edge);
      }
    }
  }
  function pointAt(edge: Edge, position: number): LandVertex {
    const t = (position - edge.start) / (edge.end - edge.start);
    return {
      x: edge.a.x + (edge.b.x - edge.a.x) * t,
      y: edge.a.y + (edge.b.y - edge.a.y) * t,
      z: edge.a.z + (edge.b.z - edge.a.z) * t,
    };
  }
  function wall(owner: Edge, neighbor: Edge | undefined, from: number, to: number): void {
    const a = pointAt(owner, owner.direction > 0 ? from : to);
    const b = pointAt(owner, owner.direction > 0 ? to : from);
    const lowerA = { ...a, z: neighbor ? pointAt(neighbor, owner.direction > 0 ? from : to).z : floor };
    const lowerB = { ...b, z: neighbor ? pointAt(neighbor, owner.direction > 0 ? to : from).z : floor };
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const light = (b.y - a.y) / length * 0.6 - (b.x - a.x) / length * 0.8;
    const plane: LandPlane = light < -0.25 ? 'light' : light > 0.25 ? 'dark' : 'middle';
    const top = Math.max(a.z, b.z);
    const bottom = Math.min(lowerA.z, lowerB.z);
    triangle(a, lowerA, lowerB, plane, owner.surface, top, bottom);
    triangle(a, lowerB, b, plane, owner.surface, top, bottom);
  }
  for (const events of lines.values()) {
    const sorted = [...events.values()].sort((a, b) => a.position - b.position);
    const active = new Set<Edge>();
    for (let i = 0; i < sorted.length - 1; i++) {
      const event = sorted[i], next = sorted[i + 1];
      for (const edge of event.ends) active.delete(edge);
      for (const edge of event.starts) active.add(edge);
      if (!active.size || next.position - event.position <= EPSILON) continue;
      if (active.size > 2) throw new Error('Island surface columns overlap at an edge.');
      const [a, b] = [...active];
      if (!b) { wall(a, undefined, event.position, next.position); continue; }
      if (a.direction === b.direction) throw new Error('Island surface columns overlap on the same side of an edge.');
      const da = pointAt(a, event.position).z - pointAt(b, event.position).z;
      const db = pointAt(a, next.position).z - pointAt(b, next.position).z;
      if (Math.abs(da) <= EPSILON && Math.abs(db) <= EPSILON) continue;
      if (da * db < -EPSILON * EPSILON) {
        const join = event.position + (next.position - event.position) * da / (da - db);
        wall(da > 0 ? a : b, da > 0 ? b : a, event.position, join);
        wall(db > 0 ? a : b, db > 0 ? b : a, join, next.position);
      } else {
        const owner = da + db > 0 ? a : b;
        wall(owner, owner === a ? b : a, event.position, next.position);
      }
    }
  }
  return triangles;
}
