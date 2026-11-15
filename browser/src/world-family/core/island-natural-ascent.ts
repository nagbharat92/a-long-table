import type { Point, World } from './contracts';
import {
  ascentSectionHeightAt, ascentSectionPolygon, ascentSurfaceSections,
  type IslandAscent, type IslandAscentSection,
} from './island-ascents';
import type { IslandBeachShelf } from './island-beach-shelf';
import { intersectIslandPolygon } from './island-columns';
import { subtractAscentBank } from './island-ascent-banks';
import { islandHeightAtLevel } from './island-heights';
import type { IslandUplandShoulders } from './island-upland-shoulders';
import { cleanNaturalAscentRemnants, cleanNaturalBankFragments } from './island-natural-remnants';
import { BEACH_LEVEL } from './world';

export const NATURAL_ASCENT_TARGET_GRADE = 0.25;
export const NATURAL_ASCENT_MAX_GRADE = 1 / 3;

interface FlankRecipe {
  ascent: IslandAscent;
  openings: { section: IslandAscentSection; outward: Point }[];
}

function flankRecipe(
  world: World, source: IslandAscent, inset: number, offset: number, shift: number, width: number, traverses: number,
): FlankRecipe | undefined {
  const size = world.tileSize, half = width / 2;
  const outward = source.direction, across = { x: -outward.y, y: outward.x };
  const point = (along: number, side: number): Point => ({
    x: source.origin.x + outward.x * along + across.x * (side + shift),
    y: source.origin.y + outward.y * along + across.y * (side + shift),
  });
  const upperRun = size * 2, spacing = width + size * 2;
  const lowerRun = inset - upperRun - width - (traverses - 1) * spacing;
  if (lowerRun < size || Math.abs(offset) - width < size * 4) return undefined;
  const bend = -inset + upperRun + half, sign = Math.sign(offset);
  const middleRun = Math.abs(offset) - width;
  const run = upperRun + lowerRun + traverses * middleRun + (traverses - 1) * (spacing - width);
  const grade = (source.upperHeight - source.lowerHeight) / run;
  const ascent: IslandAscent = {
    ...source, kind: 'gully', origin: point(-inset, offset), length: 0,
    topWidth: width, bottomWidth: width, stepCount: 0, sections: [], banks: [],
  };
  const openings: FlankRecipe['openings'] = [];
  let distance = 0;
  let height = source.upperHeight;
  const add = (origin: Point, direction: Point, length: number, fromHeight: number, toHeight: number,
    role: IslandAscentSection['role']) => {
    const section: IslandAscentSection = {
      from: distance, to: distance + length, fromHeight, toHeight,
      fromWidth: width, toWidth: width, role, axis: { origin, direction },
    };
    ascent.sections.push(section);
    distance += length;
    return section;
  };
  const slope = (origin: Point, direction: Point, length: number) => {
    const section = add(origin, direction, length, height, height - length * grade, 'slope');
    height = section.toHeight;
    return section;
  };
  const pocket = (along: number, side: number) =>
    add(point(along - half, side), outward, width, height, height, 'pocket');
  add(point(-inset - size, offset), outward, size, source.upperHeight, source.upperHeight, 'pocket');
  ascent.sections[0].from -= size;
  ascent.sections[0].to -= size;
  distance = 0;
  slope(point(-inset, offset), outward, upperRun);
  for (let row = 0; row < traverses; row++) {
    const along = bend + row * spacing;
    const from = row % 2 ? 0 : offset, to = row % 2 ? offset : 0;
    const lateral = { x: across.x * Math.sign(to - from), y: across.y * Math.sign(to - from) };
    pocket(along, from);
    const traverse = slope(point(along, from + Math.sign(to - from) * half), lateral, middleRun);
    openings.push({ section: traverse, outward });
    const turn = pocket(along, to);
    const downhill = { x: across.x * (to === 0 ? -sign : sign), y: across.y * (to === 0 ? -sign : sign) };
    openings.push({ section: turn, outward: downhill });
    if (row < traverses - 1) {
      const connector = slope(point(along + half, to), outward, spacing - width);
      openings.push({ section: connector, outward: downhill });
    } else {
      const approach = slope(point(along + half, to), outward, lowerRun);
      approach.toHeight = source.lowerHeight;
      openings.push({ section: approach, outward: downhill });
    }
  }
  ascent.length = distance;
  const endSide = traverses % 2 ? 0 : offset;
  add(point(0, endSide), outward, source.sections.at(-1)!.to, source.lowerHeight, source.lowerHeight, 'pocket');
  return { ascent, openings };
}

function updateBounds(ascent: IslandAscent): void {
  const vertices = ascentSurfaceSections(ascent).flatMap(section => ascentSectionPolygon(ascent, section));
  const x = Math.min(...vertices.map(p => p.x)), y = Math.min(...vertices.map(p => p.y));
  ascent.bounds = {
    x, y, width: Math.max(...vertices.map(p => p.x)) - x, height: Math.max(...vertices.map(p => p.y)) - y,
  };
}

/** Extend a flight to its actual downhill rim, never across lower ground. */
function openFlank(
  world: World, ascent: IslandAscent, section: IslandAscentSection, outward: Point,
  shoulders: IslandUplandShoulders,
): boolean {
  const { origin, direction } = section.axis!, size = world.tileSize;
  const length = section.to - section.from, half = section.fromWidth / 2;
  const point = (along: number, out: number): Point => ({
    x: origin.x + direction.x * along + outward.x * out,
    y: origin.y + direction.y * along + outward.y * out,
  });
  const boundaryDistance = (p: Point, axis: Point) => {
    const coordinate = axis.x ? p.x : p.y, sign = axis.x || axis.y;
    return sign > 0 ? (Math.floor((coordinate + 1e-7) / size) + 1) * size - coordinate
      : coordinate - (Math.ceil((coordinate - 1e-7) / size) - 1) * size;
  };
  const banks: IslandAscentSection[] = [];
  for (let along = 0; along < length - 1e-7;) {
    const nextAlong = Math.min(length, along + boundaryDistance(point(along, 0), direction));
    const middle = (along + nextAlong) / 2;
    let rim = false;
    for (let out = half; out < half + size * 18 - 1e-7;) {
      const sample = point(middle, out + 1e-6);
      const x = Math.floor(sample.x / size), y = Math.floor(sample.y / size);
      if (x < 1 || y < 1 || x >= world.width - 1 || y >= world.height - 1) return false;
      const index = y * world.width + x, level = world.elevations![index];
      if (!world.cells[index] || shoulders.byCell.has(index)) return false;
      if (level === ascent.lowerLevel) { rim = true; break; }
      if (level !== ascent.upperLevel) return false;
      const nextOut = Math.min(half + size * 18, out + boundaryDistance(point(middle, out), outward));
      const bankOrigin = point(along, (out + nextOut) / 2);
      banks.push({
        from: section.from + along, to: section.from + nextAlong,
        fromHeight: ascentSectionHeightAt(ascent, section, bankOrigin),
        toHeight: ascentSectionHeightAt(ascent, section, point(nextAlong, (out + nextOut) / 2)),
        fromWidth: nextOut - out, toWidth: nextOut - out,
        role: 'slope', axis: { origin: bankOrigin, direction: { ...direction } },
      });
      out = nextOut;
    }
    if (!rim) return false;
    along = nextAlong;
  }
  ascent.banks!.push(...banks);
  return true;
}

function trimBanks(ascent: IslandAscent): void {
  const route = ascent.sections.map(section => ascentSectionPolygon(ascent, section));
  const banks: IslandAscentSection[] = [];
  // Lower flights own overlaps. Upper banks stop at them, rather than burying a return leg.
  for (const section of ascent.banks!.sort((a, b) =>
    Math.max(a.fromHeight, a.toHeight) - Math.max(b.fromHeight, b.toHeight))) {
    banks.push(...subtractAscentBank(ascent, section,
      [...route, ...banks.map(bank => ascentSectionPolygon(ascent, bank))]));
  }
  ascent.banks = banks;
}

function supported(
  world: World, candidate: IslandAscent, ascents: readonly IslandAscent[],
  beach: IslandBeachShelf, shoulders: IslandUplandShoulders,
): boolean {
  const size = world.tileSize;
  const end = candidate.sections.at(-1)!;
  for (const across of [-end.toWidth / 2 + 1e-6, 0, end.toWidth / 2 - 1e-6]) {
    const distance = end.to - end.from - 1e-6;
    const origin = end.axis!.origin, direction = end.axis!.direction;
    const x = Math.floor((origin.x + direction.x * distance - direction.y * across) / size);
    const y = Math.floor((origin.y + direction.y * distance + direction.x * across) / size);
    if (x < 0 || y < 0 || x >= world.width || y >= world.height
      || world.elevations![y * world.width + x] !== candidate.lowerLevel) return false;
  }
  const protectedPolygons = ascents.filter(ascent => ascent.id !== candidate.id)
    .flatMap(ascent => ascentSurfaceSections(ascent).map(section => ascentSectionPolygon(ascent, section)));
  for (const section of ascentSurfaceSections(candidate)) {
    const polygon = ascentSectionPolygon(candidate, section);
    if (protectedPolygons.some(other => intersectIslandPolygon(polygon, other).length > 0)) return false;
    const minX = Math.floor(Math.min(...polygon.map(p => p.x)) / size);
    const maxX = Math.ceil(Math.max(...polygon.map(p => p.x)) / size);
    const minY = Math.floor(Math.min(...polygon.map(p => p.y)) / size);
    const maxY = Math.ceil(Math.max(...polygon.map(p => p.y)) / size);
    for (let y = minY; y < maxY; y++) for (let x = minX; x < maxX; x++) {
      const cell = [
        { x: x * size, y: y * size }, { x: (x + 1) * size, y: y * size },
        { x: (x + 1) * size, y: (y + 1) * size }, { x: x * size, y: (y + 1) * size },
      ];
      const clipped = intersectIslandPolygon(cell, polygon);
      if (!clipped.length) continue;
      if (x < 1 || y < 1 || x >= world.width - 1 || y >= world.height - 1) return false;
      const index = y * world.width + x, level = world.elevations![index];
      if (!world.cells[index] || world.heights[index] - world.seaLevel <= BEACH_LEVEL
        || beach.landSurfaces.has(index) || shoulders.byCell.has(index)
        || (level !== candidate.upperLevel && level !== candidate.lowerLevel)) return false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const next = (y + dy) * world.width + x + dx;
        if (!world.cells[next] || beach.landSurfaces.has(next)) return false;
      }
      const sourceHeight = islandHeightAtLevel(world, level);
      if (clipped.some(p => ascentSectionHeightAt(candidate, section, p) > sourceHeight + 1e-8)) return false;
      if (section === candidate.sections[0] && level !== candidate.upperLevel) return false;
    }
  }
  return true;
}

function routeSupport(
  world: World, source: IslandAscent, beach: IslandBeachShelf, shoulders: IslandUplandShoulders,
): (candidate: IslandAscent) => boolean {
  const stride = world.width + 1, upper = new Int32Array(stride * (world.height + 1));
  const either = new Int32Array(upper.length);
  for (let y = 0; y < world.height; y++) {
    let upperRow = 0, eitherRow = 0;
    for (let x = 0; x < world.width; x++) {
      const index = y * world.width + x, level = world.elevations![index];
      let valid = x > 0 && y > 0 && x < world.width - 1 && y < world.height - 1
        && !!world.cells[index] && world.heights[index] - world.seaLevel > BEACH_LEVEL
        && !beach.landSurfaces.has(index) && !shoulders.byCell.has(index);
      if (valid) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const next = (y + dy) * world.width + x + dx;
        if (!world.cells[next] || beach.landSurfaces.has(next)) valid = false;
      }
      upperRow += Number(valid && level === source.upperLevel);
      eitherRow += Number(valid && (level === source.upperLevel || level === source.lowerLevel));
      upper[(y + 1) * stride + x + 1] = upper[y * stride + x + 1] + upperRow;
      either[(y + 1) * stride + x + 1] = either[y * stride + x + 1] + eitherRow;
    }
  }
  return candidate => candidate.sections.every(section => {
    const polygon = ascentSectionPolygon(candidate, section), size = world.tileSize;
    const left = Math.floor(Math.min(...polygon.map(point => point.x)) / size);
    const right = Math.ceil(Math.max(...polygon.map(point => point.x)) / size);
    const top = Math.floor(Math.min(...polygon.map(point => point.y)) / size);
    const bottom = Math.ceil(Math.max(...polygon.map(point => point.y)) / size);
    if (left < 0 || top < 0 || right > world.width || bottom > world.height) return false;
    const sums = Math.max(section.fromHeight, section.toHeight) > source.lowerHeight + 1e-8 ? upper : either;
    const count = sums[bottom * stride + right] - sums[top * stride + right]
      - sums[bottom * stride + left] + sums[top * stride + left];
    return count === (right - left) * (bottom - top);
  });
}

/** One local, subtractive flank study; existing ascents remain the comparison baseline. */
export function createIslandNaturalAscent(
  world: World, ascents: readonly IslandAscent[], beach: IslandBeachShelf, shoulders: IslandUplandShoulders,
): IslandAscent | undefined {
  const ordered = [...ascents].sort((a, b) =>
    (a.upperHeight - a.lowerHeight) - (b.upperHeight - b.lowerHeight) || a.id - b.id);
  for (const source of ordered) {
    const fitsRoute = routeSupport(world, source, beach, shoulders);
    for (const limit of [NATURAL_ASCENT_TARGET_GRADE, NATURAL_ASCENT_MAX_GRADE]) {
      const tall = source.upperHeight - source.lowerHeight > world.tileSize * 4;
      const counts = tall && limit > NATURAL_ASCENT_TARGET_GRADE ? [2, 3, 1] : [1, 2, 3];
      for (const traverses of counts) {
        for (const width of [world.tileSize * 3, world.tileSize * 2]) {
          for (const depth of [6, 8, 10, 12, 14, 16]) {
            for (const side of [10, -10, 12, -12, 8, -8, 14, -14, 16, -16, 9, -9, 7, -7]) {
              const offset = side * world.tileSize;
              const shifts = [...new Set([-offset, -offset / 2, 0,
                ...Array.from({ length: Math.abs(side) + 1 }, (_, step) => -offset + Math.sign(offset) * step * world.tileSize)])];
              for (const shift of shifts) {
                const recipe = flankRecipe(world, source, depth * world.tileSize, offset, shift, width, traverses);
                if (!recipe) continue;
                const { ascent: candidate, openings } = recipe;
                if (candidate.sections.some(section =>
                  (section.fromHeight - section.toHeight) / (section.to - section.from) > limit + 1e-8)) continue;
                if (!fitsRoute(candidate)) continue;
                if (!supported(world, candidate, ascents, beach, shoulders)) continue;
                if (!openings.every(({ section, outward }) =>
                  openFlank(world, candidate, section, outward, shoulders)
                  || (outward.x * source.direction.x + outward.y * source.direction.y === 0
                    && openFlank(world, candidate, section, { x: -outward.x, y: -outward.y }, shoulders)))) continue;
                trimBanks(candidate);
                updateBounds(candidate);
                if (!supported(world, candidate, ascents, beach, shoulders)) continue;
                if (!cleanNaturalAscentRemnants(world, candidate)) continue;
                updateBounds(candidate);
                if (!cleanNaturalBankFragments(world, candidate)) continue;
                updateBounds(candidate);
                if (supported(world, candidate, ascents, beach, shoulders)) return candidate;
              }
            }
          }
        }
      }
    }
  }
  return undefined;
}
