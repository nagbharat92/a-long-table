import type { LandTriangle, LandVertex } from '../core/landform-study';

type Axis = 'x' | 'y' | 'z';
const axes: readonly Axis[] = ['x', 'y', 'z'];
interface Node {
  min: LandVertex;
  max: LandVertex;
  triangles?: readonly LandTriangle[];
  children?: readonly [Node, Node];
}

/** Lazy callers can reserve exact visibility for small, curved receiver patches. */
export function createTriangleRayQuery(triangles: readonly LandTriangle[]): (origin: LandVertex, direction: LandVertex) => boolean {
  function build(items: readonly LandTriangle[]): Node {
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const triangle of items) for (const point of triangle.vertices) {
      if (![point.x, point.y, point.z].every(Number.isFinite)) throw new RangeError('Triangle ray geometry must be finite.');
      for (const axis of axes) {
        min[axis] = Math.min(min[axis], point[axis]);
        max[axis] = Math.max(max[axis], point[axis]);
      }
    }
    if (items.length <= 8) return { min, max, triangles: items };
    const axis = axes.reduce((a, b) => max[a] - min[a] >= max[b] - min[b] ? a : b);
    const sorted = [...items].sort((a, b) =>
      a.vertices.reduce((sum, p) => sum + p[axis], 0) - b.vertices.reduce((sum, p) => sum + p[axis], 0));
    const middle = Math.floor(sorted.length / 2);
    return { min, max, children: [build(sorted.slice(0, middle)), build(sorted.slice(middle))] };
  }
  const root = triangles.length ? build(triangles) : undefined;
  function intersects(triangle: LandTriangle, p: LandVertex, d: LandVertex): boolean {
    const [a, b, c] = triangle.vertices;
    const ex = b.x - a.x, ey = b.y - a.y, ez = b.z - a.z;
    const fx = c.x - a.x, fy = c.y - a.y, fz = c.z - a.z;
    const hx = d.y * fz - d.z * fy, hy = d.z * fx - d.x * fz, hz = d.x * fy - d.y * fx;
    const determinant = ex * hx + ey * hy + ez * hz;
    if (Math.abs(determinant) < 1e-10) return false;
    const sx = p.x - a.x, sy = p.y - a.y, sz = p.z - a.z;
    const u = (sx * hx + sy * hy + sz * hz) / determinant;
    if (u < -1e-8 || u > 1 + 1e-8) return false;
    const qx = sy * ez - sz * ey, qy = sz * ex - sx * ez, qz = sx * ey - sy * ex;
    const v = (d.x * qx + d.y * qy + d.z * qz) / determinant;
    return v >= -1e-8 && u + v <= 1 + 1e-8 && (fx * qx + fy * qy + fz * qz) / determinant > 1e-5;
  }
  function visit(node: Node, origin: LandVertex, direction: LandVertex): boolean {
    let near = 1e-5, far = Infinity;
    for (const axis of axes) {
      if (Math.abs(direction[axis]) < 1e-12) {
        if (origin[axis] < node.min[axis] - 1e-8 || origin[axis] > node.max[axis] + 1e-8) return false;
      } else {
        const a = (node.min[axis] - origin[axis]) / direction[axis];
        const b = (node.max[axis] - origin[axis]) / direction[axis];
        near = Math.max(near, Math.min(a, b));
        far = Math.min(far, Math.max(a, b));
        if (far < near - 1e-8) return false;
      }
    }
    return node.triangles ? node.triangles.some(triangle => intersects(triangle, origin, direction))
      : !!node.children?.some(child => visit(child, origin, direction));
  }
  return (origin, direction) => {
    const length = Math.hypot(direction.x, direction.y, direction.z);
    if (![origin.x, origin.y, origin.z, direction.x, direction.y, direction.z].every(Number.isFinite)
      || length < 1e-10) {
      throw new RangeError('Triangle rays require finite coordinates and a nonzero direction.');
    }
    return root ? visit(root, origin, { x: direction.x / length, y: direction.y / length, z: direction.z / length }) : false;
  };
}
