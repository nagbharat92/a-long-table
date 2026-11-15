import { assertWaterSettings, DEFAULT_WATER_SETTINGS, type WaterSettings } from './island-water-settings';

export const WATER_NOISE_PATCH_SIZE = 256;
export const WATER_NOISE_TIME_PERIOD = 2560;

const wrap = (value: number, period: number) => ((value % period) + period) % period;

/** One existing seeded scalar patch field, bilinearly sampled at unsnapped world coordinates. */
export function sampleWaterNoise(
  patches: Uint8Array, x: number, y: number, seconds: number,
  settings: Readonly<WaterSettings> = DEFAULT_WATER_SETTINGS,
): number {
  if (!(patches instanceof Uint8Array) || patches.length !== WATER_NOISE_PATCH_SIZE ** 2) {
    throw new RangeError('Water patches must be a 256 by 256 Uint8Array.');
  }
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(seconds)) {
    throw new RangeError('Water noise coordinates and seconds must be finite.');
  }
  if (settings !== DEFAULT_WATER_SETTINGS) assertWaterSettings(settings);
  const phase = wrap(seconds, WATER_NOISE_TIME_PERIOD) * (2 * Math.PI / WATER_NOISE_TIME_PERIOD);
  // Speed scales the radius, not the phase: every supported speed/scale closes at the shared clock wrap.
  const radius = settings.noiseSpeed * WATER_NOISE_TIME_PERIOD / (2 * Math.PI);
  const px = wrap(x / settings.noiseScale + radius * Math.sin(phase) / settings.noiseScale, WATER_NOISE_PATCH_SIZE);
  const py = wrap(y / settings.noiseScale + radius * (1 - Math.cos(phase)) / settings.noiseScale, WATER_NOISE_PATCH_SIZE);
  const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
  const right = (ix + 1) % WATER_NOISE_PATCH_SIZE, bottom = (iy + 1) % WATER_NOISE_PATCH_SIZE;
  const a = patches[iy * WATER_NOISE_PATCH_SIZE + ix], b = patches[iy * WATER_NOISE_PATCH_SIZE + right];
  const c = patches[bottom * WATER_NOISE_PATCH_SIZE + ix], d = patches[bottom * WATER_NOISE_PATCH_SIZE + right];
  return ((a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy) / 255 * 2 - 1;
}

/** Requires the existing u_patches sampler and u_waterNoise from WATER_PALETTE_GLSL. */
export const WATER_NOISE_GLSL = `
float waterPatchScalar(sampler2D patches, vec2 cell) {
  return texture2D(patches,(mod(cell,${WATER_NOISE_PATCH_SIZE.toFixed(1)})+0.5)/${WATER_NOISE_PATCH_SIZE.toFixed(1)}).a;
}
float sampleWaterNoise(sampler2D patches, vec2 worldPoint, float seconds, vec2 scaleSpeed) {
  float phase=mod(seconds,${WATER_NOISE_TIME_PERIOD.toFixed(1)})*(6.283185307179586/${WATER_NOISE_TIME_PERIOD.toFixed(1)});
  float radius=scaleSpeed.y*(${WATER_NOISE_TIME_PERIOD.toFixed(1)}/6.283185307179586);
  vec2 drift=radius*vec2(sin(phase),1.0-cos(phase));
  vec2 point=mod(worldPoint/scaleSpeed.x+drift/scaleSpeed.x,${WATER_NOISE_PATCH_SIZE.toFixed(1)});
  vec2 cell=floor(point), blend=fract(point);
  float a=waterPatchScalar(patches,cell), b=waterPatchScalar(patches,cell+vec2(1.0,0.0));
  float c=waterPatchScalar(patches,cell+vec2(0.0,1.0)), d=waterPatchScalar(patches,cell+vec2(1.0));
  return mix(mix(a,b,blend.x),mix(c,d,blend.x),blend.y)*2.0-1.0;
}
float sampleWaterNoise(vec2 worldPoint, float seconds) {
  return sampleWaterNoise(u_patches,worldPoint,seconds,u_waterNoise.zw);
}
`;
