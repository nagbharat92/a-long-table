import { ISLAND_MESH_LAYER_IDS } from '../core/island-layers';
import type { IslandLayerId, IslandMeshLayerId, LandTriangle, LandVertex } from '../core/landform-study';
import { projectionWeights, sampleProjectedTexture, surfaceNormal, type ProjectionWeights } from './surface-projection';

export interface IslandMeshLayerInspection {
  visible: boolean;
  materials: boolean;
  textures: boolean;
  lighting: boolean;
  wireframe: boolean;
  vertices: boolean;
  normals: boolean;
  boundaries: boolean;
  uvChecker: boolean;
  uvSeams: boolean;
}

export interface IslandWaterLayerInspection {
  visible: boolean;
  depthColor: boolean;
  colorPatches: boolean;
  seabedVisibility: boolean;
  surfaceResponse: boolean;
  surfaceHighlights: boolean;
  waves: boolean;
  shoreFoam: boolean;
  lighting: boolean;
}

export interface IslandLayersInspection {
  base: IslandMeshLayerInspection;
  uplands: IslandMeshLayerInspection;
  beaches: IslandMeshLayerInspection;
  seabed: IslandMeshLayerInspection;
  water: IslandWaterLayerInspection;
}

export interface LandDiagnostics {
  checker?: boolean;
  wireframe?: boolean;
  regions?: boolean;
  groundMask?: boolean;
  layers?: IslandLayersInspection;
}

export const DEFAULT_MESH_LAYER_INSPECTION: Readonly<IslandMeshLayerInspection> = {
  visible: true,
  materials: true,
  textures: true,
  lighting: true,
  wireframe: false,
  vertices: false,
  normals: false,
  boundaries: false,
  uvChecker: false,
  uvSeams: false,
};

export const DEFAULT_WATER_LAYER_INSPECTION: Readonly<IslandWaterLayerInspection> = {
  visible: true,
  depthColor: true,
  colorPatches: true,
  seabedVisibility: true,
  surfaceResponse: true,
  surfaceHighlights: false,
  waves: false,
  shoreFoam: true,
  lighting: true,
};

const MESH_KEYS = Object.keys(DEFAULT_MESH_LAYER_INSPECTION) as (keyof IslandMeshLayerInspection)[];
const WATER_KEYS = Object.keys(DEFAULT_WATER_LAYER_INSPECTION) as (keyof IslandWaterLayerInspection)[];

export function createDefaultLayersInspection(): IslandLayersInspection {
  return {
    base: { ...DEFAULT_MESH_LAYER_INSPECTION },
    uplands: { ...DEFAULT_MESH_LAYER_INSPECTION },
    beaches: { ...DEFAULT_MESH_LAYER_INSPECTION },
    seabed: { ...DEFAULT_MESH_LAYER_INSPECTION },
    water: { ...DEFAULT_WATER_LAYER_INSPECTION },
  };
}

export function cloneLayersInspection(layers?: IslandLayersInspection): IslandLayersInspection {
  if (!layers) return createDefaultLayersInspection();
  return {
    base: { ...layers.base },
    uplands: { ...layers.uplands },
    beaches: { ...layers.beaches },
    seabed: { ...layers.seabed },
    water: { ...layers.water },
  };
}

export function isDefaultLayersInspection(layers?: IslandLayersInspection): boolean {
  if (!layers) return true;
  for (const id of ISLAND_MESH_LAYER_IDS) {
    for (const key of MESH_KEYS) {
      if (layers[id][key] !== DEFAULT_MESH_LAYER_INSPECTION[key]) return false;
    }
  }
  for (const key of WATER_KEYS) {
    if (layers.water[key] !== DEFAULT_WATER_LAYER_INSPECTION[key]) return false;
  }
  return true;
}

export function hasActiveMeshInspection(layers?: IslandLayersInspection): boolean {
  if (!layers) return false;
  for (const id of ISLAND_MESH_LAYER_IDS) {
    const state = layers[id];
    if (!state.visible) continue;
    if (!state.materials || !state.textures || !state.lighting
      || state.wireframe || state.vertices || state.normals
      || state.boundaries || state.uvChecker || state.uvSeams) {
      return true;
    }
  }
  return false;
}

export function layersSignature(layers?: IslandLayersInspection): string {
  if (!layers || isDefaultLayersInspection(layers)) return 'default';
  const parts: string[] = [];
  for (const id of ISLAND_MESH_LAYER_IDS) {
    const state = layers[id];
    parts.push(`${id}:${MESH_KEYS.map(key => Number(state[key])).join('')}`);
  }
  parts.push(`water:${WATER_KEYS.map(key => Number(layers.water[key])).join('')}`);
  return parts.join('|');
}

export function serializeLayersParameter(layers?: IslandLayersInspection): string | undefined {
  if (!layers || isDefaultLayersInspection(layers)) return undefined;
  const groups: string[] = [];
  for (const id of ISLAND_MESH_LAYER_IDS) {
    const diffs = MESH_KEYS.filter(key => layers[id][key] !== DEFAULT_MESH_LAYER_INSPECTION[key])
      .map(key => `${key}=${Number(layers[id][key])}`);
    if (diffs.length) groups.push(`${id}:${diffs.join(',')}`);
  }
  const waterDiffs = WATER_KEYS.filter(key => layers.water[key] !== DEFAULT_WATER_LAYER_INSPECTION[key])
    .map(key => `${key}=${Number(layers.water[key])}`);
  if (waterDiffs.length) groups.push(`water:${waterDiffs.join(',')}`);
  return groups.length ? groups.join(';') : undefined;
}

export function layersFromParameters(parameters: URLSearchParams): IslandLayersInspection {
  const result = createDefaultLayersInspection();
  const raw = parameters.get('layers');
  if (!raw) return result;
  for (const section of raw.split(';')) {
    if (!section) continue;
    const [layerId, rest] = section.split(':');
    if (!rest) continue;
    if (layerId === 'water') {
      for (const pair of rest.split(',')) {
        const [key, val] = pair.split('=') as [keyof IslandWaterLayerInspection, string];
        if (WATER_KEYS.includes(key) && (val === '0' || val === '1')) {
          result.water[key] = val === '1';
        }
      }
    } else if ((ISLAND_MESH_LAYER_IDS as readonly string[]).includes(layerId)) {
      const target = result[layerId as IslandMeshLayerId];
      for (const pair of rest.split(',')) {
        const [key, val] = pair.split('=') as [keyof IslandMeshLayerInspection, string];
        if (MESH_KEYS.includes(key) && (val === '0' || val === '1')) {
          target[key] = val === '1';
        }
      }
    }
  }
  return result;
}

export function soloIslandLayer(layers: IslandLayersInspection, target: IslandLayerId): IslandLayersInspection {
  const next = cloneLayersInspection(layers);
  const allIds: readonly IslandLayerId[] = ['base', 'uplands', 'beaches', 'seabed', 'water'];
  const alreadySolo = allIds.every(id => (id === target ? next[id].visible : !next[id].visible));
  for (const id of allIds) {
    next[id].visible = alreadySolo ? true : id === target;
  }
  return next;
}

function segmentDistance3D(point: LandVertex, a: LandVertex, b: LandVertex): number {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const lenSq = dx * dx + dy * dy + dz * dz;
  if (lenSq <= 1e-12) return Math.hypot(point.x - a.x, point.y - a.y, point.z - a.z);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy + (point.z - a.z) * dz) / lenSq));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy), point.z - (a.z + t * dz));
}

export function applyGeometryOverlayColor(
  triangle: LandTriangle,
  point: LandVertex,
  baseColor: readonly number[],
  inspection?: IslandMeshLayerInspection,
  scale = 1,
): [number, number, number] {
  let r = baseColor[0], g = baseColor[1], b = baseColor[2];
  if (!inspection) return [Math.round(r), Math.round(g), Math.round(b)];

  const [v0, v1, v2] = triangle.vertices;
  const edges = [[v0, v1], [v1, v2], [v2, v0]] as const;

  if (inspection.uvSeams) {
    const normal = surfaceNormal(triangle);
    const weights = projectionWeights(normal);
    const dominant = weights[0] >= weights[1] && weights[0] >= weights[2] ? 0 : weights[1] >= weights[2] ? 1 : 2;
    const u = dominant === 0 ? point.y : point.x;
    const v = dominant === 2 ? point.y : point.z;
    const tileSeam = Math.min(
      Math.abs(u - Math.round(u / 16) * 16),
      Math.abs(v - Math.round(v / 16) * 16),
    );
    const mixedAxis = Math.max(...weights) < 0.85;
    if (tileSeam <= 0.42 * scale || (mixedAxis && tileSeam <= 0.7 * scale)) {
      r = 52; g = 210; b = 224;
    }
  }

  if (inspection.boundaries) {
    const flags = triangle.boundaryEdges ?? [true, true, true];
    let minBoundaryDist = Infinity;
    const segments = triangle.boundarySegments
      ?? edges.flatMap(([from, to], i) => flags[i] ? [{ from, to }] : []);
    for (const { from, to } of segments) {
      const dist = segmentDistance3D(point, from, to);
      if (dist < minBoundaryDist) minBoundaryDist = dist;
    }
    if (minBoundaryDist <= 0.85 * scale) {
      r = 238; g = 108; b = 77;
    }
  }

  if (inspection.vertices) {
    const minVertexDist = Math.min(
      Math.hypot(point.x - v0.x, point.y - v0.y, point.z - v0.z),
      Math.hypot(point.x - v1.x, point.y - v1.y, point.z - v1.z),
      Math.hypot(point.x - v2.x, point.y - v2.y, point.z - v2.z),
    );
    if (minVertexDist <= 1.3 * scale) {
      r = 248; g = 214; b = 72;
    } else if (minVertexDist <= 1.85 * scale) {
      r = 25; g = 38; b = 42;
    }
  }

  return [Math.round(r), Math.round(g), Math.round(b)];
}

export function diagnosticSetting(parameters: URLSearchParams, name: 'checker' | 'wireframe' | 'regions' | 'groundMask'): boolean {
  const value = parameters.get(name);
  if (value !== null && value !== '0' && value !== '1') throw new Error(`Unknown ${name} diagnostic setting.`);
  return value === '1';
}

export function createProjectionChecker(squareSize = 8): (triangle: LandTriangle, point: LandVertex) => readonly number[] {
  if (!Number.isFinite(squareSize) || squareSize <= 0) throw new Error('Checker square size must be finite and positive.');
  const weights = new WeakMap<LandTriangle, ProjectionWeights>();
  const checker = (u: number, v: number) => ((Math.floor(u / squareSize) + Math.floor(v / squareSize)) % 2 + 2) % 2;
  return (triangle, point) => {
    let blend = weights.get(triangle);
    if (!blend) {
      blend = projectionWeights(surfaceNormal(triangle));
      weights.set(triangle, blend);
    }
    return sampleProjectedTexture(point, blend, (u, v) => {
      const value = 92 + checker(u, v) * 140;
      return [value, value, value];
    }).map(Math.round);
  };
}
