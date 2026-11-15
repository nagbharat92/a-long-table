import FastNoiseLite from 'fastnoise-lite';
import type { World } from '../core/contracts';
import { buildIslandLandform, islandAscentAt, islandTerrainAt } from '../core/island-landform';
import { ascentSectionCoordinates, createIslandAscents, type IslandAscent } from '../core/island-ascents';
import type { LandTriangle, LandVertex } from '../core/landform-study';
import { createIslandGroundField, type GroundSample } from './island-ground-field';
import { createGroundBeachClearance, createIslandGroundMask } from './island-ground-mask';
import { createIslandTextures, MATERIAL_COLORS, type IslandMaterial, type TextureColor } from './island-textures';
import { closestSurfacePoint, projectionWeights, sampleProjectedTexture, surfaceNormal, type ProjectionWeights, type SurfaceNormal } from './surface-projection';
import { createIslandShoreField, type IslandShoreField } from './island-shore-field';
import { createIslandTerraceEdges, type IslandTerraceEdges } from '../core/island-terrace-edges';
import { createIslandBeachShelf, islandBeachHeightAt, type IslandBeachShelf } from '../core/island-beach-shelf';
import { createCurvedBeachMask } from './island-beach-mask';
import { createIslandSun, type IslandSun } from './island-sun';
import { islandCoastInfluence, type IslandCoastProfile } from '../core/island-coast-profile';
import {
  applyGeometryOverlayColor,
  createProjectionChecker,
  type IslandMeshLayerInspection,
  type LandDiagnostics,
} from './landform-diagnostics';

export type SurfaceColor = TextureColor;
const LIP_MATERIALS = ['turf', 'meadow', 'moss', 'earth', 'dry-sand', 'wet-sand'] as const;
type LipMaterial = typeof LIP_MATERIALS[number];
const GROUND_MATERIALS = ['turf', 'meadow', 'moss', 'dry-sand', 'wet-sand'] as const;
type GroundMaterial = typeof GROUND_MATERIALS[number];
const GREEN_MATERIALS = ['turf', 'meadow', 'moss'] as const;
type GreenMaterial = typeof GREEN_MATERIALS[number];
export const GROUND_PATCH_COLORS = {
  255: [125, 157, 67],
  245: [174, 181, 65],
  120: [94, 130, 58],
} as const satisfies Record<number, SurfaceColor>;
const SAND_START = LIP_MATERIALS.indexOf('dry-sand');
const TOP_SAND_START = GROUND_MATERIALS.indexOf('dry-sand');
const MAX_PRECISE_SHADOWS = 8192;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const mix = (a: SurfaceColor, b: SurfaceColor, weight: number): SurfaceColor => [
  a[0] + (b[0] - a[0]) * weight, a[1] + (b[1] - a[1]) * weight, a[2] + (b[2] - a[2]) * weight,
];

export function createIslandSurface(
  world: World, shore: IslandShoreField = createIslandShoreField(world),
  ascents: readonly IslandAscent[] = createIslandAscents(world),
  edges: IslandTerraceEdges = createIslandTerraceEdges(world, ascents, false),
  beach: IslandBeachShelf = createIslandBeachShelf(world, ascents),
  sunlight?: () => IslandSun,
  cove?: IslandCoastProfile,
  terrain?: readonly LandTriangle[],
  roundBeachSeams = true,
): {
  shade(triangle: LandTriangle, point: LandVertex): SurfaceColor;
  regions(triangle: LandTriangle, point: LandVertex): SurfaceColor;
  shadeLayer(
    triangle: LandTriangle,
    point: LandVertex,
    inspection?: IslandMeshLayerInspection,
    diagnostics?: LandDiagnostics,
    scale?: number,
  ): SurfaceColor;
  material(x: number, y: number): GroundMaterial;
  ground(x: number, y: number): GroundSample;
} {
  const field = createIslandGroundField(world);
  const textures = createIslandTextures(world.seed);
  const checker = createProjectionChecker();
  let groundMask: ReturnType<typeof createIslandGroundMask> | undefined;
  const channels = ['turf', 'meadow', 'moss', 'earth', 'moisture', 'shelter', 'coast', 'detail', 'grain'] as const;
  const stride = channels.length;
  const samples = new Float32Array(world.width * world.height * stride);
  const noise = new FastNoiseLite(world.seed ^ 0x4ca972d3);
  noise.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2S);
  noise.SetFrequency(1);
  interface NormalInfo extends SurfaceNormal { top: number; drop: number; weights: ProjectionWeights; skyFillScale: number }
  const normals = new WeakMap<LandTriangle, NormalInfo>();
  const preciseShadows = new Map<string, number>();
  let shadowSun: IslandSun | undefined;
  let defaultSun: IslandSun | undefined;
  const getSun = sunlight ?? (() => defaultSun ??= createIslandSun(buildIslandLandform(world).triangles));
  const width = world.width * world.tileSize, height = world.height * world.tileSize;
  const cellIndex = (x: number, y: number) =>
    Math.max(0, Math.min(world.height - 1, y)) * world.width
      + Math.max(0, Math.min(world.width - 1, x));
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const sample = field.sample((x + 0.5) * world.tileSize, (y + 0.5) * world.tileSize);
      const index = (y * world.width + x) * stride;
      channels.forEach((name, channel) => { samples[index + channel] = sample[name]; });
    }
  }
  function channelAt(px: number, py: number, channel: number): number {
    const gx = Math.max(0, Math.min(world.width - 1, px / world.tileSize - 0.5));
    const gy = Math.max(0, Math.min(world.height - 1, py / world.tileSize - 0.5));
    const x = Math.floor(gx), y = Math.floor(gy), tx = gx - x, ty = gy - y;
    const a = cellIndex(x, y) * stride, b = cellIndex(x + 1, y) * stride;
    const c = cellIndex(x, y + 1) * stride, d = cellIndex(x + 1, y + 1) * stride;
    return (samples[a + channel] * (1 - tx) + samples[b + channel] * tx) * (1 - ty)
      + (samples[c + channel] * (1 - tx) + samples[d + channel] * tx) * ty;
  }
  function lipGreenMaterial(px: number, py: number): GreenMaterial {
    const turf = Math.max(1e-8, channelAt(px, py, 0));
    const meadow = channelAt(px, py, 1) / turf, moss = channelAt(px, py, 2) / turf;
    const edge = noise.GetNoise(px / 12, py / 12) * 0.07;
    const meadowScore = meadow - 0.68 + edge, mossScore = moss - 0.35 - edge * 0.6;
    return mossScore > Math.max(0, meadowScore) ? 'moss'
      : meadowScore > 0 ? 'meadow' : 'turf';
  }
  // Cliff lips retain their original material field independently of the land tops.
  function lipGroundMaterial(px: number, py: number): LipMaterial {
    const turf = Math.max(1e-8, channelAt(px, py, 0));
    const meadow = channelAt(px, py, 1) / turf, moss = channelAt(px, py, 2) / turf;
    const worn = channelAt(px, py, 3) / turf > 0.1;
    const bare = moss < 0.2 && meadow < 0.8 && channelAt(px, py, 6) < 0.85
      && noise.GetNoise(px / 29 + 73, py / 29 - 191) > 0.56;
    return worn || bare ? 'earth' : lipGreenMaterial(px, py);
  }
  const materials = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x + 0.5, py = y + 0.5;
      const cell = { x: Math.floor(px / world.tileSize), y: Math.floor(py / world.tileSize) };
      const index = cell.y * world.width + cell.x;
      if (!world.cells[index]) continue;
      let material: LipMaterial;
      if (islandTerrainAt(world, cell, { x: px, y: py }, ascents) === 'sand') {
        const coast = shore.sample(px, py);
        const transition = clamp((coast.beachWeight - 0.5) / 0.4);
        const wetWidth = coast.wetWidth * transition * transition * (3 - 2 * transition);
        const wet = (world.elevations?.[index] ?? 0) === 0 && (world.rampIds?.[index] ?? -1) < 0
          && coast.kind === 'beach' && coast.beachWeight > 0.5
          && coast.distance <= 0 && -coast.distance <= wetWidth;
        material = wet ? 'wet-sand' : 'dry-sand';
      } else {
        material = lipGroundMaterial(px, py);
        const ascent = islandAscentAt(ascents, { x: px, y: py });
        if (ascent?.kind === 'gully' && ascent.sections.some(section => {
          const { x, y } = ascentSectionCoordinates(ascent, section, { x: px, y: py });
          return x >= section.from && x <= section.to
            && Math.abs(y) < section.fromWidth * 0.22 + noise.GetNoise(px / 9, py / 9) * 1.5;
        })) material = 'earth';
      }
      materials[y * width + x] = LIP_MATERIALS.indexOf(material);
    }
  }
  const finishedMaterials = cove && !roundBeachSeams ? materials.slice() : undefined;
  if (cove && finishedMaterials) {
    const size = world.tileSize;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const index = y * width + x, cx = Math.floor(x / size), cy = Math.floor(y / size);
      const cell = cy * world.width + cx;
      if (!world.cells[cell] || materials[index] !== SAND_START || world.elevations?.[cell] || (world.rampIds?.[cell] ?? -1) >= 0) continue;
      const weight = islandCoastInfluence(cove, x + 0.5, y + 0.5);
      if (!weight) continue;
      let nearest = size;
      let neighbor = materials[index];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy, next = ny * world.width + nx;
        if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height || !world.cells[next]
          || world.elevations?.[next] || (world.rampIds?.[next] ?? -1) >= 0) continue;
        const material = materials[Math.floor((ny + 0.5) * size) * width + Math.floor((nx + 0.5) * size)];
        if (material >= SAND_START) continue;
        const distance = Math.hypot(Math.max(nx * size - x - 0.5, 0, x + 0.5 - (nx + 1) * size),
          Math.max(ny * size - y - 0.5, 0, y + 0.5 - (ny + 1) * size));
        if (distance < nearest) {
          nearest = distance;
          neighbor = material;
        }
      }
      const coverage = clamp(0.5 + noise.GetNoise((x + 0.5) / 12, (y + 0.5) / 12) * 0.9);
      if (nearest < size * weight * coverage) finishedMaterials[index] = neighbor;
    }
  }
  function materialIndex(x: number, y: number): number {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Material queries require finite world coordinates.');
    const px = Math.max(0, Math.min(width - 1, Math.floor(x + 1e-8)));
    const py = Math.max(0, Math.min(height - 1, Math.floor(y + 1e-8)));
    return py * width + px;
  }
  const topMaterials = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x;
    const authored = LIP_MATERIALS[(roundBeachSeams ? materials : finishedMaterials ?? materials)[index]];
    topMaterials[index] = GROUND_MATERIALS.indexOf(
      authored === 'dry-sand' || authored === 'wet-sand' ? authored : 'turf',
    );
  }
  if (cove && roundBeachSeams) {
    const ground = new Uint8Array(width * height);
    const flat = new Uint8Array(width * height).fill(1);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const cell = { x: Math.floor(x / world.tileSize), y: Math.floor(y / world.tileSize) };
      const index = cell.y * world.width + cell.x;
      // Extend sand into its adjacent water so smoothing cannot invent a grassy shoreline ribbon.
      ground[y * width + x] = Number(world.cells[index] ? materials[y * width + x] < SAND_START
        : shore.sample(x + 0.5, y + 0.5).beachWeight <= 0.5);
      if (world.cells[index] && (islandBeachHeightAt(world, beach, cell, { x: x + 0.5, y: y + 0.5 }) ?? 0) < 0) {
        flat[y * width + x] = 0;
      }
    }
    const curvedGround = createCurvedBeachMask(width, height, ground, world.seed, flat);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const index = y * width + x, px = x + 0.5, py = y + 0.5;
      const cell = { x: Math.floor(x / world.tileSize), y: Math.floor(y / world.tileSize) };
      const source = cell.y * world.width + cell.x;
      if (materials[index] > SAND_START || !world.cells[source] || world.elevations?.[source]
        || (world.rampIds?.[source] ?? -1) >= 0) continue;
      if (ascents.some(({ bounds }) => px >= bounds.x - world.tileSize && px <= bounds.x + bounds.width + world.tileSize
        && py >= bounds.y - world.tileSize && py <= bounds.y + bounds.height + world.tileSize)
        || (islandBeachHeightAt(world, beach, cell, { x: px, y: py }) ?? 0) !== 0) continue;
      if (shore.distance(px, py) > -8) {
        if (shore.sample(px, py).beachWeight > 0.5) topMaterials[index] = TOP_SAND_START;
        continue;
      }
      topMaterials[index] = GROUND_MATERIALS.indexOf(curvedGround(x, y, 1) ? 'turf' : 'dry-sand');
    }
  }
  function lipMaterial(x: number, y: number): LipMaterial {
    const index = materialIndex(x, y);
    return LIP_MATERIALS[(finishedMaterials ?? materials)[index]];
  }
  function material(x: number, y: number): GroundMaterial {
    return GROUND_MATERIALS[topMaterials[materialIndex(x, y)]];
  }
  function getGroundMask() {
    if (!groundMask) {
      const sand = Uint8Array.from(topMaterials, value => Number(value >= TOP_SAND_START));
      groundMask = createIslandGroundMask(terrain ?? buildIslandLandform(world).triangles, world.seed,
        createGroundBeachClearance(width, height, sand));
    }
    return groundMask;
  }
  function normalInfo(triangle: LandTriangle): NormalInfo {
    let result = normals.get(triangle);
    if (!result) {
      const normal = surfaceNormal(triangle);
      const top = triangle.wallTop ?? Math.max(...triangle.vertices.map(point => point.z));
      const bottom = triangle.wallBottom ?? Math.min(...triangle.vertices.map(point => point.z));
      result = {
        ...normal, weights: projectionWeights(normal),
        top, drop: Math.max(0, top - bottom),
        // Low coastal walls need a little reflected sky to avoid near-black subpixel notches.
        skyFillScale: triangle.plane !== 'top' && triangle.level === 0
          && triangle.ascentId === undefined && !triangle.submerged
          && Math.abs(normal.z) < 1e-8 ? 1.75 : 1,
      };
      normals.set(triangle, result);
    }
    return result;
  }
  function groundSurfaceMaterial(x: number, y: number, hideBeachSand: boolean): GroundMaterial {
    const authored = material(x, y);
    return hideBeachSand && (authored === 'dry-sand' || authored === 'wet-sand') ? 'turf' : authored;
  }
  function lipSurfaceMaterial(x: number, y: number, hideBeachSand: boolean): LipMaterial {
    const authored = lipMaterial(x, y);
    return hideBeachSand && (authored === 'dry-sand' || authored === 'wet-sand') ? lipGroundMaterial(x, y) : authored;
  }
  function surfaceMaterial(triangle: LandTriangle, point: LandVertex, normal: NormalInfo, hideBeachSand = false): IslandMaterial {
    if (triangle.submerged) return triangle.plane === 'top' ? 'wet-sand' : 'rock';
    if (triangle.plane === 'top') {
      // Raised mesh tops can overhang lowland source cells; do not apply the beach mask to them.
      if (roundBeachSeams && (triangle.level > 0 || triangle.ascentId !== undefined)) {
        const authored = LIP_MATERIALS[materials[materialIndex(point.x, point.y)]];
        return !hideBeachSand && (authored === 'dry-sand' || authored === 'wet-sand') ? authored : 'turf';
      }
      return groundSurfaceMaterial(point.x, point.y, hideBeachSand);
    }
    if (triangle.ascentId !== undefined && ascents.find(ascent => ascent.id === triangle.ascentId)?.kind !== 'gully') return 'soil';
    const belowLip = normal.top - point.z;
    const inland = triangle.level > 0;
    const lip = inland ? Math.min(0.75, normal.drop * 0.1) : 0.8;
    const soilBottom = inland ? lip + Math.min(1.5, normal.drop * 0.13) : 2.6;
    if (belowLip < lip - 1e-8) return lipSurfaceMaterial(point.x - normal.x * 0.25, point.y - normal.y * 0.25, hideBeachSand);
    return belowLip < soilBottom - 1e-8 ? 'soil' : 'rock';
  }
  function groundPatchColor(triangle: LandTriangle, point: LandVertex, material: IslandMaterial): SurfaceColor | undefined {
    if (triangle.plane !== 'top' || triangle.submerged
      || !GREEN_MATERIALS.some(green => green === material)) return undefined;
    const shade = getGroundMask().shade(point, triangle.ascentId === undefined ? triangle.level : triangle.ascentId + 64);
    return GROUND_PATCH_COLORS[shade];
  }
  return {
    ground: (x, y) => field.sample(x, y),
    material,
    regions(triangle, point) {
      const normal = normalInfo(triangle);
      return MATERIAL_COLORS[surfaceMaterial(triangle, point, normal)];
    },
    shade(triangle, point) {
      const normal = normalInfo(triangle);
      const material = surfaceMaterial(triangle, point, normal);
      let color = groundPatchColor(triangle, point, material)
        ?? sampleProjectedTexture(point, normal.weights, (u, v) => textures.sample(material, u, v));
      const finish = cove && triangle.plane === 'top' && triangle.level === 0 && triangle.ascentId === undefined
        && (triangle.submerged || topMaterials[materialIndex(point.x, point.y)] >= TOP_SAND_START)
        ? islandCoastInfluence(cove, point.x, point.y) : 0;
      if (finish && (material === 'dry-sand' || material === 'wet-sand')) {
        const base = MATERIAL_COLORS[material];
        color = mix(color, base, finish * 0.4);
      }
      const sun = getSun();
      let visibility = sun.visibility(point, normal);
      if (finish && visibility < 1 && sun.settings.intensity > 0 && sun.settings.shadowStrength > 0) {
        if (shadowSun !== sun) { preciseShadows.clear(); shadowSun = sun; }
        const receiver = closestSurfacePoint(triangle, point);
        let precise = sun.visibility(receiver, normal);
        if (precise < 1) {
          const coordinates = [receiver.x, receiver.y, receiver.z];
          if (sun.settings.shadowMode === 'filtered') coordinates.push(normal.x, normal.y, normal.z);
          const key = coordinates.map(value => value.toFixed(6)).join(',');
          const cached = preciseShadows.get(key);
          if (cached === undefined) {
            precise = sun.visibility(receiver, normal, true);
            if (preciseShadows.size >= MAX_PRECISE_SHADOWS) preciseShadows.clear();
            preciseShadows.set(key, precise);
          } else precise = cached;
        }
        visibility += (precise - visibility) * finish;
      }
      return sun.shade(color, normal, visibility, normal.skyFillScale);
    },
    shadeLayer(triangle, point, inspection, diagnostics, scale = 1) {
      const normal = normalInfo(triangle);
      if (diagnostics?.checker || inspection?.uvChecker) {
        const base = checker(triangle, point);
        return applyGeometryOverlayColor(triangle, point, base, inspection, scale);
      }
      if (inspection?.normals) {
        const normalColor: SurfaceColor = [
          Math.round((normal.x * 0.5 + 0.5) * 255),
          Math.round((normal.y * 0.5 + 0.5) * 255),
          Math.round((normal.z * 0.5 + 0.5) * 255),
        ];
        return applyGeometryOverlayColor(triangle, point, normalColor, inspection, scale);
      }
      const mat = surfaceMaterial(triangle, point, normal,
        triangle.layer === 'base' && diagnostics?.layers?.beaches.visible === false);
      if (diagnostics?.groundMask && triangle.plane === 'top' && !triangle.submerged
        && GREEN_MATERIALS.some(material => material === mat)) {
        const grey = getGroundMask().shade(point, triangle.ascentId === undefined ? triangle.level : triangle.ascentId + 64);
        return [grey, grey, grey];
      }
      const baseMaterialColor = MATERIAL_COLORS[mat];
      if (diagnostics?.regions) {
        return applyGeometryOverlayColor(triangle, point, baseMaterialColor, inspection, scale);
      }
      const useMaterials = inspection?.materials !== false;
      const useTextures = inspection?.textures !== false;
      const useLighting = inspection?.lighting !== false;
      const clay: SurfaceColor = triangle.submerged
        ? [146, 158, 164]
        : triangle.plane === 'top'
          ? [184, 190, 194]
          : [156, 162, 168];

      let color: SurfaceColor;
      const patchColor = useMaterials ? groundPatchColor(triangle, point, mat) : undefined;
      if (patchColor) {
        color = patchColor;
      } else if (useTextures) {
        let sampled = sampleProjectedTexture(point, normal.weights, (u, v) => textures.sample(mat, u, v));
        const finish = cove && triangle.plane === 'top' && triangle.level === 0 && triangle.ascentId === undefined
          && (triangle.submerged || topMaterials[materialIndex(point.x, point.y)] >= TOP_SAND_START)
          ? islandCoastInfluence(cove, point.x, point.y) : 0;
        if (finish && (mat === 'dry-sand' || mat === 'wet-sand')) {
          sampled = mix(sampled, baseMaterialColor, finish * 0.4);
        }
        if (useMaterials) {
          color = sampled;
        } else {
          const delta = ((sampled[0] - baseMaterialColor[0]) + (sampled[1] - baseMaterialColor[1]) + (sampled[2] - baseMaterialColor[2])) / 3;
          color = [
            Math.max(0, Math.min(255, clay[0] + delta)),
            Math.max(0, Math.min(255, clay[1] + delta)),
            Math.max(0, Math.min(255, clay[2] + delta)),
          ];
        }
      } else {
        color = useMaterials ? baseMaterialColor : clay;
      }

      let litColor: SurfaceColor;
      if (useLighting) {
        const sun = getSun();
        let visibility = sun.visibility(point, normal);
        const finish = cove && triangle.plane === 'top' && triangle.level === 0 && triangle.ascentId === undefined
          && (triangle.submerged || topMaterials[materialIndex(point.x, point.y)] >= TOP_SAND_START)
          ? islandCoastInfluence(cove, point.x, point.y) : 0;
        if (finish && visibility < 1 && sun.settings.intensity > 0 && sun.settings.shadowStrength > 0) {
          if (shadowSun !== sun) { preciseShadows.clear(); shadowSun = sun; }
          const receiver = closestSurfacePoint(triangle, point);
          let precise = sun.visibility(receiver, normal);
          if (precise < 1) {
            const coordinates = [receiver.x, receiver.y, receiver.z];
            if (sun.settings.shadowMode === 'filtered') coordinates.push(normal.x, normal.y, normal.z);
            const key = coordinates.map(value => value.toFixed(6)).join(',');
            const cached = preciseShadows.get(key);
            if (cached === undefined) {
              precise = sun.visibility(receiver, normal, true);
              if (preciseShadows.size >= MAX_PRECISE_SHADOWS) preciseShadows.clear();
              preciseShadows.set(key, precise);
            } else precise = cached;
          }
          visibility += (precise - visibility) * finish;
        }
        litColor = sun.shade(color, normal, visibility, normal.skyFillScale);
      } else {
        litColor = [
          Math.round(Math.max(0, Math.min(255, color[0]))),
          Math.round(Math.max(0, Math.min(255, color[1]))),
          Math.round(Math.max(0, Math.min(255, color[2]))),
        ];
      }

      if (inspection && (inspection.vertices || inspection.boundaries || inspection.uvSeams)) {
        return applyGeometryOverlayColor(triangle, point, litColor, inspection, scale);
      }
      return litColor;
    },
  };
}
