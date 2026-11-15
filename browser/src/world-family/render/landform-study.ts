import {
  LANDFORM_FIXTURE, RABBIT_WORLD_HEIGHT, SCALE_PLACEMENTS, OCCLUSION_PLACEMENT,
  landformTriangles, projectLandVertex,
  type LandCamera, type LandMass, type LandPlane, type LandProjection, type LandTriangle, type LandVertex,
} from '../core/landform-study';
import { classifyTriangleLayer } from '../core/island-layers';
import { createProjectionChecker, type IslandMeshLayerInspection, type LandDiagnostics } from './landform-diagnostics';

export const STUDY_WIDTH = 216;
export const STUDY_HEIGHT = 224;
export const STUDY_ORIGIN = { x: 112, y: 128 };
export interface LandPalette {
  water: readonly number[];
  top: readonly number[];
  light: readonly number[];
  middle: readonly number[];
  dark: readonly number[];
  levels: readonly (readonly number[])[];
}
export interface LandRaster {
  width?: number;
  height?: number;
  origin?: { x: number; y: number };
  pixels: Uint8ClampedArray;
  depth: Float64Array;
  levels: Int8Array;
  submerged?: Uint8Array;
  submergedTop?: Uint8Array;
  beach?: Uint8Array;
}
export interface RabbitPixels { width: number; height: number; pixels: Uint8ClampedArray }
export interface LandRenderOptions {
  camera?: LandCamera;
  viewport?: { width: number; height: number; origin: { x: number; y: number } };
  triangles?: readonly LandTriangle[];
  shade?: (triangle: LandTriangle, point: LandVertex) => readonly number[] | undefined;
  shadePlan?: boolean;
  diagnostics?: LandDiagnostics;
}

export function studyScreenPoint(point: LandVertex, projection: LandProjection): LandVertex {
  const p = projectLandVertex(point, projection);
  return { x: p.x + STUDY_ORIGIN.x, y: p.y + STUDY_ORIGIN.y, z: p.z };
}

function rasterTriangle(
  raster: LandRaster, triangle: LandTriangle, projection: LandProjection, color: readonly number[],
  shade?: LandRenderOptions['shade'],
  wireframe = false,
  camera?: LandCamera,
  layerInspection?: IslandMeshLayerInspection,
): void {
  const width = raster.width ?? STUDY_WIDTH, height = raster.height ?? STUDY_HEIGHT;
  const origin = raster.origin ?? STUDY_ORIGIN;
  const [a, b, c] = triangle.vertices.map(p => {
    const projected = projectLandVertex(p, projection, camera);
    return { x: projected.x + origin.x, y: projected.y + origin.y, z: projected.z };
  });
  const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (area <= 1e-8) return;
  const inclusive = (from: LandVertex, to: LandVertex) =>
    from.y > to.y || (from.y === to.y && from.x < to.x);
  const ownsEdges = [inclusive(b, c), inclusive(c, a), inclusive(a, b)];
  const showWireframe = wireframe || Boolean(layerInspection?.wireframe);
  const showBoundaries = Boolean(layerInspection?.boundaries);
  const showVertices = Boolean(layerInspection?.vertices);
  const needEdgeLengths = showWireframe || showBoundaries;
  const edgeLengths = needEdgeLengths
    ? [Math.hypot(c.x - b.x, c.y - b.y), Math.hypot(a.x - c.x, a.y - c.y), Math.hypot(b.x - a.x, b.y - a.y)]
    : [];
  const boundaryFlags = triangle.boundaryEdges ?? [true, true, true];
  const boundarySegments = showBoundaries && triangle.boundarySegments?.map(({ from, to }) => ({
    from: projectLandVertex(from, projection, camera), to: projectLandVertex(to, projection, camera),
  }));
  const left = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
  const beach = Number(classifyTriangleLayer(triangle) === 'beaches');
  const right = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
  const top = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
  const bottom = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const px = x + 0.5, py = y + 0.5;
      const u = ((b.x - px) * (c.y - py) - (b.y - py) * (c.x - px)) / area;
      const v = ((c.x - px) * (a.y - py) - (c.y - py) * (a.x - px)) / area;
      const w = 1 - u - v;
      if (Math.min(u, v, w) < -1e-8) continue;
      // Half-open coverage gives shared edges one owner, independent of mesh merging/order.
      if ((u <= 1e-8 && !ownsEdges[0]) || (v <= 1e-8 && !ownsEdges[1]) || (w <= 1e-8 && !ownsEdges[2])) continue;
      const depth = u * a.z + v * b.z + w * c.z;
      const index = y * width + x;
      if (depth < raster.depth[index] - 1e-8) continue;
      const vertices = triangle.vertices;
      let shaded = shade ? shade(triangle, {
        x: u * vertices[0].x + v * vertices[1].x + w * vertices[2].x,
        y: u * vertices[0].y + v * vertices[1].y + w * vertices[2].y,
        z: u * vertices[0].z + v * vertices[1].z + w * vertices[2].z,
      }) : color;
      if (!shaded) continue;
      raster.depth[index] = depth;
      raster.levels[index] = triangle.level;
      if (raster.submerged) raster.submerged[index] = Number(Boolean(triangle.submerged));
      if (raster.submergedTop) raster.submergedTop[index] = Number(Boolean(triangle.submerged) && triangle.plane === 'top');
      if (raster.beach) raster.beach[index] = beach;
      if (showWireframe && Math.min(u * area / edgeLengths[0], v * area / edgeLengths[1], w * area / edgeLengths[2]) <= 0.45) {
        shaded = [25, 38, 42];
      }
      if (showBoundaries) {
        const d0 = boundaryFlags[2] ? w * area / edgeLengths[2] : Infinity;
        const d1 = boundaryFlags[0] ? u * area / edgeLengths[0] : Infinity;
        const d2 = boundaryFlags[1] ? v * area / edgeLengths[1] : Infinity;
        const distance = boundarySegments ? boundarySegments.reduce((best, { from, to }) => {
          const dx = to.x - from.x, dy = to.y - from.y, length = dx * dx + dy * dy;
          const t = length > 0 ? Math.max(0, Math.min(1,
            ((px - origin.x - from.x) * dx + (py - origin.y - from.y) * dy) / length)) : 0;
          return Math.min(best, Math.hypot(px - origin.x - from.x - t * dx, py - origin.y - from.y - t * dy));
        }, Infinity) : Math.min(d0, d1, d2);
        if (distance <= 0.75) shaded = [238, 108, 77];
      }
      if (showVertices) {
        const vd = Math.min(
          Math.hypot(px - a.x, py - a.y),
          Math.hypot(px - b.x, py - b.y),
          Math.hypot(px - c.x, py - c.y),
        );
        if (vd <= 1.45) shaded = [248, 214, 72];
        else if (vd <= 2.15) shaded = [25, 38, 42];
      }
      raster.pixels.set(shaded, index * 4);
      raster.pixels[index * 4 + 3] = 255;
    }
  }
}

export function rasterLandform(
  projection: LandProjection, palette: LandPalette, masses: readonly LandMass[] = LANDFORM_FIXTURE,
  options: LandRenderOptions = {},
): LandRaster {
  const width = options.viewport?.width ?? STUDY_WIDTH;
  const height = options.viewport?.height ?? STUDY_HEIGHT;
  const size = width * height;
  const raster: LandRaster = {
    width, height, origin: options.viewport?.origin ?? STUDY_ORIGIN,
    pixels: new Uint8ClampedArray(size * 4),
    depth: new Float64Array(size).fill(-Infinity),
    levels: new Int8Array(size).fill(-1),
    submerged: new Uint8Array(size),
    submergedTop: new Uint8Array(size),
    beach: new Uint8Array(size),
  };
  const shade = options.diagnostics?.checker ? createProjectionChecker()
    : projection === 'plan' && !options.shadePlan ? undefined : options.shade;
  for (let i = 0; i < size; i++) {
    raster.pixels.set(palette.water, i * 4);
    raster.pixels[i * 4 + 3] = 255;
  }
  for (const triangle of options.triangles ?? landformTriangles(masses)) {
    if (projection === 'plan' && triangle.plane !== 'top') continue;
    const color = projection === 'plan' ? palette.levels[triangle.level] : palette[triangle.plane satisfies LandPlane];
    if (!color) throw new Error(`Landform palette has no color for elevation ${triangle.level}.`);
    const layerId = options.diagnostics?.layers ? classifyTriangleLayer(triangle) : undefined;
    const layerInspection = layerId && options.diagnostics?.layers ? options.diagnostics.layers[layerId] : undefined;
    if (layerInspection && !layerInspection.visible) continue;
    rasterTriangle(raster, triangle, projection, color, shade, options.diagnostics?.wireframe, options.camera, layerInspection);
  }
  return raster;
}

export function rasterRabbit(
  raster: LandRaster, rabbit: RabbitPixels, placement: LandVertex, projection: LandProjection,
  writeDepth = false, camera?: LandCamera,
): { visible: number; hidden: number } {
  const rasterWidth = raster.width ?? STUDY_WIDTH, rasterHeight = raster.height ?? STUDY_HEIGHT;
  const origin = raster.origin ?? STUDY_ORIGIN;
  const projected = projectLandVertex(placement, projection, camera);
  const foot = { x: projected.x + origin.x, y: projected.y + origin.y };
  const height = RABBIT_WORLD_HEIGHT;
  const width = rabbit.width / rabbit.height * height;
  const left = Math.round(foot.x - width / 2), top = Math.round(foot.y - height);
  let visible = 0, hidden = 0;
  for (let y = top; y < Math.round(foot.y); y++) {
    for (let x = left; x < Math.round(left + width); x++) {
      const sourceX = Math.min(rabbit.width - 1, Math.floor((x - left) / width * rabbit.width));
      const sourceY = Math.min(rabbit.height - 1, Math.floor((y - top) / height * rabbit.height));
      const source = (sourceY * rabbit.width + sourceX) * 4;
      if (rabbit.pixels[source + 3] === 0) continue;
      const index = y * rasterWidth + x;
      const z = placement.z + Math.round(foot.y) - y;
      const depth = projectLandVertex({ ...placement, z }, projection, camera).z;
      if (x < 0 || y < 0 || x >= rasterWidth || y >= rasterHeight || depth < raster.depth[index] - 0.01) {
        hidden++;
        continue;
      }
      raster.pixels.set(rabbit.pixels.subarray(source, source + 4), index * 4);
      if (writeDepth) raster.depth[index] = depth;
      if (raster.submerged) raster.submerged[index] = 0;
      if (raster.submergedTop) raster.submergedTop[index] = 0;
      if (raster.beach) raster.beach[index] = 0;
      visible++;
    }
  }
  return { visible, hidden };
}

export function drawLandform(
  canvas: HTMLCanvasElement, projection: LandProjection, palette: LandPalette,
  rabbit?: RabbitPixels, probe = false,
  masses: readonly LandMass[] = LANDFORM_FIXTURE,
  placements: readonly LandVertex[] = SCALE_PLACEMENTS,
  probePlacement: LandVertex = OCCLUSION_PLACEMENT,
  options: LandRenderOptions = {},
): LandRaster {
  const raster = rasterLandform(projection, palette, masses, options);
  if (rabbit && projection !== 'plan') {
    const visibility = placements.map(placement => rasterRabbit(raster, rabbit, placement, projection, false, options.camera));
    canvas.dataset.scaleVisibility = JSON.stringify(visibility);
    canvas.dataset.scaleSummary = visibility.map((result, i) =>
      `${['Base', 'Shelf', 'Shoulder'][i] ?? `Terrace ${i}`}: ${result.visible} visible / ${result.hidden} hidden`).join('; ');
    if (probe) {
      const result = rasterRabbit(raster, rabbit, probePlacement, projection, false, options.camera);
      canvas.dataset.probeVisible = String(result.visible);
      canvas.dataset.probeHidden = String(result.hidden);
    }
  }
  canvas.width = raster.width ?? STUDY_WIDTH;
  canvas.height = raster.height ?? STUDY_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create the landform study canvas.');
  const image = context.createImageData(canvas.width, canvas.height);
  image.data.set(raster.pixels);
  context.putImageData(image, 0, 0);
  canvas.dataset.projection = projection;
  canvas.dataset.checker = String(Boolean(options.diagnostics?.checker));
  canvas.dataset.wireframe = String(Boolean(options.diagnostics?.wireframe));
  canvas.dataset.fixture = masses.map(mass => `${mass.id}:${mass.height}`).join('|');
  return raster;
}
