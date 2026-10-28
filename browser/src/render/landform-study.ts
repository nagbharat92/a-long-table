import {
  LANDFORM_FIXTURE, RABBIT_WORLD_HEIGHT, SCALE_PLACEMENTS, OCCLUSION_PLACEMENT,
  landformTriangles, projectLandVertex,
  type LandPlane, type LandProjection, type LandTriangle, type LandVertex,
} from '../core/landform-study';

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
  pixels: Uint8ClampedArray;
  depth: Float64Array;
  levels: Int8Array;
}
export interface RabbitPixels { width: number; height: number; pixels: Uint8ClampedArray }

const triangles = landformTriangles();

export function studyScreenPoint(point: LandVertex, projection: LandProjection): LandVertex {
  const p = projectLandVertex(point, projection);
  return { x: p.x + STUDY_ORIGIN.x, y: p.y + STUDY_ORIGIN.y, z: p.z };
}

function rasterTriangle(raster: LandRaster, triangle: LandTriangle, projection: LandProjection, color: readonly number[]): void {
  const [a, b, c] = triangle.vertices.map(p => studyScreenPoint(p, projection));
  const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (area <= 1e-8) return;
  const left = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
  const right = Math.min(STUDY_WIDTH - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
  const top = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
  const bottom = Math.min(STUDY_HEIGHT - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const px = x + 0.5, py = y + 0.5;
      const u = ((b.x - px) * (c.y - py) - (b.y - py) * (c.x - px)) / area;
      const v = ((c.x - px) * (a.y - py) - (c.y - py) * (a.x - px)) / area;
      const w = 1 - u - v;
      if (Math.min(u, v, w) < -1e-8) continue;
      const depth = u * a.z + v * b.z + w * c.z;
      const index = y * STUDY_WIDTH + x;
      if (depth < raster.depth[index] - 1e-8) continue;
      raster.depth[index] = depth;
      raster.levels[index] = triangle.level;
      raster.pixels.set(color, index * 4);
      raster.pixels[index * 4 + 3] = 255;
    }
  }
}

export function rasterLandform(projection: LandProjection, palette: LandPalette): LandRaster {
  const size = STUDY_WIDTH * STUDY_HEIGHT;
  const raster: LandRaster = {
    pixels: new Uint8ClampedArray(size * 4),
    depth: new Float64Array(size).fill(-Infinity),
    levels: new Int8Array(size).fill(-1),
  };
  for (let i = 0; i < size; i++) {
    raster.pixels.set(palette.water, i * 4);
    raster.pixels[i * 4 + 3] = 255;
  }
  for (const triangle of triangles) {
    if (projection === 'plan' && triangle.plane !== 'top') continue;
    const color = projection === 'plan' ? palette.levels[triangle.level] : palette[triangle.plane satisfies LandPlane];
    rasterTriangle(raster, triangle, projection, color);
  }
  return raster;
}

export function rasterRabbit(
  raster: LandRaster, rabbit: RabbitPixels, placement: LandVertex, projection: LandProjection,
): { visible: number; hidden: number } {
  const foot = studyScreenPoint(placement, projection);
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
      const index = y * STUDY_WIDTH + x;
      const z = placement.z + Math.round(foot.y) - y;
      const depth = projectLandVertex({ ...placement, z }, projection).z;
      if (x < 0 || y < 0 || x >= STUDY_WIDTH || y >= STUDY_HEIGHT || depth < raster.depth[index] - 0.01) {
        hidden++;
        continue;
      }
      raster.pixels.set(rabbit.pixels.subarray(source, source + 4), index * 4);
      visible++;
    }
  }
  return { visible, hidden };
}

export function drawLandform(
  canvas: HTMLCanvasElement, projection: LandProjection, palette: LandPalette,
  rabbit?: RabbitPixels, probe = false,
): LandRaster {
  const raster = rasterLandform(projection, palette);
  if (rabbit && projection !== 'plan') {
    for (const placement of SCALE_PLACEMENTS) rasterRabbit(raster, rabbit, placement, projection);
    if (probe) {
      const result = rasterRabbit(raster, rabbit, OCCLUSION_PLACEMENT, projection);
      canvas.dataset.probeVisible = String(result.visible);
      canvas.dataset.probeHidden = String(result.hidden);
    }
  }
  canvas.width = STUDY_WIDTH;
  canvas.height = STUDY_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create the landform study canvas.');
  const image = context.createImageData(STUDY_WIDTH, STUDY_HEIGHT);
  image.data.set(raster.pixels);
  context.putImageData(image, 0, 0);
  canvas.dataset.projection = projection;
  canvas.dataset.fixture = LANDFORM_FIXTURE.map(mass => `${mass.id}:${mass.height}`).join('|');
  return raster;
}
