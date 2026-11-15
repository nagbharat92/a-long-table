import type { Point, Ramp, Rectangle, World } from './contracts';
import { islandHeightAtLevel, islandLevelHeights, validateIslandHeights } from './island-heights';
import { seededRandom } from './random';
import { BEACH_LEVEL } from './world';

export type IslandAscentKind = 'stairs' | 'terraced' | 'gully';

export interface IslandAscentSection {
  from: number;
  to: number;
  fromHeight: number;
  toHeight: number;
  fromWidth: number;
  toWidth: number;
  role: 'landing' | 'tread' | 'slope' | 'pocket';
  axis?: { origin: Point; direction: Point };
}

export interface IslandAscent {
  id: number;
  kind: IslandAscentKind;
  origin: Point;
  direction: Point;
  upperLevel: number;
  lowerLevel: number;
  upperHeight: number;
  lowerHeight: number;
  length: number;
  topWidth: number;
  bottomWidth: number;
  stepCount: number;
  sections: IslandAscentSection[];
  banks?: IslandAscentSection[];
  bounds: Rectangle;
}

export function ascentSurfaceSections(ascent: IslandAscent): IslandAscentSection[] {
  return ascent.banks ? [...ascent.sections, ...ascent.banks] : ascent.sections;
}

const EPSILON = 1e-8;
const PROFILES = ['broad', 'compact', 'terraced'] as const;
const UPPER_EXTENSIONS = [0, 4, 8, 12, 16, 20, 24, 32, 40] as const;
// The existing character is 12 world units tall, with roughly 1.25-unit feet.
export const ISLAND_STAIR_MAX_RISER = 1.5;
export const ISLAND_STAIR_MIN_TREAD = 2;

function position(ascent: IslandAscent, along: number, across: number): Point {
  const { origin, direction } = ascent;
  return {
    x: origin.x + direction.x * along - direction.y * across,
    y: origin.y + direction.y * along + direction.x * across,
  };
}

export function ascentSectionPosition(
  ascent: IslandAscent, section: IslandAscentSection, along: number, across = 0,
): Point {
  if (!section.axis) return position(ascent, along, across);
  const { origin, direction } = section.axis, distance = along - section.from;
  return {
    x: origin.x + direction.x * distance - direction.y * across,
    y: origin.y + direction.y * distance + direction.x * across,
  };
}

export function ascentSectionCoordinates(ascent: IslandAscent, section: IslandAscentSection, point: Point): Point {
  const { origin, direction } = section.axis ?? ascent;
  const dx = point.x - origin.x, dy = point.y - origin.y;
  return {
    x: dx * direction.x + dy * direction.y + (section.axis ? section.from : 0),
    y: -dx * direction.y + dy * direction.x,
  };
}

export function ascentSectionHeightAt(ascent: IslandAscent, section: IslandAscentSection, point: Point): number {
  const along = ascentSectionCoordinates(ascent, section, point).x;
  const t = Math.max(0, Math.min(1, (along - section.from) / (section.to - section.from)));
  return section.fromHeight + (section.toHeight - section.fromHeight) * t;
}

/** Counterclockwise rectangular tread or landing (widths are full widths). */
export function ascentSectionPolygon(ascent: IslandAscent, section: IslandAscentSection): Point[] {
  return [
    ascentSectionPosition(ascent, section, section.from, -section.fromWidth / 2),
    ascentSectionPosition(ascent, section, section.to, -section.toWidth / 2),
    ascentSectionPosition(ascent, section, section.to, section.toWidth / 2),
    ascentSectionPosition(ascent, section, section.from, section.fromWidth / 2),
  ];
}

/**
 * Shared boundaries belong to the outgoing (lower) section. Wider incoming
 * landings retain their exposed shoulders. The final outer edge is included.
 */
export function ascentHeightAt(ascent: IslandAscent, point: Point): number | undefined {
  if (ascent.kind === 'gully') {
    for (const section of ascentSurfaceSections(ascent)) {
      const { x: along, y: across } = ascentSectionCoordinates(ascent, section, point);
      if (along < section.from - EPSILON || along > section.to + EPSILON
        || Math.abs(across) > section.fromWidth / 2 + EPSILON) continue;
      return ascentSectionHeightAt(ascent, section, point);
    }
    return undefined;
  }
  const dx = point.x - ascent.origin.x, dy = point.y - ascent.origin.y;
  const along = dx * ascent.direction.x + dy * ascent.direction.y;
  const across = -dx * ascent.direction.y + dy * ascent.direction.x;
  const last = ascent.sections.length - 1;
  const index = ascent.sections.findIndex((section, i) =>
    along >= section.from - EPSILON
    && (along < section.to - EPSILON || (i === last && along <= section.to + EPSILON)));
  if (index < 0) return undefined;
  const section = ascent.sections[index];
  const t = Math.max(0, Math.min(1, (along - section.from) / (section.to - section.from)));
  const width = section.fromWidth + (section.toWidth - section.fromWidth) * t;
  if (Math.abs(across) > width / 2 + EPSILON) {
    const previous = ascent.sections[index - 1];
    if (previous && Math.abs(along - previous.to) <= EPSILON
      && Math.abs(across) <= previous.toWidth / 2 + EPSILON) return previous.toHeight;
    return undefined;
  }
  return section.fromHeight + (section.toHeight - section.fromHeight) * t;
}

function rectanglePolygon(rect: Rectangle, scale = 1): Point[] {
  return [
    { x: rect.x * scale, y: rect.y * scale },
    { x: (rect.x + rect.width) * scale, y: rect.y * scale },
    { x: (rect.x + rect.width) * scale, y: (rect.y + rect.height) * scale },
    { x: rect.x * scale, y: (rect.y + rect.height) * scale },
  ];
}

/** Positive-area overlap; sharing an edge alone does not reserve a cell. */
function overlaps(a: Point[], b: Point[]): boolean {
  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i], q = polygon[(i + 1) % polygon.length];
      const nx = p.y - q.y, ny = q.x - p.x;
      const pa = a.map(v => v.x * nx + v.y * ny);
      const pb = b.map(v => v.x * nx + v.y * ny);
      if (Math.min(...pa) >= Math.max(...pb) - EPSILON
        || Math.min(...pb) >= Math.max(...pa) - EPSILON) return false;
    }
  }
  return true;
}

function boundsOf(polygons: Point[][]): Rectangle {
  const points = polygons.flat();
  const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y));
  return {
    x, y,
    width: Math.max(...points.map(p => p.x)) - x,
    height: Math.max(...points.map(p => p.y)) - y,
  };
}

function recipe(world: World, ramp: Ramp, id: number, kind: IslandAscentKind,
  length: number, topWidth: number, bottomWidth: number, middleWidth: number,
  landingDepth: number, steps: number, upperExtension = 0, lateralOffset = 0): IslandAscent {
  const upperHeight = islandHeightAtLevel(world, ramp.upperLevel);
  const lowerHeight = islandHeightAtLevel(world, ramp.lowerLevel);
  const ascent: IslandAscent = {
    id, kind, origin: {
      x: (ramp.highCell.x + 0.5) * world.tileSize - ramp.direction.x * upperExtension
        - ramp.direction.y * lateralOffset,
      y: (ramp.highCell.y + 0.5) * world.tileSize - ramp.direction.y * upperExtension
        + ramp.direction.x * lateralOffset,
    },
    direction: { ...ramp.direction }, upperLevel: ramp.upperLevel, lowerLevel: ramp.lowerLevel,
    upperHeight, lowerHeight, length, topWidth, bottomWidth, stepCount: 0,
    sections: [], bounds: { x: 0, y: 0, width: 0, height: 0 },
  };
  const quantizeWidth = (width: number) => Math.max(8, Math.floor(width / 2) * 2);
  const upperWidth = quantizeWidth(kind === 'terraced' ? topWidth : Math.min(topWidth, bottomWidth));
  const lowerWidth = kind === 'terraced' ? quantizeWidth(bottomWidth) : upperWidth;
  const landingWidth = quantizeWidth(Math.max(middleWidth, upperWidth, lowerWidth));
  ascent.topWidth = upperWidth;
  ascent.bottomWidth = lowerWidth;
  const add = (from: number, to: number, fromHeight: number, toHeight: number,
    role: IslandAscentSection['role'], width: number) => {
    ascent.sections.push({
      from, to, fromHeight, toHeight, fromWidth: width, toWidth: width, role,
    });
  };
  add(-landingDepth, 0, upperHeight, upperHeight, 'landing', upperWidth);
  const middleDepth = kind === 'terraced' ? Math.min(6, length / 3) : 0;
  const middle = Math.floor(steps / 2);
  const treadDepth = (length - middleDepth) / (steps + 1);
  let from = 0;
  for (let tread = 0; tread <= steps; tread++) {
    const to = tread === steps ? length
      : from + treadDepth + (tread === middle ? middleDepth : 0);
    const height = tread === steps ? lowerHeight : upperHeight - (upperHeight - lowerHeight) * tread / steps;
    const landing = kind === 'terraced' && tread === middle;
    const width = landing ? landingWidth : tread <= middle ? upperWidth : lowerWidth;
    add(from, to, height, height, landing ? 'landing' : 'tread', width);
    from = to;
  }
  ascent.stepCount = steps;
  add(length, length + landingDepth, lowerHeight, lowerHeight, 'landing', lowerWidth);
  ascent.bounds = boundsOf(ascent.sections.map(section => ascentSectionPolygon(ascent, section)));
  return ascent;
}

function supported(world: World, ascent: IslandAscent, protectedRamps: Point[][],
  reserved: Set<number>): number[] | undefined {
  const footprint = new Set<number>();
  const size = world.tileSize;
  for (const section of ascent.sections) {
    const polygon = ascentSectionPolygon(ascent, section);
    if (protectedRamps.some(other => overlaps(polygon, other))) return undefined;
    const bounds = boundsOf([polygon]);
    for (let y = Math.floor(bounds.y / size); y < Math.ceil((bounds.y + bounds.height) / size); y++) {
      for (let x = Math.floor(bounds.x / size); x < Math.ceil((bounds.x + bounds.width) / size); x++) {
        if (!overlaps(polygon, rectanglePolygon({ x, y, width: 1, height: 1 }, size))) continue;
        if (x < 0 || y < 0 || x >= world.width || y >= world.height) return undefined;
        const index = y * world.width + x;
        if (reserved.has(index) || !world.cells[index]
          || world.heights[index] - world.seaLevel <= BEACH_LEVEL) return undefined;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height
              || !world.cells[ny * world.width + nx]) return undefined;
          }
        }
        const cx = (x + 0.5) * size, cy = (y + 0.5) * size;
        const along = (cx - ascent.origin.x) * ascent.direction.x
          + (cy - ascent.origin.y) * ascent.direction.y;
        const center = position(ascent, along, 0);
        const centerIndex = Math.floor(center.y / size) * world.width + Math.floor(center.x / size);
        const level = world.elevations![index];
        if (level !== world.elevations![centerIndex]
          || (level !== ascent.upperLevel && level !== ascent.lowerLevel)) return undefined;
        const endpoint = section.to <= 0 ? ascent.upperLevel
          : section.from >= ascent.length ? ascent.lowerLevel : undefined;
        if (endpoint !== undefined && (level !== endpoint || world.cliffCells?.[index])) return undefined;
        footprint.add(index);
      }
    }
  }
  return [...footprint];
}

function plateau(world: World, start: Point, level: number): Set<number> {
  const first = start.y * world.width + start.x;
  const connected = new Set([first]), queue = [first];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const index = queue[cursor], x = index % world.width, y = Math.floor(index / world.width);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx, ny = y + dy, next = ny * world.width + nx;
      if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height || connected.has(next)
        || !world.cells[next] || world.cliffCells?.[next] || world.elevations![next] !== level
        || world.heights[next] - world.seaLevel <= BEACH_LEVEL) continue;
      connected.add(next);
      queue.push(next);
    }
  }
  return connected;
}

/**
 * V2-only, pure recipes. Every source connection is retained or fails explicitly.
 * The bounded search extends flights, then tries another straight corridor on
 * the same connected plateaus. No section axes or source world arrays change.
 * Riser and tread limits never relax to fit a short corridor.
 * All original other-ramp rectangles are protected before reserving footprints.
 */
export function createIslandAscents(world: World): IslandAscent[] {
  if (!world.elevations || !world.ramps || !Number.isFinite(world.tileSize) || world.tileSize <= 0) {
    throw new Error('Island ascents require source ramps, elevations, and a positive tile size.');
  }
  validateIslandHeights(world);
  const heights = islandLevelHeights(world);
  const result: IslandAscent[] = [];
  const reserved = new Set<number>();
  const sourcePolygons = world.ramps.map(ramp => rectanglePolygon(ramp.rect, world.tileSize));
  const offset = Math.floor(seededRandom(world.seed ^ 0x61ce47)() * PROFILES.length);
  for (const [id, ramp] of world.ramps.entries()) {
    const fail = () => new Error(`Unsupported island ascent source ramp ${id} for seed ${world.seed}.`);
    const { direction, highCell, lowCell } = ramp;
    const run = ((lowCell.x - highCell.x) * direction.x
      + (lowCell.y - highCell.y) * direction.y) * world.tileSize;
    if (!Number.isInteger(direction.x) || !Number.isInteger(direction.y)
      || Math.abs(direction.x) + Math.abs(direction.y) !== 1 || !Number.isFinite(run) || run <= 0
      || (lowCell.x - highCell.x) * direction.y !== (lowCell.y - highCell.y) * direction.x
      || !Number.isInteger(ramp.lowerLevel) || !Number.isInteger(ramp.upperLevel)
      || ramp.lowerLevel < 0 || ramp.upperLevel >= heights.length || ramp.upperLevel <= ramp.lowerLevel
      || ![highCell.x, highCell.y, lowCell.x, lowCell.y].every(Number.isInteger)
      || ![highCell, lowCell].every(cell => cell.x >= 0 && cell.y >= 0
        && cell.x < world.width && cell.y < world.height
        && world.cells[cell.y * world.width + cell.x]
        && world.heights[cell.y * world.width + cell.x] - world.seaLevel > BEACH_LEVEL)
      || world.elevations[highCell.y * world.width + highCell.x] !== ramp.upperLevel
      || world.elevations[lowCell.y * world.width + lowCell.x] !== ramp.lowerLevel
      || sourcePolygons.some((polygon, other) => other !== id && overlaps(sourcePolygons[id], polygon))) throw fail();
    const rng = seededRandom(world.seed ^ Math.imul(id + 1, 0x45d9f3b)
      ^ Math.imul(highCell.x + highCell.y * world.width, 7919));
    const profile = PROFILES[(id + offset) % PROFILES.length];
    const kind: IslandAscentKind = profile === 'terraced' ? 'terraced' : 'stairs';
    const top = profile === 'broad' ? 13 + rng() * 3 : 8 + rng() * 3;
    const bottom = profile === 'broad' ? 9 + rng() * 3 : 11 + rng() * 3;
    const middle = kind === 'terraced' ? 16 + rng() * 4 : Math.max(top, bottom);
    const rise = islandHeightAtLevel(world, ramp.upperLevel) - islandHeightAtLevel(world, ramp.lowerLevel);
    const minimumSteps = Math.max(4, Math.ceil(rise / ISLAND_STAIR_MAX_RISER));
    const preferredSteps = minimumSteps + Math.floor(rng() * 4);
    const extension = 4 + Math.floor(rng() * 5) * 4;
    const protectedRamps = sourcePolygons.filter((_, other) => other !== id);
    let chosen: IslandAscent | undefined;
    let footprint: number[] | undefined;
    let upper: Set<number> | undefined, lower: Set<number> | undefined;
    const indexAt = (point: Point) => Math.floor(point.y / world.tileSize) * world.width
      + Math.floor(point.x / world.tileSize);
    const accept = (candidate: IslandAscent): boolean => {
      const cells = supported(world, candidate, protectedRamps, reserved);
      if (!cells) return false;
      upper ??= plateau(world, highCell, ramp.upperLevel);
      lower ??= plateau(world, lowCell, ramp.lowerLevel);
      if (!upper.has(indexAt(candidate.origin))
        || !lower.has(indexAt(position(candidate, candidate.length, 0)))) return false;
      chosen = candidate;
      footprint = cells;
      return true;
    };
    search: for (const steps of [...new Set([preferredSteps, minimumSteps])]) {
      const minimumLength = (steps + 1) * ISLAND_STAIR_MIN_TREAD + (kind === 'terraced' ? 6 : 0);
      const lengths = [...new Set([Math.max(minimumLength, run + extension),
        Math.max(minimumLength, run + 20), minimumLength])];
      for (const scale of [1, 0.8, 0.6, 0]) {
        for (const upperExtension of UPPER_EXTENSIONS) {
          for (const length of lengths.map(value => Math.max(value, run + upperExtension))) {
            for (const landingDepth of [6, 4, 2]) {
              const width = (desired: number) => 7 + (desired - 7) * scale;
              const candidate = recipe(world, ramp, id, kind, length, width(top), width(bottom),
                width(middle), landingDepth, steps, upperExtension);
              if (accept(candidate)) break search;
            }
          }
        }
      }
    }
    if (!chosen) {
      upper ??= plateau(world, highCell, ramp.upperLevel);
      lower ??= plateau(world, lowCell, ramp.lowerLevel);
      const length = (minimumSteps + 1) * ISLAND_STAIR_MIN_TREAD;
      relocate: for (let distance = 4; distance <= 64; distance += 4) {
        for (const lateral of [distance, -distance]) {
          for (const upperExtension of UPPER_EXTENSIONS) {
            for (const landingDepth of [4, 2]) {
              const candidate = recipe(world, ramp, id, 'stairs', length, 8, 8, 8,
                landingDepth, minimumSteps, upperExtension, lateral);
              if (!upper.has(indexAt(candidate.origin))
                || !lower.has(indexAt(position(candidate, candidate.length, 0)))) continue;
              if (accept(candidate)) break relocate;
            }
          }
        }
      }
      if (!chosen) {
        const origins = [...upper].filter(index =>
          Math.max(Math.abs(index % world.width - highCell.x),
            Math.abs(Math.floor(index / world.width) - highCell.y)) <= 16)
          .sort((a, b) => {
            const distance = (index: number) => (index % world.width - highCell.x) ** 2
              + (Math.floor(index / world.width) - highCell.y) ** 2;
            return distance(a) - distance(b) || a - b;
          });
        const headings = [direction, { x: -direction.y, y: direction.x },
          { x: direction.y, y: -direction.x }, { x: -direction.x, y: -direction.y }];
        alternateRim: for (const index of origins) {
          for (const heading of headings) {
            const relocated = { ...ramp, highCell: { x: index % world.width,
              y: Math.floor(index / world.width) }, direction: heading };
            for (const landingDepth of [4, 2]) {
              const candidate = recipe(world, relocated, id, 'stairs', length, 8, 8, 8,
                landingDepth, minimumSteps);
              if (!lower.has(indexAt(position(candidate, candidate.length, 0)))) continue;
              if (accept(candidate)) break alternateRim;
            }
          }
        }
      }
    }
    if (!chosen || !footprint) throw fail();
    footprint.forEach(index => reserved.add(index));
    result.push(chosen);
  }
  return result;
}
