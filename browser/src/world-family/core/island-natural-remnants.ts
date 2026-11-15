import type { Point, World } from './contracts';
import {
  ascentHeightAt, ascentSectionCoordinates, ascentSectionPolygon,
  type IslandAscent, type IslandAscentSection,
} from './island-ascents';
import { subtractAscentBank } from './island-ascent-banks';

interface Raster {
  width: number;
  height: number;
  quantum: number;
  before: Uint8Array;
  after: Uint8Array;
}

function raster(world: World, ascent: IslandAscent): Raster {
  const quantum = world.tileSize / 2, width = world.width * 2, height = world.height * 2;
  const before = new Uint8Array(width * height), after = new Uint8Array(before.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const source = Math.floor(y / 2) * world.width + Math.floor(x / 2);
    if (!world.cells[source] || world.elevations![source] < ascent.upperLevel) continue;
    const index = y * width + x;
    before[index] = after[index] = 1;
    const point = { x: (x + 0.5) * quantum, y: (y + 0.5) * quantum };
    if (point.x < ascent.bounds.x || point.x > ascent.bounds.x + ascent.bounds.width
      || point.y < ascent.bounds.y || point.y > ascent.bounds.y + ascent.bounds.height) continue;
    const height = ascentHeightAt(ascent, point);
    if (height !== undefined && height < ascent.upperHeight - 1e-8) after[index] = 0;
  }
  return { width, height, quantum, before, after };
}

function squareFilter(mask: Uint8Array, width: number, height: number, radius: number, all: boolean): Uint8Array {
  const stride = width + 1, sums = new Int32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += mask[y * width + x];
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + row;
    }
  }
  const result = new Uint8Array(mask.length), area = (radius * 2 + 1) ** 2;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const left = Math.max(0, x - radius), right = Math.min(width, x + radius + 1);
    const top = Math.max(0, y - radius), bottom = Math.min(height, y + radius + 1);
    const count = sums[bottom * stride + right] - sums[top * stride + right]
      - sums[bottom * stride + left] + sums[top * stride + left];
    result[y * width + x] = Number(all ? count === area : count > 0);
  }
  return result;
}

function components(mask: Uint8Array, width: number): { ids: Int32Array; groups: number[][] } {
  const ids = new Int32Array(mask.length).fill(-1), groups: number[][] = [];
  for (let first = 0; first < mask.length; first++) {
    if (!mask[first] || ids[first] >= 0) continue;
    const group = [first], id = groups.length;
    ids[first] = id;
    for (let cursor = 0; cursor < group.length; cursor++) {
      const index = group[cursor], x = index % width;
      for (const next of [x ? index - 1 : -1, x < width - 1 ? index + 1 : -1, index - width, index + width]) {
        if (next < 0 || next >= mask.length || !mask[next] || ids[next] >= 0) continue;
        ids[next] = id;
        group.push(next);
      }
    }
    groups.push(group);
  }
  return { ids, groups };
}

function planeHeight(ascent: IslandAscent, section: IslandAscentSection, point: Point): number {
  const along = ascentSectionCoordinates(ascent, section, point).x;
  return section.fromHeight + (section.toHeight - section.fromHeight)
    * (along - section.from) / (section.to - section.from);
}

/** Only newly narrowed or detached pieces in this cut's envelope may be removed. */
export function cleanNaturalAscentRemnants(world: World, ascent: IslandAscent): boolean {
  const { width, height, quantum, before, after } = raster(world, ascent);
  const radius = Math.max(1, Math.ceil(ascent.topWidth / quantum / 2) - 1);
  const opening = (mask: Uint8Array) =>
    squareFilter(squareFilter(mask, width, height, radius, true), width, height, radius, false);
  const originalOpening = opening(before), cutOpening = opening(after);
  const removed = Uint8Array.from(before, (value, i) => Number(value && !after[i]));
  const nearCut = squareFilter(removed, width, height, Math.ceil(ascent.topWidth / quantum), false);
  const cleanup = new Uint8Array(before.length);
  for (let i = 0; i < after.length; i++) {
    if (after[i] && originalOpening[i] && !cutOpening[i] && nearCut[i]) {
      const point = { x: (i % width + 0.5) * quantum, y: (Math.floor(i / width) + 0.5) * quantum };
      if (ascentHeightAt(ascent, point) !== undefined) continue;
      cleanup[i] = 1;
      after[i] = 0;
    }
  }
  const original = components(before, width), remaining = components(after, width);
  const parents = new Map<number, number[][]>();
  for (const group of remaining.groups) {
    const parent = original.ids[group[0]];
    const siblings = parents.get(parent) ?? [];
    siblings.push(group);
    parents.set(parent, siblings);
  }
  for (const siblings of parents.values()) {
    siblings.sort((a, b) => b.length - a.length);
    for (const group of siblings.slice(1)) for (const index of group) {
      const point = { x: (index % width + 0.5) * quantum, y: (Math.floor(index / width) + 0.5) * quantum };
      if (ascentHeightAt(ascent, point) !== undefined) return false;
      cleanup[index] = 1;
    }
  }
  const count = cleanup.reduce((sum, value) => sum + value, 0);
  if (!count) return true;
  const cutArea = before.reduce((sum, value) => sum + value, 0) * quantum ** 2;
  if (count * quantum ** 2 > Math.min(cutArea * 0.1, ascent.topWidth * world.tileSize * 8)) return false;
  const banks = [...ascent.banks!, ...ascent.sections.filter(section => section.fromHeight < ascent.upperHeight)];
  for (const group of components(cleanup, width).groups) {
    const points = group.map(index => ({
      x: (index % width + 0.5) * quantum, y: (Math.floor(index / width) + 0.5) * quantum,
    }));
    if (points.some(point => point.x < ascent.bounds.x - ascent.topWidth
      || point.x > ascent.bounds.x + ascent.bounds.width + ascent.topWidth
      || point.y < ascent.bounds.y - ascent.topWidth
      || point.y > ascent.bounds.y + ascent.bounds.height + ascent.topWidth)) return false;
    const distance = (section: IslandAscentSection) => {
      const polygon = ascentSectionPolygon(ascent, section);
      const minX = Math.min(...polygon.map(p => p.x)), maxX = Math.max(...polygon.map(p => p.x));
      const minY = Math.min(...polygon.map(p => p.y)), maxY = Math.max(...polygon.map(p => p.y));
      return Math.min(...points.map(point =>
        Math.max(minX - point.x, 0, point.x - maxX) ** 2 + Math.max(minY - point.y, 0, point.y - maxY) ** 2));
    };
    const adjacent = banks.filter(section => distance(section) <= quantum ** 2)
      .sort((a, b) => distance(a) - distance(b));
    for (const point of points) {
      const plane = adjacent.find(section => planeHeight(ascent, section, point) < ascent.upperHeight - 1e-8
        && [-0.5, 0.5].every(dx => [-0.5, 0.5].every(dy => {
          const height = planeHeight(ascent, section, { x: point.x + dx * quantum, y: point.y + dy * quantum });
          return height >= ascent.lowerHeight - 1e-8 && height <= ascent.upperHeight + 1e-8;
        })));
      if (!plane) return false;
      const direction = plane.axis!.direction;
      const origin = { x: point.x - direction.x * quantum / 2, y: point.y - direction.y * quantum / 2 };
      ascent.banks!.push({
        from: 0, to: quantum, fromWidth: quantum, toWidth: quantum, role: 'slope',
        fromHeight: planeHeight(ascent, plane, origin),
        toHeight: planeHeight(ascent, plane, { x: origin.x + direction.x * quantum, y: origin.y + direction.y * quantum }),
        axis: { origin, direction: { ...direction } },
      });
    }
  }
  return true;
}

/** Bank remnants must remain attached to their own route plane, not become isolated blades. */
export function cleanNaturalBankFragments(world: World, ascent: IslandAscent): boolean {
  const quantum = world.tileSize / 2, width = world.width * 2, height = world.height * 2;
  const sections = [...ascent.sections, ...ascent.banks!];
  const keys = new Map<string, number>();
  const planes = sections.map(section => {
    const grade = (section.toHeight - section.fromHeight) / (section.to - section.from);
    const x = grade * section.axis!.direction.x, y = grade * section.axis!.direction.y;
    const z = section.fromHeight - x * section.axis!.origin.x - y * section.axis!.origin.y;
    const key = [x, y, z].map(value => Math.round(value * 1e8)).join(',');
    if (!keys.has(key)) keys.set(key, keys.size);
    return keys.get(key)!;
  });
  const labels = new Int32Array(width * height).fill(-1), route = new Uint8Array(labels.length);
  const minX = Math.floor(ascent.bounds.x / quantum), minY = Math.floor(ascent.bounds.y / quantum);
  const maxX = Math.ceil((ascent.bounds.x + ascent.bounds.width) / quantum);
  const maxY = Math.ceil((ascent.bounds.y + ascent.bounds.height) / quantum);
  for (let y = minY; y < maxY; y++) for (let x = minX; x < maxX; x++) {
    const point = { x: (x + 0.5) * quantum, y: (y + 0.5) * quantum };
    for (const [index, section] of sections.entries()) {
      const local = ascentSectionCoordinates(ascent, section, point);
      if (local.x < section.from || local.x > section.to || Math.abs(local.y) > section.fromWidth / 2) continue;
      labels[y * width + x] = planes[index];
      route[y * width + x] = Number(index < ascent.sections.length);
      break;
    }
  }
  const visited = new Uint8Array(labels.length), cleanup: number[] = [];
  for (let first = 0; first < labels.length; first++) {
    if (visited[first] || labels[first] < 0) continue;
    const group = [first], plane = labels[first];
    visited[first] = 1;
    let anchored = false, touchesBase = false, raised = false;
    for (let cursor = 0; cursor < group.length; cursor++) {
      const index = group[cursor], x = index % width, y = Math.floor(index / width);
      const point = { x: (x + 0.5) * quantum, y: (y + 0.5) * quantum };
      anchored ||= route[index] > 0;
      raised ||= ascentHeightAt(ascent, point)! > ascent.lowerHeight + 1e-8;
      for (const next of [x ? index - 1 : -1, x < width - 1 ? index + 1 : -1, index - width, index + width]) {
        if (next < 0 || next >= labels.length) continue;
        const source = Math.floor(Math.floor(next / width) / 2) * world.width + Math.floor(next % width / 2);
        if (world.cells[source] && world.elevations![source] === ascent.lowerLevel) touchesBase = true;
        if (visited[next] || labels[next] !== plane) continue;
        visited[next] = 1;
        group.push(next);
      }
    }
    if (anchored || !raised) continue;
    if (!touchesBase) return false;
    cleanup.push(...group);
  }
  if (!cleanup.length) return true;
  if (cleanup.length * quantum ** 2 > ascent.topWidth * world.tileSize * 8) return false;
  const patches: IslandAscentSection[] = cleanup.map(index => {
    const direction = ascent.direction;
    const origin = {
      x: (index % width + 0.5) * quantum - direction.x * quantum / 2,
      y: (Math.floor(index / width) + 0.5) * quantum - direction.y * quantum / 2,
    };
    return {
      from: 0, to: quantum, fromWidth: quantum, toWidth: quantum, role: 'slope',
      fromHeight: ascent.lowerHeight, toHeight: ascent.lowerHeight, axis: { origin, direction: { ...direction } },
    };
  });
  const blockers = patches.map(section => ascentSectionPolygon(ascent, section));
  ascent.banks = [...ascent.banks!.flatMap(section => subtractAscentBank(ascent, section, blockers)), ...patches];
  return true;
}
