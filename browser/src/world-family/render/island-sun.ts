import type { LandTriangle, LandVertex } from '../core/landform-study';
import { createTriangleRayQuery } from './triangle-ray-query';

export interface SunSettings {
  azimuth: number;
  elevation: number;
  intensity: number;
  skyFill: number;
  warmth: number;
  shadowStrength: number;
  /** Filtered: radius in world units. Contact: angular source diameter in degrees. */
  softness: number;
  shadowMode: 'hard' | 'filtered' | 'contact';
  mapSize: 512 | 1024 | 2048;
}

export const DEFAULT_SUN: Readonly<SunSettings> = Object.freeze({
  azimuth: 230, elevation: 40, intensity: 1, skyFill: 0.3, warmth: 0.3,
  shadowStrength: 1, softness: 2, shadowMode: 'contact', mapSize: 1024,
});

const numericFields = [
  ['azimuth', 'sunAzimuth', 0, 360], ['elevation', 'sunElevation', 10, 85],
  ['intensity', 'sunIntensity', 0, 2], ['skyFill', 'skyFill', 0, 1],
  ['warmth', 'sunWarmth', 0, 1], ['shadowStrength', 'shadowStrength', 0, 1],
  ['softness', 'shadowSoftness', 0, 8],
] as const;

export function validateSunSettings(input: SunSettings): SunSettings {
  for (const [field, , min, max] of numericFields) {
    if (typeof input[field] !== 'number' || !Number.isFinite(input[field]) || input[field] < min || input[field] > max) {
      throw new Error(`Sun ${field} must be finite and between ${min} and ${max}.`);
    }
  }
  if (!['hard', 'filtered', 'contact'].includes(input.shadowMode)) throw new Error('Invalid sun shadowMode.');
  if (![512, 1024, 2048].includes(input.mapSize)) throw new Error('Sun mapSize must be 512, 1024 or 2048.');
  return {
    azimuth: input.azimuth, elevation: input.elevation, intensity: input.intensity,
    skyFill: input.skyFill, warmth: input.warmth, shadowStrength: input.shadowStrength,
    softness: input.softness, shadowMode: input.shadowMode, mapSize: input.mapSize,
  };
}

export function sunSettingsFromParameters(params: URLSearchParams): SunSettings {
  const settings = { ...DEFAULT_SUN };
  for (const parameter of [...numericFields.map(([, parameter]) => parameter), 'shadowMode', 'shadowQuality']) {
    if (params.getAll(parameter).length > 1) throw new Error(`Duplicate ${parameter}.`);
  }
  for (const [field, parameter] of numericFields) {
    const value = params.get(parameter);
    if (value !== null) {
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) throw new Error(`Invalid ${parameter}.`);
      settings[field] = Number(value);
    }
  }
  const mode = params.get('shadowMode'), quality = params.get('shadowQuality');
  if (mode !== null) settings.shadowMode = mode as SunSettings['shadowMode'];
  if (quality !== null) {
    if (!/^(512|1024|2048)$/.test(quality)) throw new Error('Invalid shadowQuality.');
    settings.mapSize = Number(quality) as SunSettings['mapSize'];
  }
  return validateSunSettings(settings);
}

export function sunParameters(settings: SunSettings): URLSearchParams {
  const valid = validateSunSettings(settings), params = new URLSearchParams();
  for (const [field, parameter] of numericFields) params.set(parameter, String(valid[field]));
  params.set('shadowMode', valid.shadowMode);
  params.set('shadowQuality', String(valid.mapSize));
  return params;
}

interface Normal { x: number; y: number; z: number }
export interface IslandSun {
  readonly settings: Readonly<SunSettings>;
  /** Unit vector towards the sun; azimuth runs from +X towards +Y, Z is up. */
  readonly direction: { x: number; y: number; z: number };
  /** Raw cast visibility. Normal defaults to +Z; precise opts curved receivers into exact mesh rays. */
  visibility(point: LandVertex, normal?: Normal, precise?: boolean): number;
  /** Textured sRGB bytes in/out; local sky scaling leaves direct light and cast visibility unchanged. */
  shade(color: readonly number[], normal: Normal, visibility?: number, skyFillScale?: number): readonly [number, number, number];
}

/**
 * Two-sided triangle shadow map, with no camera/viewport dependency or heightfield
 * approximation. A fixed enclosing sphere gives all azimuths the same map scale.
 * Ocean receivers along a cast ray share the caster's light-space XY, even at low
 * elevations; no world-XY ocean extent or perspective near/far formula is needed.
 */
export function createIslandSun(triangles: readonly LandTriangle[], settings: SunSettings = DEFAULT_SUN): IslandSun {
  const valid = Object.freeze(validateSunSettings(settings));
  const azimuth = valid.azimuth * Math.PI / 180, elevation = valid.elevation * Math.PI / 180;
  const ca = Math.cos(azimuth), sa = Math.sin(azimuth), ce = Math.cos(elevation), se = Math.sin(elevation);
  const direction = Object.freeze({ x: ca * ce, y: sa * ce, z: se });
  const ux = -sa, uy = ca, vx = -ca * se, vy = -sa * se, vz = ce;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity, front = -Infinity;
  for (const triangle of triangles) for (const p of triangle.vertices) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) throw new Error('Sun geometry must be finite.');
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    front = Math.max(front, p.x * direction.x + p.y * direction.y + p.z * direction.z);
  }
  const empty = triangles.length === 0;
  const cx = empty ? 0 : (minX + maxX) / 2, cy = empty ? 0 : (minY + maxY) / 2;
  const cz = empty ? 0 : (minZ + maxZ) / 2;
  const radius = empty ? 1 : Math.max(1, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2);
  const angularRadius = Math.tan(valid.softness * Math.PI / 360);
  // Reserve the largest supported source/filter footprint, even in hard mode:
  // changing softness/mode must not move texel centers or change hard coverage.
  const padding = 8 + radius * 2 * Math.tan(4 * Math.PI / 180);
  const size = valid.mapSize, span = 2 * (radius + padding), texel = span / size, scale = 1 / texel;
  const originU = cx * ux + cy * uy - span / 2;
  const originV = cx * vx + cy * vy + cz * vz - span / 2;
  const depth = new Float32Array(size * size);
  depth.fill(-Infinity);
  for (const triangle of triangles) {
    const points = triangle.vertices.map(p => ({
      u: (p.x * ux + p.y * uy - originU) * scale - 0.5,
      v: (p.x * vx + p.y * vy + p.z * vz - originV) * scale - 0.5,
      d: p.x * direction.x + p.y * direction.y + p.z * direction.z,
    }));
    const [a, b, c] = points;
    const bu = b.u - a.u, bv = b.v - a.v, cu = c.u - a.u, cv = c.v - a.v;
    const determinant = bu * cv - bv * cu;
    if (Math.abs(determinant) < 1e-10) continue;
    const du = ((b.d - a.d) * cv - (c.d - a.d) * bv) / determinant;
    const dv = (bu * (c.d - a.d) - cu * (b.d - a.d)) / determinant;
    const x0 = Math.max(0, Math.ceil(Math.min(a.u, b.u, c.u)));
    const x1 = Math.min(size - 1, Math.floor(Math.max(a.u, b.u, c.u)));
    const y0 = Math.max(0, Math.ceil(Math.min(a.v, b.v, c.v)));
    const y1 = Math.min(size - 1, Math.floor(Math.max(a.v, b.v, c.v)));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const s = ((x - a.u) * cv - (y - a.v) * cu) / determinant;
      const t = (bu * (y - a.v) - bv * (x - a.u)) / determinant;
      if (s < -1e-8 || t < -1e-8 || s + t > 1 + 1e-8) continue;
      const d = a.d + du * (x - a.u) + dv * (y - a.v), index = y * size + x;
      if (d > depth[index]) depth[index] = d;
    }
  }

  // Bounded, deterministic disk: center plus inner/outer rings catch thin contacts.
  const kernelX = [0], kernelY = [0];
  for (const [count, r, phase] of [[5, 0.35, 0], [10, 1, 0.31]]) {
    for (let i = 0; i < count; i++) {
      const angle = i * 2 * Math.PI / count + phase;
      kernelX.push(Math.cos(angle) * r); kernelY.push(Math.sin(angle) * r);
    }
  }
  const up = Object.freeze({ x: 0, y: 0, z: 1 });
  let rayQuery: ReturnType<typeof createTriangleRayQuery> | undefined;
  function preciseVisibility(point: LandVertex, normal: Normal): number {
    rayQuery ??= createTriangleRayQuery(triangles);
    const count = valid.shadowMode === 'hard' || valid.softness === 0 ? 1 : kernelX.length;
    let lit = 0;
    for (let i = 0; i < count; i++) {
      const x = kernelX[i], y = kernelY[i];
      let origin = point, ray = direction;
      if (valid.shadowMode === 'filtered') {
        const dx = (ux * x + vx * y) * valid.softness;
        const dy = (uy * x + vy * y) * valid.softness;
        const dz = vz * y * valid.softness;
        const nd = normal.x * direction.x + normal.y * direction.y + normal.z * direction.z;
        const correction = Math.abs(nd) > 1e-5 ? -(normal.x * dx + normal.y * dy + normal.z * dz) / nd : 0;
        origin = {
          x: point.x + dx + direction.x * correction,
          y: point.y + dy + direction.y * correction,
          z: point.z + dz + direction.z * correction,
        };
      } else if (count > 1) {
        ray = {
          x: direction.x + angularRadius * (ux * x + vx * y),
          y: direction.y + angularRadius * (uy * x + vy * y),
          z: direction.z + angularRadius * vz * y,
        };
      }
      if (!rayQuery(origin, ray)) lit++;
    }
    return lit / count;
  }
  function visibility(point: LandVertex, normal: Normal = up, precise = false): number {
    if (empty) return 1;
    if (precise) return preciseVisibility(point, normal);
    const u = (point.x * ux + point.y * uy - originU) * scale - 0.5;
    const v = (point.x * vx + point.y * vy + point.z * vz - originV) * scale - 0.5;
    if (u < -0.5 || v < -0.5 || u >= size - 0.5 || v >= size - 0.5) return 1;
    const d = point.x * direction.x + point.y * direction.y + point.z * direction.z;
    const nd = normal.x * direction.x + normal.y * direction.y + normal.z * direction.z;
    // Receiver-plane depth correction handles slopes AND PCF offsets without a
    // large slope bias that would detach the foot of cliffs/stairs.
    const inverse = Math.abs(nd) > 1e-5 ? 1 / nd : 0;
    const slopeU = -(normal.x * ux + normal.y * uy) * inverse * texel;
    const slopeV = -(normal.x * vx + normal.y * vy + normal.z * vz) * inverse * texel;
    const bias = 0.001 + texel * 0.003;
    const ix = Math.floor(u + 0.5), iy = Math.floor(v + 0.5);
    const central = depth[iy * size + ix] - (d + slopeU * (ix - u) + slopeV * (iy - v));
    if (valid.shadowMode === 'hard' || valid.softness === 0) return central > bias ? 0 : 1;
    let filterRadius = valid.softness * scale;
    if (valid.shadowMode === 'contact') {
      const searchRadius = Math.max(0, front - d) * angularRadius * scale;
      let separation = 0, blockers = 0;
      for (let i = 0; i < kernelX.length; i++) {
        const x = Math.floor(u + kernelX[i] * searchRadius + 0.5);
        const y = Math.floor(v + kernelY[i] * searchRadius + 0.5);
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const delta = depth[y * size + x] - (d + slopeU * (x - u) + slopeV * (y - v));
        if (delta > bias) { separation += delta; blockers++; }
      }
      if (!blockers) return 1;
      // Orthographic directional light: penumbra = separation * tan(half angle).
      filterRadius = separation / blockers * angularRadius * scale;
      if (filterRadius < 0.25) return central > bias ? 0 : 1;
    }
    let lit = 0;
    for (let i = 0; i < kernelX.length; i++) {
      const x = Math.floor(u + kernelX[i] * filterRadius + 0.5);
      const y = Math.floor(v + kernelY[i] * filterRadius + 0.5);
      if (x < 0 || y < 0 || x >= size || y >= size
        || depth[y * size + x] <= d + slopeU * (x - u) + slopeV * (y - v) + bias) lit++;
    }
    return lit / kernelX.length;
  }

  // Local immutable-in-practice tables: no shared mutable state and no pow per
  // channel per receiver. Interpolated decoding preserves fractional texture values.
  const decode = Float64Array.from({ length: 256 }, (_, i) => {
    const s = i / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const encode = Uint8Array.from({ length: 4097 }, (_, i) => {
    const l = i / 4096;
    return Math.round(255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055));
  });
  function channel(source: number, light: number): number {
    const value = Number.isFinite(source) ? Math.max(0, Math.min(255, source)) : 0;
    const lo = Math.floor(value), hi = Math.min(255, lo + 1);
    const linear = (decode[lo] + (decode[hi] - decode[lo]) * (value - lo)) * light;
    return encode[Math.round(Math.max(0, Math.min(4096, Number.isFinite(linear) ? linear * 4096 : 0)))];
  }
  function shade(color: readonly number[], normal: Normal, rawVisibility = 1, skyFillScale = 1): readonly [number, number, number] {
    const cosine = Math.max(0, normal.x * direction.x + normal.y * direction.y + normal.z * direction.z);
    const visible = Number.isFinite(rawVisibility) ? Math.max(0, Math.min(1, rawVisibility)) : 1;
    const direct = valid.intensity * cosine * (1 - valid.shadowStrength * (1 - visible));
    const sky = valid.skyFill * (0.8 + 0.2 * Math.max(0, normal.z)) * skyFillScale;
    const red = direct * (1 + valid.warmth * 0.12) + sky * 0.92;
    const green = direct * (1 - valid.warmth * 0.04) + sky * 0.98;
    const blue = direct * (1 - valid.warmth * 0.22) + sky * 1.08;
    return [channel(color[0], red), channel(color[1], green), channel(color[2], blue)];
  }
  return Object.freeze({ settings: valid, direction, visibility, shade });
}
