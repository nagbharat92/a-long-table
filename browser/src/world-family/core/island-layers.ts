import type { World } from './contracts';
import { islandHeightAtLevel } from './island-heights';
import { intersectIslandPolygon, islandColumnTriangles, subtractIslandPolygon, type IslandSurfacePolygon } from './island-columns';
import { ascentSectionHeightAt, ascentSectionPolygon, ascentSurfaceSections, type IslandAscent } from './island-ascents';
import type { IslandTerraceEdges } from './island-terrace-edges';
import type { IslandBeachShelf } from './island-beach-shelf';
import { optimizeLandformMesh } from './landform-mesh';
import type { IslandLayerId, IslandMeshLayerId, LandBoundarySegment, LandTriangle, LandVertex } from './landform-study';
import { openMeshEdges } from './mesh-boundaries';
import type { IslandUplandShoulders } from './island-upland-shoulders';

export const ISLAND_MESH_LAYER_IDS: readonly IslandMeshLayerId[] = ['base', 'uplands', 'beaches', 'seabed'];
export const ISLAND_LAYER_IDS: readonly IslandLayerId[] = ['base', 'uplands', 'beaches', 'seabed', 'water'];

export const ISLAND_LAYER_LABELS: Record<IslandLayerId, string> = {
  base: 'Base',
  uplands: 'Uplands',
  beaches: 'Beaches',
  seabed: 'Seabed',
  water: 'Water',
};

export type IslandBoundarySegment = LandBoundarySegment;

export interface IslandMeshLayer {
  id: IslandMeshLayerId;
  label: string;
  triangles: LandTriangle[];
  standaloneTriangles: LandTriangle[];
  vertices: LandVertex[];
  boundaries: IslandBoundarySegment[];
}

export type IslandMeshLayers = Record<IslandMeshLayerId, IslandMeshLayer> & {
  base: IslandMeshLayer & {
    withoutUplandsTriangles: LandTriangle[];
    withoutBeachesTriangles: LandTriangle[];
  };
};

export interface IslandLayerSource {
  world: World;
  triangles: LandTriangle[];
  ascents?: readonly IslandAscent[];
  edges?: IslandTerraceEdges;
  shoulders?: IslandUplandShoulders;
  beach: Pick<IslandBeachShelf, 'underwaterTriangles'> & Partial<Pick<IslandBeachShelf, 'landSurfaces'>>;
}

const EPSILON = 1e-6;
const coordKey = (value: number) => Math.round(value / EPSILON);
const vertexKey = (point: LandVertex) => `${coordKey(point.x)},${coordKey(point.y)},${coordKey(point.z)}`;

export function classifyTriangleLayer(triangle: LandTriangle): IslandMeshLayerId {
  if (triangle.submerged) return 'seabed';
  if (triangle.layer) return triangle.layer;
  if (triangle.level > 0 || triangle.ascentId !== undefined) return 'uplands';
  if (triangle.vertices.some(v => v.z < -EPSILON && v.z > -4 + EPSILON)) return 'beaches';
  if (triangle.plane !== 'top' && ((triangle.wallTop ?? 0) < -EPSILON || (triangle.wallBottom ?? -4) > -4 + EPSILON)) {
    return 'beaches';
  }
  return 'base';
}

function uniqueVertices(triangles: readonly LandTriangle[]): LandVertex[] {
  const seen = new Map<string, LandVertex>();
  for (const triangle of triangles) {
    for (const vertex of triangle.vertices) {
      const id = vertexKey(vertex);
      if (!seen.has(id)) seen.set(id, vertex);
    }
  }
  return [...seen.values()];
}

/**
 * Computes open/perimeter boundary edges for a mesh layer's surface faces so
 * interior triangulation diagonals are excluded from Mesh boundaries inspection.
 */
export function annotateLayerMesh(
  sourceTriangles: readonly LandTriangle[],
  layer: IslandMeshLayerId,
): { triangles: LandTriangle[]; boundaries: IslandBoundarySegment[] } {
  const surfaceEdges: (LandBoundarySegment & { triangle: number; index: number })[] = [];
  sourceTriangles.forEach((triangle, triangleIndex) => {
    if (triangle.plane !== 'top') return;
    for (let i = 0; i < 3; i++) {
      surfaceEdges.push({ from: triangle.vertices[i], to: triangle.vertices[(i + 1) % 3], triangle: triangleIndex, index: i });
    }
  });
  const exposed = openMeshEdges(surfaceEdges, EPSILON);
  const byTriangle = new Map<number, typeof exposed>();
  for (const segment of exposed) {
    const list = byTriangle.get(segment.edge.triangle) ?? [];
    list.push(segment);
    byTriangle.set(segment.edge.triangle, list);
  }
  const boundaries: IslandBoundarySegment[] = [];
  const triangles = sourceTriangles.map((triangle, triangleIndex) => {
    const [a, b, c] = triangle.vertices;
    const pairs = [[a, b], [b, c], [c, a]] as const;
    const flags: [boolean, boolean, boolean] = [false, false, false];
    let boundarySegments: LandBoundarySegment[] | undefined;
    if (triangle.plane === 'top') {
      boundarySegments = (byTriangle.get(triangleIndex) ?? []).map(({ edge, from, to }) => {
        flags[edge.index] = true;
        return { from, to };
      });
      boundaries.push(...boundarySegments);
    } else {
      const top = triangle.wallTop ?? Math.max(a.z, b.z, c.z);
      const bottom = triangle.wallBottom ?? Math.min(a.z, b.z, c.z);
      pairs.forEach(([p, q], index) => {
        const onRim = (Math.abs(p.z - top) <= EPSILON && Math.abs(q.z - top) <= EPSILON)
          || (Math.abs(p.z - bottom) <= EPSILON && Math.abs(q.z - bottom) <= EPSILON);
        flags[index] = onRim;
      });
    }
    return {
      ...triangle,
      layer,
      boundaryEdges: flags,
      boundarySegments,
    };
  });
  return { triangles, boundaries };
}

export function annotateIslandTriangles(
  combinedTriangles: readonly LandTriangle[],
  underwaterTriangles: readonly LandTriangle[],
): {
  triangles: LandTriangle[];
  underwaterTriangles: LandTriangle[];
  partitioned: Record<IslandMeshLayerId, { triangles: LandTriangle[]; boundaries: IslandBoundarySegment[] }>;
} {
  const byLayer: Record<IslandMeshLayerId, LandTriangle[]> = {
    base: [],
    uplands: [],
    beaches: [],
    seabed: [],
  };
  const tags = combinedTriangles.map(triangle => {
    const layer = classifyTriangleLayer(triangle);
    byLayer[layer].push(triangle);
    return layer;
  });
  const partitioned: Record<IslandMeshLayerId, { triangles: LandTriangle[]; boundaries: IslandBoundarySegment[] }> = {
    base: annotateLayerMesh(byLayer.base, 'base'),
    uplands: annotateLayerMesh(byLayer.uplands, 'uplands'),
    beaches: annotateLayerMesh(byLayer.beaches, 'beaches'),
    seabed: annotateLayerMesh(underwaterTriangles, 'seabed'),
  };
  const cursors: Record<IslandMeshLayerId, number> = { base: 0, uplands: 0, beaches: 0, seabed: 0 };
  const triangles = tags.map(layer => partitioned[layer].triangles[cursors[layer]++]);
  return {
    triangles,
    underwaterTriangles: partitioned.seabed.triangles,
    partitioned,
  };
}

const layersCache = new WeakMap<object, IslandMeshLayers>();

export function islandMeshLayers(island: IslandLayerSource): IslandMeshLayers {
  const cached = layersCache.get(island.triangles);
  if (cached) return cached;

  const { partitioned } = annotateIslandTriangles(island.triangles, island.beach.underwaterTriangles);
  const { world } = island;
  const size = world.tileSize;
  const beachSurfacesByCell = island.beach.landSurfaces ?? new Map<number, readonly IslandSurfacePolygon[]>();
  const ascents = island.ascents ?? [];
  const edges = island.edges;

  const baseFoundationSurfaces: IslandSurfacePolygon[] = [];
  const baseWithoutUplandsSurfaces: IslandSurfacePolygon[] = [];
  const baseWithoutBeachesSurfaces: IslandSurfacePolygon[] = [];
  const uplandSurfaces: IslandSurfacePolygon[] = [];
  const patches = ascents.flatMap(ascent => ascentSurfaceSections(ascent).map(section => {
    const polygon = ascentSectionPolygon(ascent, section);
    return {
      ascent, section, polygon,
      minX: Math.min(...polygon.map(p => p.x)), maxX: Math.max(...polygon.map(p => p.x)),
      minY: Math.min(...polygon.map(p => p.y)), maxY: Math.max(...polygon.map(p => p.y)),
    };
  }));

  if (world.elevations) {
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        const index = y * world.width + x;
        if (!world.cells[index]) continue;
        const cell = [
          { x: x * size, y: y * size }, { x: (x + 1) * size, y: y * size },
          { x: (x + 1) * size, y: (y + 1) * size }, { x: x * size, y: (y + 1) * size },
        ];
        const foundation: IslandSurfacePolygon = {
          level: 0,
          layer: 'base',
          vertices: cell.map(point => ({ ...point, z: 0 })),
        };
        baseFoundationSurfaces.push(foundation);
        const beachCell = beachSurfacesByCell.get(index);
        if (beachCell) {
          baseWithoutBeachesSurfaces.push(foundation);
          continue;
        }
        baseWithoutUplandsSurfaces.push(foundation);
        const shoulder = island.shoulders?.byCell.get(index);
        if (shoulder) {
          uplandSurfaces.push(shoulder);
          continue;
        }
        const level = world.elevations[index];
        const height = islandHeightAtLevel(world, level);
        let remaining = [cell];
        for (const patch of edges?.byCell.get(index) ?? []) {
          const patchHeight = islandHeightAtLevel(world, patch.toLevel);
          if (patch.toLevel > 0) {
            uplandSurfaces.push({
              level: patch.toLevel,
              layer: 'uplands',
              vertices: patch.polygon.map(point => ({ ...point, z: patchHeight })),
            });
          } else {
            baseWithoutBeachesSurfaces.push({
              level: 0, layer: 'base',
              vertices: patch.polygon.map(point => ({ ...point, z: 0 })),
            });
          }
          remaining = remaining.flatMap(polygon => subtractIslandPolygon(polygon, patch.polygon));
        }
        for (const patch of patches) {
          if (patch.maxX <= x * size || patch.minX >= (x + 1) * size
            || patch.maxY <= y * size || patch.minY >= (y + 1) * size) continue;
          const clipped = intersectIslandPolygon(cell, patch.polygon);
          if (!clipped.length) continue;
          const { ascent, section } = patch;
          const vertices = clipped.map(point => {
            return { ...point, z: ascentSectionHeightAt(ascent, section, point) };
          });
          uplandSurfaces.push({ level, ascentId: ascent.id, layer: 'uplands', vertices });
          remaining = remaining.flatMap(polygon => subtractIslandPolygon(polygon, patch.polygon));
        }
        if (level > 0) {
          for (const polygon of remaining) {
            uplandSurfaces.push({
              level,
              layer: 'uplands',
              vertices: polygon.map(point => ({ ...point, z: height })),
            });
          }
        } else {
          for (const polygon of remaining) {
            baseWithoutBeachesSurfaces.push({
              level: 0, layer: 'base',
              vertices: polygon.map(point => ({ ...point, z: 0 })),
            });
          }
        }
      }
    }
  }

  const beachSurfaces = [...beachSurfacesByCell.values()]
    .flat()
    .map(surface => ({ ...surface, layer: 'beaches' as const }));

  const buildStandalone = (surfaces: readonly IslandSurfacePolygon[], floor: number, fallback: LandTriangle[]): LandTriangle[] => {
    if (!surfaces.length) return fallback;
    return optimizeLandformMesh(islandColumnTriangles(surfaces, floor));
  };

  const standaloneBase = annotateLayerMesh(
    buildStandalone(baseFoundationSurfaces, -4, partitioned.base.triangles),
    'base',
  );
  const baseWithoutUplands = annotateLayerMesh(
    buildStandalone(baseWithoutUplandsSurfaces, -4, partitioned.base.triangles),
    'base',
  );
  const baseWithoutBeaches = annotateLayerMesh(
    buildStandalone(baseWithoutBeachesSurfaces, -4, partitioned.base.triangles),
    'base',
  );
  const standaloneUplands = annotateLayerMesh(
    buildStandalone(uplandSurfaces, 0, partitioned.uplands.triangles),
    'uplands',
  );
  const standaloneBeaches = annotateLayerMesh(
    buildStandalone(beachSurfaces, -4, partitioned.beaches.triangles),
    'beaches',
  );

  const result: IslandMeshLayers = {
    base: {
      id: 'base',
      label: ISLAND_LAYER_LABELS.base,
      triangles: partitioned.base.triangles,
      standaloneTriangles: standaloneBase.triangles,
      withoutUplandsTriangles: baseWithoutUplands.triangles,
      withoutBeachesTriangles: baseWithoutBeaches.triangles,
      vertices: uniqueVertices(standaloneBase.triangles),
      boundaries: partitioned.base.boundaries,
    },
    uplands: {
      id: 'uplands',
      label: ISLAND_LAYER_LABELS.uplands,
      triangles: partitioned.uplands.triangles,
      standaloneTriangles: standaloneUplands.triangles,
      vertices: uniqueVertices(standaloneUplands.triangles),
      boundaries: partitioned.uplands.boundaries,
    },
    beaches: {
      id: 'beaches',
      label: ISLAND_LAYER_LABELS.beaches,
      triangles: partitioned.beaches.triangles,
      standaloneTriangles: standaloneBeaches.triangles,
      vertices: uniqueVertices(standaloneBeaches.triangles),
      boundaries: partitioned.beaches.boundaries,
    },
    seabed: {
      id: 'seabed',
      label: ISLAND_LAYER_LABELS.seabed,
      triangles: partitioned.seabed.triangles,
      standaloneTriangles: partitioned.seabed.triangles,
      vertices: uniqueVertices(partitioned.seabed.triangles),
      boundaries: partitioned.seabed.boundaries,
    },
  };
  layersCache.set(island.triangles, result);
  return result;
}

const annotatedLandCache = new WeakMap<readonly LandTriangle[], LandTriangle[]>();
const annotatedSeabedCache = new WeakMap<readonly LandTriangle[], LandTriangle[]>();

export function activeIslandLandTriangles(
  island: IslandLayerSource,
  visibility?: Partial<Record<IslandMeshLayerId, boolean>>,
): LandTriangle[] {
  const baseVisible = visibility?.base !== false;
  const uplandsVisible = visibility?.uplands !== false;
  const beachesVisible = visibility?.beaches !== false;
  if (baseVisible && uplandsVisible && beachesVisible) {
    if (island.triangles.length <= 2) return island.triangles;
    let cached = annotatedLandCache.get(island.triangles);
    if (!cached) {
      cached = annotateIslandTriangles(island.triangles, island.beach.underwaterTriangles).triangles;
      annotatedLandCache.set(island.triangles, cached);
    }
    return cached;
  }
  if (!baseVisible && !uplandsVisible && !beachesVisible) {
    return [];
  }
  const layers = islandMeshLayers(island);
  const triangles: LandTriangle[] = [];
  if (baseVisible) {
    const base = !uplandsVisible && !beachesVisible ? layers.base.standaloneTriangles
      : !uplandsVisible ? layers.base.withoutUplandsTriangles
      : !beachesVisible ? layers.base.withoutBeachesTriangles : layers.base.triangles;
    triangles.push(...base);
  }
  if (uplandsVisible) {
    triangles.push(...(!baseVisible ? layers.uplands.standaloneTriangles : layers.uplands.triangles));
  }
  if (beachesVisible) {
    triangles.push(...(!baseVisible ? layers.beaches.standaloneTriangles : layers.beaches.triangles));
  }
  return triangles;
}

export function activeIslandSeabedTriangles(
  island: IslandLayerSource,
  visibility?: Partial<Record<IslandMeshLayerId, boolean>>,
): LandTriangle[] {
  if (visibility?.seabed === false) return [];
  const source = island.beach.underwaterTriangles;
  if (source.length <= 2) return source;
  let cached = annotatedSeabedCache.get(source);
  if (!cached) {
    cached = annotateLayerMesh(source, 'seabed').triangles;
    annotatedSeabedCache.set(source, cached);
  }
  return cached;
}
