import { projectLandVertex, type LandCamera, type LandProjection, type LandVertex } from '../core/landform-study';
import type { LandRaster } from './landform-study';
import type { SurfaceColor } from './island-surface';
import { waterViewDirection } from './island-water-surface';

const WATER_REFRACTIVE_INDEX = 1.333;
const REFRACTION_STRENGTH = 12;
const MAX_FLAT_OFFSET = 1.5;
const MAX_RIPPLE_OFFSET = 2.25;

const smooth = (a: number, b: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function waterRefractionOffset(
  depth: number, distance: number, normal: LandVertex, view: LandVertex = { x: 0, y: 0, z: 1 },
) {
  if (![depth, normal.x, normal.y, normal.z, view.x, view.y, view.z].every(Number.isFinite)
    || Number.isNaN(distance) || depth < 0 || normal.z <= 0 || view.z <= 0)
    throw new RangeError('Refraction needs finite upward normals and views, and nonnegative depth.');
  const nl = Math.hypot(normal.x, normal.y, normal.z), vl = Math.hypot(view.x, view.y, view.z);
  const n = { x: normal.x / nl, y: normal.y / nl, z: normal.z / nl };
  const v = { x: view.x / vl, y: view.y / vl, z: view.z / vl };
  const eta = 1 / WATER_REFRACTIVE_INDEX;
  const cosine = Math.max(0, Math.min(1, n.x * v.x + n.y * v.y + n.z * v.z));
  const bend = Math.sqrt(1 - eta * eta * (1 - cosine * cosine)) - eta * cosine;
  const rayZ = eta * v.z + bend * n.z;
  const flatRayZ = Math.sqrt(1 - eta * eta * (1 - v.z * v.z));
  const strength = depth * smooth(0, 0.25, depth) * smooth(0.5, 3, distance);
  // Displacement relative to the unrefracted camera ray, at the bottom's height.
  const flatX = (v.x / v.z - eta * v.x / flatRayZ) * strength;
  const flatY = (v.y / v.z - eta * v.y / flatRayZ) * strength;
  const rippleX = (eta * v.x / flatRayZ - (eta * v.x + bend * n.x) / rayZ) * REFRACTION_STRENGTH * strength;
  const rippleY = (eta * v.y / flatRayZ - (eta * v.y + bend * n.y) / rayZ) * REFRACTION_STRENGTH * strength;
  // A static oblique bend must not consume the animated ripple's displacement budget.
  const flatScale = Math.max(1, Math.hypot(flatX, flatY) / MAX_FLAT_OFFSET);
  const rippleScale = Math.max(1, Math.hypot(rippleX, rippleY) / MAX_RIPPLE_OFFSET);
  return { x: flatX / flatScale + rippleX / rippleScale, y: flatY / flatScale + rippleY / rippleScale };
}

export function waterBedBlurRadius(depth: number): number {
  if (!Number.isFinite(depth) || depth < 0) throw new RangeError('Bottom blur needs finite nonnegative depth.');
  return 0.65 * smooth(0.75, 5.5, depth);
}

export function createWaterRefraction(
  raster: LandRaster, original: Uint8ClampedArray, width: number, height: number,
  originY: number, projection: LandProjection, camera?: LandCamera,
) {
  const view = camera ? { yaw: camera.yaw, center: { x: 0, y: 0 } } : undefined;
  const direction = waterViewDirection(projection, camera?.yaw);
  const groundHeight = (index: number) => {
    const screenY = Math.floor(index / width) + 0.5 - originY;
    return projection === 'current' ? (raster.depth[index] - screenY) / 2
      : (raster.depth[index] - screenY * 2) / 2.7225;
  };
  return (index: number, surfaceHeight: number, distance: number, normal: LandVertex,
    options?: { refraction?: boolean; blur?: boolean; opticalDepth?: number }): SurfaceColor => {
    const pixel = index * 4;
    const source: SurfaceColor = [original[pixel], original[pixel + 1], original[pixel + 2]];
    const ground = groundHeight(index);
    if (!Number.isFinite(ground) || ground >= surfaceHeight - 0.01) return source;
    const depth = surfaceHeight - ground;
    const offset = options?.refraction === false ? { x: 0, y: 0 } : waterRefractionOffset(depth, distance, normal, direction);
    const screen = projectLandVertex({ ...offset, z: 0 }, projection, view);
    const x = index % width + screen.x, y = Math.floor(index / width) + screen.y;
    const bilinear = (x: number, y: number): SurfaceColor => {
      const left = Math.floor(x), top = Math.floor(y), fx = x - left, fy = y - top;
      const result = [...source];
      for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
        const sx = left + dx, sy = top + dy;
        if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
        const sample = sy * width + sx, z = groundHeight(sample);
        // Guard every blur/refraction tap, not just the center sample.
        if (!Number.isFinite(z) || z >= surfaceHeight - 0.01 || Math.abs(z - ground) > 1.25
          || Boolean(raster.submerged?.[sample]) !== Boolean(raster.submerged?.[index])) continue;
        const weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
        for (let channel = 0; channel < 3; channel++)
          result[channel] += (original[sample * 4 + channel] - source[channel]) * weight;
      }
      return [result[0], result[1], result[2]];
    };
    const center = bilinear(x, y);
    const radius = options?.blur === false ? 0 : waterBedBlurRadius(options?.opticalDepth ?? depth);
    if (!radius) return center;
    const taps = [bilinear(x - radius, y), bilinear(x + radius, y),
      bilinear(x, y - radius), bilinear(x, y + radius)];
    const result = center.map((value, channel) => value * 0.4
      + taps.reduce((sum, tap) => sum + tap[channel] * 0.15, 0));
    return [result[0], result[1], result[2]];
  };
}

export const WATER_REFRACTION_GLSL = `
vec2 waterRefractionOffset(float depth, float distance, vec3 normal, vec3 view) {
  normal=normalize(normal);
  view=normalize(view);
  float eta=${(1 / WATER_REFRACTIVE_INDEX).toFixed(12)};
  float cosine=clamp(dot(normal,view),0.0,1.0);
  float bend=sqrt(1.0-eta*eta*(1.0-cosine*cosine))-eta*cosine;
  vec3 ray=-eta*view-bend*normal;
  float flatRayZ=sqrt(1.0-eta*eta*(1.0-view.z*view.z));
  vec2 flatRay=-eta*view.xy/flatRayZ;
  float strength=depth*smoothstep(0.0,0.25,depth)*smoothstep(0.5,3.0,distance);
  vec2 flatOffset=(view.xy/view.z+flatRay)*strength;
  vec2 rippleOffset=(ray.xy/(-ray.z)-flatRay)*${REFRACTION_STRENGTH.toFixed(1)}*strength;
  return flatOffset/max(1.0,length(flatOffset)/${MAX_FLAT_OFFSET.toFixed(1)})
    +rippleOffset/max(1.0,length(rippleOffset)/${MAX_RIPPLE_OFFSET.toFixed(2)});
}
float waterBedBlurRadius(float depth) {
  return 0.65*smoothstep(0.75,5.5,depth);
}
`;
