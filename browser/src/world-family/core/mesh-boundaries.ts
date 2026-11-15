import type { LandBoundarySegment, LandVertex } from './landform-study';

export function openMeshEdges<T extends LandBoundarySegment>(
  edges: readonly T[], epsilon = 1e-7,
): (LandBoundarySegment & { edge: T })[] {
  interface Edge {
    source: T;
    start: number;
    end: number;
    direction: number;
  }
  interface Event { position: number; starts: Edge[]; ends: Edge[] }
  interface Line { events: Event[]; slope: number; anchor: LandVertex; position: number }
  const key = (value: number) => Math.round(value / epsilon);
  const lines = new Map<string, Line[]>();
  for (const source of edges) {
    const { from: a, to: b } = source;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!Number.isFinite(length) || length <= epsilon) throw new Error('Surface boundaries require non-degenerate XY edges.');
    let tx = (b.x - a.x) / length, ty = (b.y - a.y) / length;
    if (tx < -epsilon || (Math.abs(tx) <= epsilon && ty < 0)) { tx = -tx; ty = -ty; }
    const start = tx * a.x + ty * a.y, end = tx * b.x + ty * b.y;
    const slope = (b.z - a.z) / (end - start);
    const id = [tx, ty, -ty * a.x + tx * a.y].map(key).join(',');
    let candidates = lines.get(id);
    if (!candidates) { candidates = []; lines.set(id, candidates); }
    // Compare heights directly: equivalent z-intercepts can straddle a rounding bin.
    let line = candidates.find(candidate => Math.abs(candidate.slope - slope) <= epsilon
      && Math.abs(candidate.anchor.z + candidate.slope * (start - candidate.position) - a.z) <= epsilon
      && Math.abs(candidate.anchor.z + candidate.slope * (end - candidate.position) - b.z) <= epsilon);
    if (!line) {
      line = { events: [], slope, anchor: a, position: start };
      candidates.push(line);
    }
    const edge = { source, start, end, direction: Math.sign(end - start) };
    line.events.push(
      { position: Math.min(start, end), starts: [edge], ends: [] },
      { position: Math.max(start, end), starts: [], ends: [edge] },
    );
  }
  function pointAt(edge: Edge, position: number): LandVertex {
    const { from, to } = edge.source;
    if (Math.abs(position - edge.start) <= epsilon) return from;
    if (Math.abs(position - edge.end) <= epsilon) return to;
    const t = (position - edge.start) / (edge.end - edge.start);
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: from.z + (to.z - from.z) * t };
  }
  const result: (LandBoundarySegment & { edge: T })[] = [];
  for (const { events } of [...lines.values()].flat()) {
    const sorted: Event[] = [];
    for (const event of events.sort((a, b) => a.position - b.position)) {
      const previous = sorted.at(-1);
      if (previous && event.position - previous.position <= epsilon) {
        previous.starts.push(...event.starts);
        previous.ends.push(...event.ends);
      } else sorted.push({ ...event, starts: [...event.starts], ends: [...event.ends] });
    }
    const active = new Set<Edge>();
    for (let i = 0; i < sorted.length - 1; i++) {
      const event = sorted[i], next = sorted[i + 1];
      for (const edge of event.ends) active.delete(edge);
      for (const edge of event.starts) active.add(edge);
      if (!active.size || next.position - event.position <= epsilon) continue;
      const [a, b] = active;
      if (active.size > 2 || (b && a.direction === b.direction)) throw new Error('Mesh surfaces overlap at a shared edge.');
      if (b) continue;
      result.push({
        edge: a.source,
        from: pointAt(a, a.direction > 0 ? event.position : next.position),
        to: pointAt(a, a.direction > 0 ? next.position : event.position),
      });
    }
  }
  return result;
}
