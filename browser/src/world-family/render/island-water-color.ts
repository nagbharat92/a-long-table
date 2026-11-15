import type { SurfaceColor } from './island-surface';
import { assertWaterSettings, DEFAULT_WATER_SETTINGS, WATER_MAX_DEPTH, type WaterSettings } from './island-water-settings';

export { WATER_MAX_DEPTH } from './island-water-settings';

export const WATER_COLOR_REACH = 128;
// All distance-led treatments end before 24 units; retain finer shoreline precision.
export const WATER_DISTANCE_SPAN = 32;

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (a: number, b: number, value: number) => {
  const t = clamp((value - a) / (b - a));
  return t * t * (3 - 2 * t);
};

const paletteBlend = (position: number, softness: number) => {
  const t = clamp(position);
  const cubic = t * t * (3 - 2 * t);
  const quintic = t * t * t * (t * (t * 6 - 15) + 10);
  return quintic + (cubic - quintic) * softness;
};

/** Fractional encoded RGB bytes; quantize only at final output, never during the depth ramp. */
export function waterPaletteColor(
  depth: number, signedNoise: number, settings: Readonly<WaterSettings> = DEFAULT_WATER_SETTINGS,
): SurfaceColor {
  if (!Number.isFinite(depth) || depth < 0) throw new RangeError('Water depth must be finite and nonnegative.');
  if (!Number.isFinite(signedNoise)) throw new RangeError('Water signedNoise must be finite.');
  if (settings !== DEFAULT_WATER_SETTINGS) assertWaterSettings(settings);
  const shallowBlend = paletteBlend(depth / settings.transitionDepth, settings.blendSoftness);
  const deepBlend = paletteBlend((depth - settings.transitionDepth) / (settings.deepDepth - settings.transitionDepth), settings.blendSoftness);
  const middleAmplitude = settings.noiseShallow + (settings.noiseDeep - settings.noiseShallow)
    * (settings.transitionDepth / settings.deepDepth);
  const shelfAmplitude = settings.noiseShallow + (middleAmplitude - settings.noiseShallow) * shallowBlend;
  const amplitude = shelfAmplitude + (settings.noiseDeep - shelfAmplitude) * deepBlend;
  const noise = Math.max(-1, Math.min(1, signedNoise)) * amplitude;
  const component = (channel: number) => {
    const shelf = settings.shallow[channel] + (settings.middle[channel] - settings.shallow[channel]) * shallowBlend;
    const body = shelf + (settings.deep[channel] - shelf) * deepBlend;
    return Math.max(0, Math.min(255, body + noise));
  };
  return [component(0), component(1), component(2)];
}

/** Legacy callers retain their ocean deep anchor; explicit settings own all three colors. */
export function waterBodyColor(
  ocean: SurfaceColor, depth: number, settings?: Readonly<WaterSettings>, signedNoise = 0,
): SurfaceColor {
  return waterPaletteColor(depth, signedNoise, settings ?? { ...DEFAULT_WATER_SETTINGS, deep: ocean });
}

export function waterBedTransmission(depth: number, bed: boolean): number {
  if (!Number.isFinite(depth) || depth < 0) throw new RangeError('Water depth must be finite and nonnegative.');
  if (bed) return Math.exp(-depth * 0.12) * 0.85 * (1 - smooth(0.75, 5.5, depth));
  return Math.exp(-depth * 0.22 - Math.max(0, depth - 0.75) * 0.1)
    * 0.55 * (1 - smooth(0.75, 3.5, depth));
}

/** Preserve the real bottom's lit texture and relief, without transmitting its brown hue. */
export function waterTintedBed(bottom: SurfaceColor, water: SurfaceColor): SurfaceColor {
  const luminance = bottom[0] * 0.2126 + bottom[1] * 0.7152 + bottom[2] * 0.0722;
  const gain = Math.min(255 / Math.max(1, ...water),
    Math.max(0.55, Math.min(1.5, 1 + (luminance - 140) / 64)));
  return [water[0] * gain, water[1] * gain, water[2] * gain];
}

// Keep the GPU equation in this module with its software reference.
export const WATER_BODY_GLSL = `
float waterPaletteBlend(float position, float softness) {
  float t=clamp(position,0.0,1.0);
  float cubic=t*t*(3.0-2.0*t);
  float quintic=t*t*t*(t*(t*6.0-15.0)+10.0);
  return mix(quintic,cubic,softness);
}
vec3 waterPaletteColor(float depth, float signedNoise, vec3 shallow, vec3 middle, vec3 deep,
  vec3 depthSettings, vec2 noiseAmplitudes) {
  float shallowBlend=waterPaletteBlend(depth/depthSettings.x,depthSettings.z);
  float deepBlend=waterPaletteBlend((depth-depthSettings.x)/(depthSettings.y-depthSettings.x),depthSettings.z);
  float middleAmplitude=mix(noiseAmplitudes.x,noiseAmplitudes.y,depthSettings.x/depthSettings.y);
  float amplitude=mix(mix(noiseAmplitudes.x,middleAmplitude,shallowBlend),noiseAmplitudes.y,deepBlend);
  vec3 shelf=mix(shallow,middle,shallowBlend);
  return clamp(mix(shelf,deep,deepBlend)+clamp(signedNoise,-1.0,1.0)*amplitude,0.0,255.0);
}
vec3 waterBodyColor(vec3 ocean, float depth) {
  return waterPaletteColor(depth,0.0,vec3(${DEFAULT_WATER_SETTINGS.shallow.map(v => v.toFixed(1)).join(',')}),
    vec3(${DEFAULT_WATER_SETTINGS.middle.map(v => v.toFixed(1)).join(',')}),ocean,
    vec3(${DEFAULT_WATER_SETTINGS.transitionDepth},${DEFAULT_WATER_SETTINGS.deepDepth.toFixed(1)},${DEFAULT_WATER_SETTINGS.blendSoftness}),vec2(0.0));
}
float waterBedTransmission(float depth, bool bed) {
  if (bed) return exp(-max(0.0,depth)*0.12)*0.85*(1.0-smoothstep(0.75,5.5,depth));
  return exp(-max(0.0,depth)*0.22-max(0.0,depth-0.75)*0.1)
    *0.55*(1.0-smoothstep(0.75,3.5,depth));
}
vec3 waterTintedBed(vec3 bottom, vec3 water) {
  float luminance=dot(bottom,vec3(0.2126,0.7152,0.0722));
  float gain=min(255.0/max(1.0,max(water.r,max(water.g,water.b))),
    clamp(1.0+(luminance-140.0)/64.0,0.55,1.5));
  return water*gain;
}
`;

/** Include this instead of WATER_BODY_GLSL to opt into editable uniform-backed palette/noise. */
export const WATER_PALETTE_GLSL = `${WATER_BODY_GLSL}
uniform vec3 u_waterShallow;
uniform vec3 u_waterMiddle;
uniform vec3 u_waterDeep;
uniform vec3 u_waterDepth;
uniform vec4 u_waterNoise;
vec3 waterPaletteColor(float depth, float signedNoise) {
  return waterPaletteColor(depth,signedNoise,u_waterShallow,u_waterMiddle,u_waterDeep,u_waterDepth,u_waterNoise.xy);
}
`;
