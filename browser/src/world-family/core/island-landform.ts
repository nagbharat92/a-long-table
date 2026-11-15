import type { Point, TerrainKind, World } from './contracts';
import { BEACH_LEVEL, SHALLOW_LEVEL } from './world';
import type { LandTriangle, LandVertex } from './landform-study';
import { optimizeLandformMesh } from './landform-mesh';
import { islandHeightAtLevel, islandLevelHeights, validateIslandHeights } from './island-heights';
import { generateTerracedIslandWorld } from './island-terraces';
import { ascentHeightAt, ascentSectionHeightAt, ascentSectionPolygon, ascentSurfaceSections, createIslandAscents, type IslandAscent } from './island-ascents';
import { intersectIslandPolygon, subtractIslandPolygon, islandColumnTriangles, type IslandSurfacePolygon } from './island-columns';
import { createIslandTerraceEdges, islandEdgeLevelAt, type IslandTerraceEdges } from './island-terrace-edges';
import { createIslandBeachShelf, islandBeachHeightAt, type IslandBeachShelf } from './island-beach-shelf';
import { createIslandCove, type IslandCove } from './island-cove';
import { coordinateIslandCoasts, type IslandCoastBudget } from './island-coast-budget';
import type { IslandProceduralCoast } from './island-coast-profile';
import { generateIslandCoasts, type IslandCoastStats } from './island-coasts';
import { createIslandUplandShoulders, islandShoulderHeightAt, type IslandUplandShoulders } from './island-upland-shoulders';
import { createIslandNaturalAscent } from './island-natural-ascent';

export { ISLAND_LEVEL_HEIGHTS } from './island-heights';
export {
  ISLAND_LAYER_IDS,
  ISLAND_LAYER_LABELS,
  ISLAND_MESH_LAYER_IDS,
  activeIslandLandTriangles,
  activeIslandSeabedTriangles,
  classifyTriangleLayer,
  islandMeshLayers,
  type IslandBoundarySegment,
  type IslandMeshLayer,
  type IslandMeshLayers,
} from './island-layers';
export interface IslandLandform {
  world: World;
  triangles: LandTriangle[];
  placements: LandVertex[];
  sourceTriangleCount: number;
  ascents: IslandAscent[];
  edges: IslandTerraceEdges;
  beach: IslandBeachShelf;
  shoulders: IslandUplandShoulders;
  naturalAscent?: { status: 'placed' | 'unsupported'; ascentId?: number };
  cove?: IslandCove;
  coast?: IslandProceduralCoast;
  coastStats?: IslandCoastStats;
  coastBudget?: IslandCoastBudget;
}
export interface IslandLandformOptions {
  optimize?: boolean; conditionEdges?: boolean; cove?: IslandCove; coastBudget?: IslandCoastBudget;
  coast?: IslandProceduralCoast; coastStats?: IslandCoastStats;
  uplandShoulders?: boolean;
  naturalAscent?: boolean;
}

export function islandAscentAt(ascents: readonly IslandAscent[], point: Point): IslandAscent | undefined {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Ascent queries require finite world coordinates.');
  return ascents.find(ascent => point.x >= ascent.bounds.x - 1e-8 && point.x <= ascent.bounds.x + ascent.bounds.width + 1e-8
    && point.y >= ascent.bounds.y - 1e-8 && point.y <= ascent.bounds.y + ascent.bounds.height + 1e-8
    && ascentHeightAt(ascent, point) !== undefined);
}

export function islandTerrainAt(world: World, cell: Point, point: Point, ascents: readonly IslandAscent[]): TerrainKind {
  const ascent = islandAscentAt(ascents, point);
  if (ascent) return ascent.kind === 'gully' ? 'grass' : 'sand';
  const relative = world.heights[cell.y * world.width + cell.x] - world.seaLevel;
  return relative > BEACH_LEVEL ? 'grass' : relative > 0 ? 'sand' : relative > SHALLOW_LEVEL ? 'shallow' : 'deep';
}

export function islandSurfaceHeight(
  world: World, cell: Point, point: Point, ascents: readonly IslandAscent[], edges: IslandTerraceEdges, beach: IslandBeachShelf,
  shoulders: IslandUplandShoulders,
): number {
  const index = cell.y * world.width + cell.x;
  const level = world.elevations?.[index];
  if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y) || cell.x < 0 || cell.y < 0
    || cell.x >= world.width || cell.y >= world.height || level === undefined || level >= islandLevelHeights(world).length || !world.cells[index]) {
    throw new Error('Island surface queries require a generated land cell with elevations.');
  }
  const ascent = islandAscentAt(ascents, point);
  if (ascent) return ascentHeightAt(ascent, point)!;
  return islandShoulderHeightAt(world, shoulders, cell, point)
    ?? islandBeachHeightAt(world, beach, cell, point)
    ?? islandHeightAtLevel(world, islandEdgeLevelAt(world, edges, cell, point));
}

export function buildIslandLandform(world: World, options: IslandLandformOptions = {}): IslandLandform {
  if (!world.elevations || !world.ramps || !world.rampIds) {
    throw new Error('Full-island geometry requires the existing connected island generator.');
  }
  validateIslandHeights(world);
  for (const level of new Set(world.elevations)) islandHeightAtLevel(world, level);
  let ascents = createIslandAscents(world);
  const edges = createIslandTerraceEdges(world, ascents, options.conditionEdges === true);
  const beach = createIslandBeachShelf(world, ascents, options.coast ?? options.cove, options.coastBudget);
  const shoulders: IslandUplandShoulders = options.uplandShoulders === false
    ? { patches: [], byCell: new Map() } : createIslandUplandShoulders(world, ascents, beach, edges);
  const natural = options.naturalAscent && !edges.enabled ? createIslandNaturalAscent(world, ascents, beach, shoulders) : undefined;
  const naturalAscent: IslandLandform['naturalAscent'] = options.naturalAscent
    ? { status: natural ? 'placed' : 'unsupported', ascentId: natural?.id } : undefined;
  if (natural) ascents = ascents.map(ascent => ascent.id === natural.id ? natural : ascent);
  const patches = ascents.flatMap(ascent => ascentSurfaceSections(ascent).map(section => {
    const polygon = ascentSectionPolygon(ascent, section);
    return {
      ascent, section, polygon,
      minX: Math.min(...polygon.map(p => p.x)), maxX: Math.max(...polygon.map(p => p.x)),
      minY: Math.min(...polygon.map(p => p.y)), maxY: Math.max(...polygon.map(p => p.y)),
    };
  }));
  const surfaces: IslandSurfacePolygon[] = [];
  const placements: LandVertex[] = [];
  const placementScores: number[] = [];
  const size = world.tileSize;
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const index = y * world.width + x;
      if (!world.cells[index]) continue;
      const level = world.elevations[index];
      const height = islandHeightAtLevel(world, level);
      const cell = [
        { x: x * size, y: y * size }, { x: (x + 1) * size, y: y * size },
        { x: (x + 1) * size, y: (y + 1) * size }, { x: x * size, y: (y + 1) * size },
      ];
      const beachSurfaces = beach.landSurfaces.get(index);
      const shoulder = shoulders.byCell.get(index);
      if (shoulder) {
        surfaces.push(shoulder);
        continue;
      }
      if (beachSurfaces) surfaces.push(...beachSurfaces);
      let remaining = beachSurfaces ? [] : [cell];
      for (const patch of edges.byCell.get(index) ?? []) {
        if (beachSurfaces) throw new Error('Beach grading overlaps a protected terrace edge.');
        const height = islandHeightAtLevel(world, patch.toLevel);
        surfaces.push({ level: patch.toLevel, vertices: patch.polygon.map(point => ({ ...point, z: height })) });
        remaining = remaining.flatMap(polygon => subtractIslandPolygon(polygon, patch.polygon));
      }
      for (const patch of patches) {
        if (patch.maxX <= x * size || patch.minX >= (x + 1) * size
          || patch.maxY <= y * size || patch.minY >= (y + 1) * size) continue;
        const clipped = intersectIslandPolygon(cell, patch.polygon);
        if (!clipped.length) continue;
        if (beachSurfaces) throw new Error('Beach grading overlaps a protected stair footprint.');
        const { ascent, section } = patch;
        surfaces.push({
          level, ascentId: ascent.id,
          vertices: clipped.map(point => {
            return { ...point, z: ascentSectionHeightAt(ascent, section, point) };
          }),
        });
        remaining = remaining.flatMap(polygon => subtractIslandPolygon(polygon, patch.polygon));
      }
      for (const polygon of remaining) surfaces.push({ level, vertices: polygon.map(point => ({ ...point, z: height })) });
      const center = { x: (x + 0.5) * size, y: (y + 0.5) * size };
      if (!world.cliffCells?.[index] && !islandAscentAt(ascents, center)) {
        const supported = [-2, 0, 2].every(dy => [-2, 0, 2].every(dx => {
          const nx = x + dx, ny = y + dy, next = ny * world.width + nx;
          return nx >= 0 && ny >= 0 && nx < world.width && ny < world.height
            && world.cells[next] && world.elevations![next] === level
            && !islandAscentAt(ascents, { x: (nx + 0.5) * size, y: (ny + 0.5) * size });
        }));
        const score = (supported ? 10000 : 0) - Math.hypot(x - world.width / 2, y - world.height * 0.65);
        if (score > (placementScores[level] ?? -Infinity)) {
          placementScores[level] = score;
          placements[level] = { ...center, z: islandBeachHeightAt(world, beach, { x, y }, center) ?? height };
        }
      }
    }
  }
  const triangles = islandColumnTriangles(surfaces);
  return {
    world, triangles: options.optimize === false ? triangles : optimizeLandformMesh(triangles),
    placements: placements.filter(Boolean), sourceTriangleCount: triangles.length, ascents, edges, beach, cove: options.cove,
    coastBudget: options.coastBudget,
    coast: options.coast, coastStats: options.coastStats, shoulders, naturalAscent,
  };
}

export function generateIslandLandform(
  seed: number, options: IslandLandformOptions & {
    pilotCove?: boolean; coordinateCoasts?: boolean; coastalGeneration?: boolean;
  } = {},
): IslandLandform {
  if (options.coordinateCoasts && !options.pilotCove) throw new Error('Coast coordination requires the opt-in cove study.');
  const original = generateTerracedIslandWorld(seed);
  const landformOptions = { ...options, naturalAscent: options.naturalAscent !== false };
  if (!options.pilotCove) {
    if (options.coastalGeneration === false) return buildIslandLandform(original, landformOptions);
    const { world, coast, stats } = generateIslandCoasts(original, createIslandAscents(original));
    return buildIslandLandform(world, { ...landformOptions, coast, coastStats: stats });
  }
  const { world, cove } = createIslandCove(original, createIslandAscents(original));
  if (options.coordinateCoasts) {
    const coordinated = coordinateIslandCoasts(original, world, cove, createIslandAscents(world));
    return buildIslandLandform(coordinated.world, { ...landformOptions, cove: coordinated.cove, coastBudget: coordinated.budget });
  }
  return buildIslandLandform(world, { ...landformOptions, cove });
}
