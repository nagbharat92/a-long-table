import type { Point, World } from './contracts';
import type { IslandAscent } from './island-ascents';
import { islandCoveInfluence, type IslandCove } from './island-cove';
import { BEACH_LEVEL, terrainAt } from './world';
import { createIslandShoreField } from '../render/island-shore-field';

export const COAST_DRY_WIDTH = 16;
const ORIGINAL_GRADE = 3;

export interface ShoreDemand { width: number; priority: number }
export interface OpposingShorePlan {
  first: number;
  last: number;
  dryStart: number;
  dryWidth: number;
  reason: 'both-fit' | 'first-only' | 'last-only' | 'rocky-neck' | 'insufficient-land';
}

/** Grants whole profiles or rejects them; never steepens a beach to make it fit. */
export function planOpposingShores(width: number, first: ShoreDemand, last: ShoreDemand, dryWidth = COAST_DRY_WIDTH): OpposingShorePlan {
  if (![width, first.width, first.priority, last.width, last.priority, dryWidth].every(Number.isFinite)
    || width <= 0 || first.width < 0 || last.width < 0 || dryWidth <= 0) {
    throw new RangeError('Coastal budgets require finite, nonnegative demands and positive land/dry widths.');
  }
  let a = 0, b = 0;
  let reason: OpposingShorePlan['reason'];
  if (width < dryWidth) reason = 'insufficient-land';
  else if (!first.width && !last.width) reason = 'rocky-neck';
  else if (first.width + last.width + dryWidth <= width) {
    a = first.width; b = last.width; reason = 'both-fit';
  } else {
    const firstWins = first.priority >= last.priority;
    if (firstWins && first.width > 0 && first.width + dryWidth <= width) { a = first.width; reason = 'first-only'; }
    else if (last.width > 0 && last.width + dryWidth <= width) { b = last.width; reason = 'last-only'; }
    else if (first.width > 0 && first.width + dryWidth <= width) { a = first.width; reason = 'first-only'; }
    else reason = 'rocky-neck';
  }
  const reserve = Math.min(width, dryWidth);
  return { first: a, last: b, dryStart: a + (width - a - b - reserve) / 2, dryWidth: reserve, reason };
}

export interface CoastCrossSection {
  axis: 'x' | 'y';
  start: Point;
  cells: number[];
  primary: 'first' | 'last';
  plan: OpposingShorePlan;
}
export interface IslandCoastBudget {
  dryCells: Uint8Array;
  sections: CoastCrossSection[];
  restoredCells: number;
  rejectedProfiles: number;
  focus: Point;
}

function narrowSections(world: World, cove: IslandCove): Omit<CoastCrossSection, 'plan'>[] {
  const result: Omit<CoastCrossSection, 'plan'>[] = [];
  const size = world.tileSize;
  for (const axis of ['x', 'y'] as const) {
    const length = axis === 'x' ? world.width : world.height;
    const lines = axis === 'x' ? world.height : world.width;
    const index = (along: number, line: number) => axis === 'x' ? line * world.width + along : along * world.width + line;
    for (let line = 0; line < lines; line++) {
      for (let cursor = 0; cursor < length;) {
        if (!world.cells[index(cursor, line)]) { cursor++; continue; }
        const from = cursor;
        while (cursor < length && world.cells[index(cursor, line)]) cursor++;
        const count = cursor - from;
        if (count * size > cove.gradeWidth * 2 + COAST_DRY_WIDTH || from === 0 || cursor === length) continue;
        const middle = Math.floor((from + cursor - 1) / 2);
        // Ignore terminal caps: a neck must continue in both tangent directions.
        const continues = (offset: number) => {
          if (line + offset < 0 || line + offset >= lines) return false;
          for (let d = -2; d <= 2; d++) {
            if (middle + d >= 0 && middle + d < length && world.cells[index(middle + d, line + offset)]) return true;
          }
          return false;
        };
        if (!continues(-2) || !continues(2)) continue;
        const point = (along: number): Point => axis === 'x'
          ? { x: along * size, y: (line + 0.5) * size } : { x: (line + 0.5) * size, y: along * size };
        const a = point(from), b = point(cursor);
        const center = cove.center[axis];
        const firstFacing = center < a[axis] ? islandCoveInfluence(cove, a.x, a.y) : 0;
        const lastFacing = center > b[axis] ? islandCoveInfluence(cove, b.x, b.y) : 0;
        if (Math.max(firstFacing, lastFacing) <= 0.15) continue;
        result.push({
          axis, start: axis === 'x' ? { x: from, y: line } : { x: line, y: from },
          cells: Array.from({ length: count }, (_, i) => index(from + i, line)),
          primary: firstFacing >= lastFacing ? 'first' : 'last',
        });
      }
    }
  }
  return result;
}

export function coordinateIslandCoasts(
  original: World, carved: World, cove: IslandCove, ascents: readonly IslandAscent[],
): { world: World; cove: IslandCove; budget: IslandCoastBudget } {
  if (!Number.isInteger(carved.width) || carved.width <= 0 || !Number.isInteger(carved.height) || carved.height <= 0
    || !Number.isInteger(carved.tileSize) || carved.tileSize <= 0
    || original.width !== carved.width || original.height !== carved.height || original.tileSize !== carved.tileSize
    || !original.cliffCells || !carved.elevations || !carved.rampIds || !carved.cliffCells || cove.shoreMask
    || [original.cells, original.heights, original.cliffCells, carved.cells, carved.heights, carved.elevations, carved.rampIds, carved.cliffCells]
      .some(buffer => buffer.length !== carved.width * carved.height)
    || ![cove.center.x, cove.center.y, cove.radius.x, cove.radius.y, cove.rotation, cove.gradeWidth, cove.shelfWidth,
      cove.shelfDepth, cove.focus.x, cove.focus.y].every(Number.isFinite)
    || original.heights.some(value => !Number.isFinite(value)) || carved.heights.some(value => !Number.isFinite(value))
    || cove.radius.x <= 0 || cove.radius.y <= 0 || cove.gradeWidth <= 0 || cove.shelfWidth <= 0 || cove.shelfDepth <= 0) {
    throw new Error('Coast coordination requires matching generated worlds and an uncoordinated cove.');
  }
  const world = { ...carved, cells: carved.cells.slice(), heights: carved.heights.slice(), cliffCells: carved.cliffCells.slice() };
  const size = world.tileSize, gradeCells = Math.ceil(cove.gradeWidth / size);
  const dryCount = Math.ceil(COAST_DRY_WIDTH / size);
  const protectedCell = (i: number) => {
    const x = i % world.width, y = Math.floor(i / world.width);
    return !!world.elevations![i] || world.rampIds![i] >= 0 || ascents.some(({ bounds }) =>
      (x + 1) * size > bounds.x - size * 2 && x * size < bounds.x + bounds.width + size * 2
      && (y + 1) * size > bounds.y - size * 2 && y * size < bounds.y + bounds.height + size * 2);
  };
  let restoredCells = 0, changed: boolean;
  do {
    changed = false;
    for (const section of narrowSections(world, cove)) {
      const missing = dryCount - section.cells.length;
      if (missing <= 0) continue;
      const step = (section.axis === 'x' ? 1 : world.width) * (section.primary === 'first' ? -1 : 1);
      let next = section.primary === 'first' ? section.cells[0] : section.cells[section.cells.length - 1];
      for (let n = 0; n < missing; n++) {
        next += step;
        if (next < 0 || next >= world.cells.length
          || (section.axis === 'x' && Math.floor(next / world.width) !== section.start.y)
          || !original.cells[next] || world.cells[next] || protectedCell(next)) break;
        world.cells[next] = original.cells[next];
        world.heights[next] = original.heights[next];
        world.cliffCells![next] = original.cliffCells![next];
        restoredCells++;
        changed = true;
      }
    }
  } while (changed);
  const dryCells = new Uint8Array(world.cells.length);
  const sections: CoastCrossSection[] = [];
  const candidates: { cells: number[]; allow: boolean; primary: boolean }[] = [];
  for (const section of narrowSections(world, cove)) {
    const first = section.cells[0], last = section.cells[section.cells.length - 1];
    const eligible = (i: number) => !protectedCell(i) && terrainAt(world, {
      x: i % world.width, y: Math.floor(i / world.width),
    }) === 'sand';
    const demand = (end: 'first' | 'last', i: number): ShoreDemand => ({
      width: eligible(i) ? (section.primary === end ? gradeCells * size : Math.ceil(ORIGINAL_GRADE / size) * size) : 0,
      priority: section.primary === end ? 2 : 1,
    });
    const plan = planOpposingShores(section.cells.length * size, demand('first', first), demand('last', last), dryCount * size);
    if (plan.reason === 'insufficient-land') {
      throw new Error(`Cove would leave less than ${dryCount} tiles of dry land at ${section.start.x},${section.start.y}.`);
    }
    const dryFrom = Math.floor(plan.dryStart / size);
    // Round toward the dominant shore's available gap, never into its full grade.
    const reserveFrom = Math.max(Math.ceil(plan.first / size), Math.min(
      section.cells.length - Math.ceil(plan.last / size) - dryCount, dryFrom,
    ));
    for (let n = 0; n < dryCount; n++) dryCells[section.cells[reserveFrom + n]] = 1;
    sections.push({ ...section, plan: { ...plan, dryStart: reserveFrom * size } });
    for (const end of ['first', 'last'] as const) {
      const primary = section.primary === end;
      const count = primary ? gradeCells : Math.ceil(ORIGINAL_GRADE / size);
      const cells = end === 'first' ? section.cells.slice(0, count) : section.cells.slice(-count);
      candidates.push({ cells, allow: plan[end] > 0, primary });
    }
  }
  let rejectedProfiles = 0;
  const suppressed = new Uint8Array(world.cells.length), outer = new Uint8Array(world.cells.length);
  const primaryGrades = new Uint8Array(world.cells.length);
  for (const candidate of candidates) {
    const conflict = candidate.cells.some(i => dryCells[i] || protectedCell(i));
    if (!candidate.primary) for (const i of candidate.cells) outer[i] = 1;
    if (candidate.allow && !conflict) {
      if (candidate.primary) for (const i of candidate.cells) primaryGrades[i] = 1;
      continue;
    }
    rejectedProfiles++;
    for (const i of candidate.cells) if (!protectedCell(i)) suppressed[i] = 1;
  }
  for (let i = 0; i < world.cells.length; i++) {
    if (suppressed[i]) world.heights[i] = Math.max(world.heights[i], BEACH_LEVEL + 0.01);
  }
  const maskWorld = { ...world, heights: world.heights.slice() };
  for (let i = 0; i < outer.length; i++) if (outer[i]) maskWorld.heights[i] = BEACH_LEVEL + 0.01;
  const shore = createIslandShoreField(maskWorld);
  const spacing = 2;
  const origin = {
    x: Math.floor((cove.center.x - cove.radius.x - cove.shelfWidth) / spacing) * spacing,
    y: Math.floor((cove.center.y - cove.radius.y - cove.shelfWidth) / spacing) * spacing,
  };
  const width = Math.ceil((cove.radius.x + cove.shelfWidth) * 2 / spacing) + 1;
  const height = Math.ceil((cove.radius.y + cove.shelfWidth) * 2 / spacing) + 1;
  const weights = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const px = origin.x + x * spacing, py = origin.y + y * spacing;
    const cx = Math.floor(px / size), cy = Math.floor(py / size), cell = cy * world.width + cx;
    // Ownership stays with the granted beach through its entire inland grade,
    // even where the opposite shore becomes geometrically closer.
    if (cx >= 0 && cy >= 0 && cx < world.width && cy < world.height && primaryGrades[cell] && !suppressed[cell]) {
      weights[y * width + x] = 1;
      continue;
    }
    const sample = shore.sample(px, py);
    const t = Math.max(0, Math.min(1, (sample.beachWeight - 0.5) / 0.4));
    weights[y * width + x] = t * t * (3 - 2 * t);
  }
  const focusSection = sections.find(section => section.cells.length >= gradeCells + dryCount) ?? sections[0];
  const focusIndex = focusSection?.cells[Math.floor(focusSection.cells.length / 2)];
  const focus = focusIndex === undefined ? cove.focus
    : { x: (focusIndex % world.width + 0.5) * size, y: (Math.floor(focusIndex / world.width) + 0.5) * size };
  world.generatorVersion = `${world.generatorVersion}-coordinated-coasts-v1`;
  return {
    world, cove: { ...cove, shoreMask: { origin, spacing, width, height, weights } },
    budget: { dryCells, sections, restoredCells, rejectedProfiles, focus },
  };
}
