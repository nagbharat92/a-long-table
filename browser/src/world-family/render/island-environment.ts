import type { IslandLandform } from '../core/island-landform';
import { activeIslandLandTriangles, activeIslandSeabedTriangles, classifyTriangleLayer } from '../core/island-layers';
import { ISLAND_WATER_HEIGHT } from '../core/island-water-level';
import { projectLandVertex, rotateLandPoint, type LandCamera, type LandProjection, type LandTriangle, type LandVertex } from '../core/landform-study';
import { rasterLandform, rasterRabbit, type LandPalette, type LandRaster, type RabbitPixels } from './landform-study';
import { createIslandSurface, type SurfaceColor } from './island-surface';
import { createDefaultLayersInspection, hasActiveMeshInspection, isDefaultLayersInspection, type IslandLayersInspection, type LandDiagnostics } from './landform-diagnostics';
import { createIslandShoreField, type IslandShoreSample } from './island-shore-field';
import { ISLAND_SEA, shadeShoreWater } from './island-shore-water';
import { islandLevelPalette } from './island-level-palette';
import { createIslandOcean } from './island-ocean';
import { createIslandSun, DEFAULT_SUN, type SunSettings } from './island-sun';
import { createSunlitOcean } from './island-sun-water';
import { waterBedTransmission, waterTintedBed, WATER_COLOR_REACH, WATER_MAX_DEPTH } from './island-water-color';
import { DEFAULT_WATER_SETTINGS, validateWaterSettings, type WaterSettings } from './island-water-settings';
import { projectedWaterColor } from './island-water-projection';
import { waterBedOpticalDepth } from './island-water-optics';
import { createIslandWaterDepth, type IslandWaterDepth } from './island-water-depth';
import { createIslandCoastalSlope } from './island-coastal-slope';
import { coastalWaterNormalFromGradient, createWaterSurfaceResponse, waterRefractionNormal, waterViewDirection } from './island-water-surface';
import { createWaterRefraction } from './island-water-refraction';
import { compositeWaterFoam, WATER_FOAM_COLOR } from './island-water-foam';
import { BEACH_WASH_MAX_HEIGHT, beachWaveGradient, sampleBeachWash } from './island-beach-wash';
import { createIslandShoreMesh, shoreMeshSample, shoreMeshTriangles, type IslandShoreMesh, type ShoreMeshTriangle } from './island-shore-mesh';

export { ISLAND_SEA } from './island-shore-water';
export { createCoastField } from './island-shore-field';
export { ISLAND_WATER_HEIGHT } from '../core/island-water-level';
export interface IslandViewport {
  width: number;
  height: number;
  origin: { x: number; y: number };
}
export interface EnvironmentFrame {
  raster: LandRaster;
  grassCount: number;
  waterPixels: number;
  beachWaterPixels: number;
  cliffWaterPixels: number;
  submergedPixels: number;
  waterMask: Uint8Array;
  submergedMask: Uint8Array;
  oceanOnlyMask: Uint8Array;
  readonly foamPixels: number;
  foamMask: Uint8Array;
  beachWashMask: Uint8Array;
  shoreWaveMask: Uint8Array;
  shoreWaveHeights: Float32Array;
  animate(seconds: number): void;
}

export function waterWorldPoint(x: number, y: number, projection: LandProjection, camera?: LandCamera): { x: number; y: number } {
  const point = unrotatedWaterPoint(x, y, projection);
  return camera ? rotateLandPoint(point, camera, true) : point;
}

function unrotatedWaterPoint(x: number, y: number, projection: LandProjection): { x: number; y: number } {
  if (projection === 'plan') return { x, y };
  if (projection === 'current') return { x, y: y + ISLAND_WATER_HEIGHT };
  const sum = (y + ISLAND_WATER_HEIGHT) / 0.425, difference = x / 0.85;
  return { x: (sum + difference) / 2, y: (sum - difference) / 2 };
}

export function worldHeightFromDepth(screenY: number, depth: number, projection: LandProjection): number {
  if (!Number.isFinite(screenY) || !Number.isFinite(depth)) throw new Error('Depth reconstruction requires finite screen coordinates and depth.');
  if (projection === 'plan') return depth;
  return projection === 'current' ? (depth - screenY) / 2 : (depth - screenY * 2) / 2.7225;
}

const palette: LandPalette = {
  water: ISLAND_SEA, top: [128, 165, 88], light: [202, 188, 143],
  middle: [161, 156, 118], dark: [120, 139, 110],
  levels: [[211, 217, 184], [164, 187, 142], [112, 142, 120]],
};

function freezeWaterSettings(settings: Readonly<WaterSettings>): Readonly<WaterSettings> {
  const valid = validateWaterSettings(settings);
  Object.freeze(valid.shallow); Object.freeze(valid.middle); Object.freeze(valid.deep);
  return Object.freeze(valid);
}

export function createIslandEnvironment(
  island: IslandLandform, settings: SunSettings = DEFAULT_SUN,
  initialWaterSettings: Readonly<WaterSettings> = DEFAULT_WATER_SETTINGS,
) {
  let waterSettings = initialWaterSettings === DEFAULT_WATER_SETTINGS
    ? DEFAULT_WATER_SETTINGS : freezeWaterSettings(initialWaterSettings);
  const { world } = island;
  const profile = island.coast ?? island.cove;
  const shore = createIslandShoreField(world);
  const coastalSlope = createIslandCoastalSlope(world, shore, profile);
  let triangles = [...island.triangles, ...island.beach.underwaterTriangles];
  let shadowVisibility = '1111';
  let shadowLand = island.triangles, shadowSeabed = island.beach.underwaterTriangles;
  let sun = createIslandSun(triangles, settings);
  const surface = createIslandSurface(world, shore, island.ascents, island.edges, island.beach, () => sun, profile, island.triangles);
  const unlitOcean = createIslandOcean(world.seed);
  let waterDepth: IslandWaterDepth | undefined;
  let depthLand = island.triangles, depthBed = island.beach.underwaterTriangles;
  let shoreMesh: IslandShoreMesh | undefined;
  let meshLand = island.triangles, meshBed = island.beach.underwaterTriangles;
  function beachMesh(): IslandShoreMesh {
    if (!shoreMesh || meshLand !== island.triangles || meshBed !== island.beach.underwaterTriangles) {
      shoreMesh = createIslandShoreMesh(world, shore);
      meshLand = island.triangles;
      meshBed = island.beach.underwaterTriangles;
    }
    return shoreMesh;
  }
  function bathymetry(): IslandWaterDepth {
    if (!waterDepth || depthLand !== island.triangles || depthBed !== island.beach.underwaterTriangles) {
      waterDepth = createIslandWaterDepth([...island.triangles, ...island.beach.underwaterTriangles],
        island.triangles.length ? coastalSlope : undefined);
      depthLand = island.triangles;
      depthBed = island.beach.underwaterTriangles;
    }
    return waterDepth;
  }
  let ocean = createSunlitOcean(unlitOcean, sun);
  function setLayers(layers: IslandLayersInspection = createDefaultLayersInspection()): void {
    const visibility = {
      base: layers.base.visible, uplands: layers.uplands.visible,
      beaches: layers.beaches.visible, seabed: layers.seabed.visible,
    };
    const signature = [visibility.base, visibility.uplands, visibility.beaches, visibility.seabed].map(Number).join('');
    if (signature === shadowVisibility && shadowLand === island.triangles
      && shadowSeabed === island.beach.underwaterTriangles) return;
    const nextTriangles = [
      ...activeIslandLandTriangles(island, visibility),
      ...activeIslandSeabedTriangles(island, visibility),
    ];
    const nextSun = createIslandSun(nextTriangles, sun.settings);
    const nextOcean = createSunlitOcean(unlitOcean, nextSun);
    triangles = nextTriangles;
    sun = nextSun;
    ocean = nextOcean;
    shadowVisibility = signature;
    shadowLand = island.triangles;
    shadowSeabed = island.beach.underwaterTriangles;
  }
  return {
    get surface() { return surface; },
    get shore() { return shore; },
    get shoreMesh() { return beachMesh(); },
    get ocean() { return ocean; },
    get oceanBake() { return unlitOcean.bake; },
    get waterDepth() { return bathymetry(); },
    get waterSettings() { return waterSettings; },
    setWaterSettings(settings: Readonly<WaterSettings>): void {
      waterSettings = freezeWaterSettings(settings);
    },
    get sun() { return sun; },
    setLayers,
    setSun(settings: SunSettings): void {
      const next = createIslandSun(triangles, settings);
      const nextOcean = createSunlitOcean(unlitOcean, next);
      sun = next;
      ocean = nextOcean;
    },
    render(projection: LandProjection, viewport: IslandViewport, rabbit?: RabbitPixels, diagnostics: LandDiagnostics = {}, camera?: LandCamera): EnvironmentFrame {
      if (![viewport.width, viewport.height].every(value => Number.isInteger(value) && value > 0 && value <= 2048)
        || ![viewport.origin.x, viewport.origin.y].every(Number.isFinite)) {
        throw new Error('Island environment viewport must have finite dimensions from 1 to 2048 pixels.');
      }
      const layers = diagnostics.layers ?? createDefaultLayersInspection();
      setLayers(layers);
      const customLayers = !isDefaultLayersInspection(diagnostics.layers);
      const inspect = Boolean(diagnostics.checker || diagnostics.wireframe || diagnostics.regions);
      const colors = { ...palette, levels: islandLevelPalette(world, palette.levels[0], palette.levels[2]) };
      const landTriangles = activeIslandLandTriangles(island, {
        base: layers.base.visible,
        uplands: layers.uplands.visible,
        beaches: layers.beaches.visible,
      });
      const seabedTriangles = projection === 'plan'
        ? []
        : activeIslandSeabedTriangles(island, { seabed: layers.seabed.visible });
      const shadeTriangle = customLayers || diagnostics.groundMask
        ? (triangle: LandTriangle, point: { x: number; y: number; z: number }) =>
          surface.shadeLayer(triangle, point, layers[classifyTriangleLayer(triangle)], diagnostics)
        : diagnostics.regions ? surface.regions : surface.shade;
      const raster = rasterLandform(projection, colors, [], {
        triangles: projection === 'plan' ? landTriangles : [...landTriangles, ...seabedTriangles],
        viewport, diagnostics, camera,
        shade: shadeTriangle, shadePlan: Boolean(diagnostics.regions || diagnostics.groundMask || customLayers),
      });
      const width = viewport.width, height = viewport.height, size = width * height;
      if (projection !== 'plan' && rabbit) {
        for (const placement of island.placements) rasterRabbit(raster, rabbit, placement, projection, true, camera);
      }
      const waterMask = new Uint8Array(size), submergedMask = new Uint8Array(size), foamMask = new Uint8Array(size), oceanOnlyMask = new Uint8Array(size);
      const waterVisible = layers.water.visible && projection !== 'plan';
      const washVisible = waterVisible && layers.water.shoreFoam && layers.beaches.visible
        && !inspect && !hasActiveMeshInspection(diagnostics.layers);
      const localMesh = washVisible ? beachMesh() : undefined;
      const beachWashMask = new Uint8Array(size);
      const shoreWaveMask = new Uint8Array(size);
      const shoreWaveHeights = new Float32Array(size).fill(ISLAND_WATER_HEIGHT);
      const indices = new Int32Array(waterVisible ? size : 0);
      const points = new Float64Array(indices.length * 2), transmission = new Float32Array(indices.length);
      const depths = new Float32Array(indices.length);
      const distances = new Float32Array(indices.length);
      const groundHeights = new Float32Array(indices.length).fill(ISLAND_WATER_HEIGHT);
      const bedVisibility = new Float32Array(waterVisible ? size : 0).fill(1);
      const bedDepth = waterVisible ? bathymetry() : undefined;
      const shores = new Map<number, IslandShoreSample>();
      let count = 0, dryWashPixels = 0, submergedPixels = 0, beachWaterPixels = 0, cliffWaterPixels = 0;
      if (waterVisible) {
        const seabedInspect = layers.seabed.wireframe || layers.seabed.vertices || layers.seabed.boundaries
          || layers.seabed.normals || layers.seabed.uvChecker || layers.seabed.uvSeams;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const index = y * width + x, depth = raster.depth[index];
            const sy = y + 0.5 - viewport.origin.y;
            const solid = depth !== -Infinity;
            const z = solid ? worldHeightFromDepth(sy, depth, projection) : -Infinity;
            if (solid && (inspect || (raster.submerged?.[index] && seabedInspect))) continue;
            const dry = solid && !raster.submerged?.[index] && z >= ISLAND_WATER_HEIGHT - 1e-7;
            if (dry && (!washVisible || z > BEACH_WASH_MAX_HEIGHT + 1e-7)) continue;
            // Run-up is projected onto the visible sand, not the lower water plane.
            const point = waterWorldPoint(x + 0.5 - viewport.origin.x,
              sy + (dry ? z - ISLAND_WATER_HEIGHT : 0), projection, camera);
            if (dry) {
              const material = surface.material(point.x, point.y);
              if (!raster.beach?.[index] || (material !== 'wet-sand' && material !== 'dry-sand')) continue;
              beachWashMask[index] = 1;
              groundHeights[count] = z;
              dryWashPixels++;
            }
            indices[count] = index;
            points[count * 2] = point.x; points[count * 2 + 1] = point.y;
            waterMask[index] = Number(!dry);
            const distance = shore.distance(point.x, point.y);
            distances[count] = distance;
            depths[count] = bedDepth!.bodyDepth(Math.floor(point.x) + 0.5, Math.floor(point.y) + 0.5);
            const coast = (distance > -8 && distance < WATER_COLOR_REACH) || (solid && profile)
              ? shore.sample(point.x, point.y) : undefined;
            if (solid && !dry) {
              submergedMask[index] = 1;
              submergedPixels++;
              const bed = raster.submerged?.[index] === 1;
              if (bed) {
                const bottom = waterWorldPoint(x + 0.5 - viewport.origin.x,
                  sy + z - ISLAND_WATER_HEIGHT, projection, camera);
                bedVisibility[index] = raster.submergedTop?.[index] === 0 ? 0 : bedDepth!.bedVisibility(bottom.x, bottom.y);
              }
              if (bed && !layers.water.seabedVisibility) {
                transmission[count] = 0;
              } else {
                transmission[count] = waterBedTransmission(Math.max(0, ISLAND_WATER_HEIGHT - z), bed) * bedVisibility[index];
              }
            }
            if (coast) shores.set(count, coast);
            if (coast && coast.distance > 0 && coast.distance < coast.shallowWidth) {
              if (coast.kind === 'beach') beachWaterPixels++;
              if (coast.kind === 'cliff') cliffWaterPixels++;
            } else if (!solid && distance >= WATER_COLOR_REACH) oceanOnlyMask[index] = 1;
            count++;
          }
        }
      }
      const oceanFrame = ocean.prepare(points.subarray(0, count * 2));
      const surfaceResponse = createWaterSurfaceResponse(sun, projection, camera);
      const waterView = waterViewDirection(projection, camera?.yaw);
      const original = raster.pixels.slice();
      const refract = createWaterRefraction(raster, original, width, height, viewport.origin.y, projection, camera);
      let foamPixels = 0;
      function animate(seconds: number): void {
        if (!Number.isFinite(seconds)) throw new Error('Water animation time must be finite.');
        oceanFrame.animate(seconds);
        foamPixels = 0;
        shoreWaveMask.fill(0);
        shoreWaveHeights.fill(ISLAND_WATER_HEIGHT);
        const wState = layers.water;
        for (let i = 0; i < count; i++) {
          const index = indices[i], offset = index * 4, oceanOffset = i * 4;
          const raw = oceanFrame.unlitPixels;
          const base = oceanFrame.basePixels;
          const bodyColor = projectedWaterColor(wState.depthColor ? depths[i] : WATER_MAX_DEPTH,
            unlitOcean.bake.patches, points[i * 2], points[i * 2 + 1], seconds, waterSettings, wState.colorPatches);
          const surfaceColor: SurfaceColor = wState.surfaceHighlights
            ? [raw[oceanOffset] - base[oceanOffset], raw[oceanOffset + 1] - base[oceanOffset + 1], raw[oceanOffset + 2] - base[oceanOffset + 2]]
            : [0, 0, 0];
          let color: SurfaceColor, foam = 0, wash = 0, wetness = 0, washHeight = ISLAND_WATER_HEIGHT;
          const coast = shores.get(i);
          if (coast) {
            const sample = shadeShoreWater(coast, seconds, 0, ISLAND_SEA, surfaceColor, {
              depthColor: wState.depthColor,
              depth: depths[i],
              waves: wState.waves,
              shoreFoam: false,
              rockContact: washVisible,
              groundHeight: groundHeights[i],
              compositeFoam: false,
              waterSettings, bodyColor,
            });
            color = sample.color;
            foam = sample.foam;
            wash = washVisible ? 0 : sample.wash;
            wetness = washVisible ? sampleBeachWash(coast, seconds, groundHeights[i], waterSettings.waveEndSoftness).wetness : 0;
            washHeight = sample.height;
          } else {
            color = [bodyColor[0] + surfaceColor[0], bodyColor[1] + surfaceColor[1], bodyColor[2] + surfaceColor[2]];
          }
          const [r, g, b] = wState.lighting
            ? oceanFrame.shade(i, color)
            : [Math.round(Math.max(0, Math.min(255, color[0]))), Math.round(Math.max(0, Math.min(255, color[1]))), Math.round(Math.max(0, Math.min(255, color[2])))];
          const dry = beachWashMask[index] === 1;
          const t = dry ? waterBedTransmission(Math.max(0, washHeight - groundHeights[i]), false) : transmission[i];
          const normal = coastalWaterNormalFromGradient(points[i * 2], points[i * 2 + 1], seconds,
            distances[i], coast?.beachWeight ?? 0, washVisible, { x: 0, y: 0 }, waterSettings.waveEndSoftness);
          let bottom: SurfaceColor = t > 0 && !dry
            ? refract(index, ISLAND_WATER_HEIGHT, distances[i], waterRefractionNormal(normal,
              points[i * 2], points[i * 2 + 1], seconds, distances[i], coast?.beachWeight ?? 0,
              washVisible, waterSettings.waveEndSoftness), { refraction: wState.surfaceResponse })
            : [original[offset], original[offset + 1], original[offset + 2]];
          if (raster.submerged?.[index]) bottom = waterTintedBed(bottom, [r, g, b]);
          const composite: SurfaceColor = [
            r * (1 - t) + bottom[0] * t,
            g * (1 - t) + bottom[1] * t,
            b * (1 - t) + bottom[2] * t,
          ];
          const water = wState.surfaceResponse && wState.lighting
            ? surfaceResponse(composite, points[i * 2], points[i * 2 + 1], seconds, t, oceanFrame.visibility[i] / 255,
              1, normal)
            : composite;
          const result = foam > 0 ? compositeWaterFoam(water, foam,
            wState.lighting ? oceanFrame.shade(i, WATER_FOAM_COLOR) : WATER_FOAM_COLOR) : water;
          const coverage = dry ? wash : 1;
          for (let channel = 0; channel < 3; channel++) {
            const sand = original[offset + channel] * (1 - (dry ? wetness * 0.18 : 0));
            raster.pixels[offset + channel] = Math.round(sand + (result[channel] - sand) * coverage);
          }
          foamMask[index] = Number(foam > 0.01);
          foamPixels += foamMask[index];
        }
        if (localMesh?.vertices.length) {
          const waveTriangles = shoreMeshTriangles(localMesh, seconds, waterSettings.waveEndSoftness);
          const attributes = new Map<LandTriangle, ShoreMeshTriangle>(waveTriangles.map(triangle => [triangle, triangle]));
          const fragments = new Map<number, {
            point: LandVertex; shore: IslandShoreSample; gradient: readonly [number, number];
            beachGradient: readonly [number, number]; opacity: number; foam: number;
          }>();
          rasterLandform(projection, colors, [], {
            triangles: waveTriangles, viewport, camera,
            shade: (triangle, point) => {
              const screen = projectLandVertex(point, projection, camera);
              const x = Math.floor(screen.x + viewport.origin.x), y = Math.floor(screen.y + viewport.origin.y);
              const index = y * width + x;
              if (point.z <= ISLAND_WATER_HEIGHT + 0.01 || screen.z < raster.depth[index] - 0.0001
                || (!waterMask[index] && !beachWashMask[index])) return undefined;
              const data = shoreMeshSample(attributes.get(triangle)!, point);
              const actual = shore.sample(point.x, point.y);
              if (actual.kind !== 'beach' || actual.beachWeight <= 0.6) return undefined;
              const coast: IslandShoreSample = {
                distance: data[2], beachWeight: data[3], phase: data[4], breakup: data[5],
                kind: 'beach', beachDistance: Math.abs(data[2]), cliffDistance: Infinity,
                variation: 0, wetWidth: 0, shallowWidth: actual.shallowWidth,
              };
              const ground = beachWashMask[index]
                ? worldHeightFromDepth(y + 0.5 - viewport.origin.y, raster.depth[index], projection) : ISLAND_WATER_HEIGHT;
              const wash = sampleBeachWash(coast, seconds, ground, waterSettings.waveEndSoftness);
              const t = Math.max(0, Math.min(1, (point.z - ISLAND_WATER_HEIGHT - 0.01) / 0.11));
              const opacity = (beachWashMask[index] ? Math.max(wash.coverage, wash.foam) : 1) * t * t * (3 - 2 * t);
              if (opacity <= 0) return undefined;
              fragments.set(index, { point, shore: coast, gradient: [data[6], data[7]],
                beachGradient: [data[8], data[9]], opacity, foam: wash.foam });
              return ISLAND_SEA;
            },
          });
          const wavePoints = new Float64Array(fragments.size * 2);
          let cursor = 0;
          for (const { point } of fragments.values()) {
            wavePoints[cursor++] = point.x; wavePoints[cursor++] = point.y;
          }
          const waveOcean = ocean.prepare(wavePoints);
          waveOcean.animate(seconds);
          cursor = 0;
          for (const [index, fragment] of fragments) {
            const { point, shore: coast, opacity, foam } = fragment;
            shoreWaveMask[index] = 1;
            shoreWaveHeights[index] = point.z;
            const offset = cursor * 4;
            const base = waveOcean.basePixels, raw = waveOcean.unlitPixels;
            const surfaceColor: SurfaceColor = wState.surfaceHighlights
              ? [raw[offset] - base[offset], raw[offset + 1] - base[offset + 1], raw[offset + 2] - base[offset + 2]] : [0, 0, 0];
            const sample = shadeShoreWater(coast, seconds, 0, ISLAND_SEA, surfaceColor, {
              depthColor: wState.depthColor, depth: bedDepth!.bodyDepth(point.x, point.y), waves: wState.waves,
              compositeFoam: false,
              shoreFoam: true, groundHeight: beachWashMask[index]
                ? worldHeightFromDepth(Math.floor(index / width) + 0.5 - viewport.origin.y, raster.depth[index], projection)
                : ISLAND_WATER_HEIGHT,
              waterSettings, bodyColor: projectedWaterColor(wState.depthColor
                ? bedDepth!.bodyDepth(Math.floor(point.x) + 0.5, Math.floor(point.y) + 0.5) : WATER_MAX_DEPTH,
              unlitOcean.bake.patches, point.x, point.y, seconds, waterSettings, wState.colorPatches),
            });
            const lit = wState.lighting ? waveOcean.shade(cursor, sample.color) : sample.color;
            const solid = raster.depth[index] !== -Infinity;
            const ground = solid ? worldHeightFromDepth(Math.floor(index / width) + 0.5 - viewport.origin.y, raster.depth[index], projection) : 0;
            const bed = raster.submerged?.[index] === 1;
            const opticalDepth = bed ? waterBedOpticalDepth(point.z, ground, waterView.z) : Math.max(0, point.z - ground);
            const transmission = solid && (!bed || (wState.seabedVisibility && layers.seabed.visible))
              ? waterBedTransmission(opticalDepth, bed) * bedVisibility[index] : 0;
            const [dx, dy] = fragment.gradient;
            const [bx, by] = fragment.beachGradient;
            const heightGradient = beachWaveGradient(coast.distance, coast.phase, coast.beachWeight, seconds,
              { x: dx, y: dy }, { x: bx, y: by }, waterSettings.waveEndSoftness);
            const normal = coastalWaterNormalFromGradient(point.x, point.y, seconds, coast.distance, coast.beachWeight,
              true, heightGradient, waterSettings.waveEndSoftness);
            const pixel = index * 4;
            let bottom: SurfaceColor = transmission > 0 && !beachWashMask[index]
              ? refract(index, point.z, coast.distance, waterRefractionNormal(normal,
                point.x, point.y, seconds, coast.distance, coast.beachWeight, true, waterSettings.waveEndSoftness),
              { refraction: wState.surfaceResponse, opticalDepth })
              : [original[pixel], original[pixel + 1], original[pixel + 2]];
            if (bed) bottom = waterTintedBed(bottom, lit);
            const composite: SurfaceColor = [
              lit[0] * (1 - transmission) + bottom[0] * transmission,
              lit[1] * (1 - transmission) + bottom[1] * transmission,
              lit[2] * (1 - transmission) + bottom[2] * transmission,
            ];
            const water = wState.surfaceResponse && wState.lighting
              ? surfaceResponse(composite, point.x, point.y, seconds, transmission, waveOcean.visibility[cursor] / 255, 1, normal)
              : composite;
            const color = foam > 0 ? compositeWaterFoam(water, foam,
              wState.lighting ? waveOcean.shade(cursor, WATER_FOAM_COLOR) : WATER_FOAM_COLOR) : water;
            for (let channel = 0; channel < 3; channel++) {
              raster.pixels[pixel + channel] = Math.round(raster.pixels[pixel + channel] * (1 - opacity) + color[channel] * opacity);
            }
            if (foam > 0.01 && !foamMask[index]) { foamMask[index] = 1; foamPixels++; }
            cursor++;
          }
        }
      }
      animate(0);
      return {
        raster, grassCount: 0, waterPixels: count - dryWashPixels, beachWaterPixels, cliffWaterPixels,
        submergedPixels, waterMask, submergedMask, oceanOnlyMask, animate, foamMask, beachWashMask, shoreWaveMask, shoreWaveHeights,
        get foamPixels() { return foamPixels; },
      };
    },
  };
}
