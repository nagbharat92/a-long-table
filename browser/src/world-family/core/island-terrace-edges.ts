import type { Point, Rectangle, World } from './contracts';
import type { IslandAscent } from './island-ascents';
import { islandLevelHeights, validateIslandHeights } from './island-heights';

export interface IslandTerraceEdgePatch {
  cell: Point;
  fromLevel: number;
  toLevel: number;
  polygon: Point[];
  kind: 'cut' | 'fill';
}

export interface IslandTerraceEdges {
  enabled: boolean;
  patches: IslandTerraceEdgePatch[];
  byCell: ReadonlyMap<number, readonly IslandTerraceEdgePatch[]>;
  cutCorners: number;
  fillCorners: number;
  protectedCorners: number;
}

function expanded(rect: Rectangle, margin: number, scale = 1): Rectangle {
  return {
    x: rect.x * scale - margin,
    y: rect.y * scale - margin,
    width: rect.width * scale + margin * 2,
    height: rect.height * scale + margin * 2,
  };
}

/** SAT includes touching reservations, so even the chamfer's boundary stays clear. */
function touchesRectangle(polygon: Point[], rect: Rectangle): boolean {
  const corners = [
    { x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
  const axes = [{ x: 1, y: 0 }, { x: 0, y: 1 }];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    axes.push({ x: a.y - b.y, y: b.x - a.x });
  }
  return axes.every(axis => {
    const a = polygon.map(p => p.x * axis.x + p.y * axis.y);
    const b = corners.map(p => p.x * axis.x + p.y * axis.y);
    return Math.max(...a) >= Math.min(...b) && Math.max(...b) >= Math.min(...a);
  });
}

/**
 * Pure, opt-in V2 plan conditioning; it never edits source ranks or land masks.
 * Each eligible 2x2 corner exchanges one eighth of its exceptional cell's area
 * between adjacent ranks. Half-cell legs join neighboring chamfers at edge
 * midpoints without overlapping, and leave all cell centers untouched.
 * Saddles, straight boundaries and corners involving three ranks are unchanged.
 * protectedCorners counts otherwise eligible corners rejected by land/reservations.
 */
export function createIslandTerraceEdges(
  world: World, ascents: readonly IslandAscent[], enabled = true,
): IslandTerraceEdges {
  const byCell = new Map<number, IslandTerraceEdgePatch[]>();
  const result: IslandTerraceEdges = {
    enabled, patches: [], byCell, cutCorners: 0, fillCorners: 0, protectedCorners: 0,
  };
  if (!enabled) return result;
  const { width, height, tileSize: size, elevations } = world;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
    || !Number.isFinite(size) || size <= 0 || !elevations
    || elevations.length !== width * height || world.cells.length !== width * height) {
    throw new Error('Island terrace edges require a valid land/rank grid and positive tile size.');
  }
  validateIslandHeights(world);
  const levelCount = islandLevelHeights(world).length;
  if (elevations.some(level => level >= levelCount)) {
    throw new Error('Island terrace edge rank has no surface height.');
  }
  const reservations = [
    ...ascents.map(ascent => expanded(ascent.bounds, size)),
    ...(world.ramps ?? []).map(ramp => expanded(ramp.rect, size, size)),
  ];
  if (reservations.some(rect => !Object.values(rect).every(Number.isFinite)
    || rect.width < size * 2 || rect.height < size * 2)) {
    throw new Error('Island terrace edge reservations must have finite, nonnegative bounds.');
  }
  const inland = (cell: Point): boolean => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = cell.x + dx, y = cell.y + dy;
        if (x < 0 || y < 0 || x >= width || y >= height || !world.cells[y * width + x]) return false;
      }
    }
    return true;
  };
  for (let y = 1; y < height; y++) {
    for (let x = 1; x < width; x++) {
      const cells = [
        { x: x - 1, y: y - 1 }, { x, y: y - 1 },
        { x, y }, { x: x - 1, y },
      ];
      const levels = cells.map(cell => elevations[cell.y * width + cell.x]);
      const low = Math.min(...levels), high = Math.max(...levels);
      if (high !== low + 1) continue;
      const highCount = levels.filter(level => level === high).length;
      if (highCount !== 1 && highCount !== 3) continue;
      const kind = highCount === 1 ? 'cut' : 'fill';
      const fromLevel = kind === 'cut' ? high : low;
      const toLevel = kind === 'cut' ? low : high;
      const cell = cells[levels.indexOf(fromLevel)];
      const corner = { x: x * size, y: y * size };
      const dx = cell.x < x ? -size / 2 : size / 2;
      const dy = cell.y < y ? -size / 2 : size / 2;
      const horizontal = { x: corner.x + dx, y: corner.y };
      const vertical = { x: corner.x, y: corner.y + dy };
      const polygon = dx * dy > 0
        ? [corner, horizontal, vertical] : [corner, vertical, horizontal];
      if (!inland(cell) || reservations.some(rect => touchesRectangle(polygon, rect))) {
        result.protectedCorners++;
        continue;
      }
      const patch: IslandTerraceEdgePatch = { cell, fromLevel, toLevel, polygon, kind };
      result.patches.push(patch);
      const index = cell.y * width + cell.x;
      const patches = byCell.get(index);
      if (patches) patches.push(patch);
      else byCell.set(index, [patch]);
      if (kind === 'cut') result.cutCorners++;
      else result.fillCorners++;
    }
  }
  return result;
}

/**
 * World-XY point query, returning logical rank, not physical height. Patch edges
 * belong to the replacement rank; callers choose the source cell at grid seams.
 * Only that cell's (at most four) triangles are examined. No world is cached.
 */
export function islandEdgeLevelAt(
  world: World, edges: IslandTerraceEdges, cell: Point, point: Point,
): number {
  if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y)
    || cell.x < 0 || cell.y < 0 || cell.x >= world.width || cell.y >= world.height
    || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error('Island terrace edge query requires a valid cell and finite point.');
  }
  const index = cell.y * world.width + cell.x;
  const level = world.elevations?.[index];
  if (level === undefined) throw new Error('Island terrace edge query requires source ranks.');
  if (!edges.enabled) return level;
  const patches = edges.byCell.get(index);
  if (!patches) return level;
  const size = world.tileSize;
  if (point.x < cell.x * size || point.x > (cell.x + 1) * size
    || point.y < cell.y * size || point.y > (cell.y + 1) * size) return level;
  for (const patch of patches) {
    if (patch.polygon.every((a, i, polygon) => {
      const b = polygon[(i + 1) % polygon.length];
      return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)
        >= -size * size * 1e-10;
    })) return patch.toLevel;
  }
  return level;
}
