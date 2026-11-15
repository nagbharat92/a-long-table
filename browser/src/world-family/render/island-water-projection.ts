import type { SurfaceColor } from './island-surface';
import { sampleWaterNoise, WATER_NOISE_PATCH_SIZE } from './island-water-noise';
import { assertWaterSettings, DEFAULT_WATER_SETTINGS, type WaterSettings } from './island-water-settings';

export const WATER_PROJECTED_PALETTE_STEPS = 8;
export const WATER_PROJECTED_TEXEL_SIZE = 1;
export const WATER_EDGE_MOTION_PERIOD = 16;
export const WATER_EDGE_MOTION_STRENGTH = 0.25;

const clamp = (value: number, maximum = 1) => Math.max(0, Math.min(maximum, value));
// Only integer texel indices reach this power-of-two wrap, including negative indices.
const wrap = (value: number) => value & (WATER_NOISE_PATCH_SIZE - 1);
const blend = (position: number, softness: number) => {
  const t = clamp(position);
  const cubic = t * t * (3 - 2 * t);
  const quintic = t * t * t * (t * (t * 6 - 15) + 10);
  return quintic + (cubic - quintic) * softness;
};
const contrast = (a: SurfaceColor, b: SurfaceColor) => Math.max(1, ...a.map((value, channel) => Math.abs(value - b[channel])));
const choose = (position: number, threshold: number) => {
  const low = Math.floor(position);
  return low + (position - low > threshold ? 1 : 0);
};

/**
 * Shape, palette dither and tone dither. All three masks are stationary on one-unit
 * world texels; fine masks scramble seeded alpha bytes, not the coherent shape.
 */
export function sampleProjectedWaterMasks(
  patches: Uint8Array, x: number, y: number, settings: Readonly<WaterSettings>,
): readonly [number, number, number] {
  if (!(patches instanceof Uint8Array) || patches.length !== WATER_NOISE_PATCH_SIZE ** 2) {
    throw new RangeError('Water patches must be a 256 by 256 Uint8Array.');
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError('Projected water coordinates must be finite.');
  if (settings !== DEFAULT_WATER_SETTINGS) assertWaterSettings(settings);
  const tx = Math.floor(x / WATER_PROJECTED_TEXEL_SIZE), ty = Math.floor(y / WATER_PROJECTED_TEXEL_SIZE);
  const px = tx + 0.5, py = ty + 0.5;
  const shape = sampleWaterNoise(patches, px + 13, py - 29, 0, settings) * 0.7
    + sampleWaterNoise(patches, -py + 83, px + 137, 0, settings) * 0.3;
  const cx = wrap(tx), cy = wrap(ty);
  const byte = (u: number, v: number) => patches[wrap(v) * WATER_NOISE_PATCH_SIZE + wrap(u)];
  const a = byte(cx * 37 + cy * 17 + 91, cy * 53 - cx * 11 + 47);
  const b = byte(cx * 23 - cy * 41 + 173, cy * 31 + cx * 43 + 113);
  // Bounded integer arithmetic is exact in shader highp; midpoint thresholds never equal 0 or 1.
  const dither = (a * 73 + b * 151 + cx * 19 + cy * 29) % 256;
  const toneDither = (a * 137 + b * 61 + cx * 43 + cy * 101 + 67) % 256;
  return [shape, (dither + 0.5) / 256, (toneDither + 0.5) / 256];
}

/**
 * Finite neighbouring palette shades, in encoded RGB bytes, before sunlight/optics.
 * Supply foundation depth sampled at floor(world.xy)+0.5 to keep the entire color
 * texel constant. Never snap geometry, wave coordinates or optical depth.
 * Shape and dither masks stay stationary. Slow coherent coverage motion changes
 * only the choice between existing neighbours; integer tone drifts separately.
 * noiseEnabled disables shape/motion/tone, not the spatial palette dither.
 */
export function projectedWaterColor(
  depth: number, patches: Uint8Array, x: number, y: number, seconds: number,
  settings: Readonly<WaterSettings>, noiseEnabled: boolean,
): SurfaceColor {
  if (!Number.isFinite(depth) || depth < 0) throw new RangeError('Water depth must be finite and nonnegative.');
  if (!Number.isFinite(seconds)) throw new RangeError('Projected water seconds must be finite.');
  if (typeof noiseEnabled !== 'boolean') throw new TypeError('Projected water noiseEnabled must be boolean.');
  const [shape, dither, toneDither] = sampleProjectedWaterMasks(patches, x, y, settings);
  const shallowBlend = blend(depth / settings.transitionDepth, settings.blendSoftness);
  const deepBlend = blend((depth - settings.transitionDepth) / (settings.deepDepth - settings.transitionDepth), settings.blendSoftness);
  const amplitude = settings.noiseShallow + (settings.noiseDeep - settings.noiseShallow) * clamp(depth / settings.deepDepth);
  const span = depth < settings.transitionDepth ? contrast(settings.shallow, settings.middle) : contrast(settings.middle, settings.deep);
  const noise = noiseEnabled ? shape : 0;
  // Move color progress only. The offshore taper prevents rare, bright shelf pixels at the deep anchor.
  const position = clamp((shallowBlend + deepBlend) * WATER_PROJECTED_PALETTE_STEPS
    + noise * amplitude * WATER_PROJECTED_PALETTE_STEPS / span * (1 - deepBlend), WATER_PROJECTED_PALETTE_STEPS * 2);
  const fraction = position - Math.floor(position);
  const motionStrength = noiseEnabled
    ? WATER_EDGE_MOTION_STRENGTH * clamp(amplitude / 2) * clamp(settings.noiseSpeed / 0.2) : 0;
  const time = ((seconds % WATER_EDGE_MOTION_PERIOD) + WATER_EDGE_MOTION_PERIOD) % WATER_EDGE_MOTION_PERIOD;
  const motion = motionStrength > 0
    ? Math.sin(time * (2 * Math.PI / WATER_EDGE_MOTION_PERIOD) + shape * 2 * Math.PI) * motionStrength : 0;
  // The envelope vanishes at shade anchors and cannot cross into another shade pair.
  const stop = choose(position + motion * 4 * fraction * (1 - fraction), dither);
  const t = stop <= WATER_PROJECTED_PALETTE_STEPS
    ? stop / WATER_PROJECTED_PALETTE_STEPS : (stop - WATER_PROJECTED_PALETTE_STEPS) / WATER_PROJECTED_PALETTE_STEPS;
  const from = stop <= WATER_PROJECTED_PALETTE_STEPS ? settings.shallow : settings.middle;
  const to = stop <= WATER_PROJECTED_PALETTE_STEPS ? settings.middle : settings.deep;
  const toneNoise = noiseEnabled && amplitude > 0
    ? sampleWaterNoise(patches, Math.floor(x / WATER_PROJECTED_TEXEL_SIZE) + 0.5,
      Math.floor(y / WATER_PROJECTED_TEXEL_SIZE) + 0.5, seconds, settings) : 0;
  const tone = choose(toneNoise * amplitude, toneDither);
  const component = (channel: number) => clamp(Math.floor(from[channel] + (to[channel] - from[channel]) * t + 0.5) + tone, 255);
  return [component(0), component(1), component(2)];
}

/**
 * Append after WATER_PALETTE_GLSL and WATER_NOISE_GLSL with the existing u_patches
 * sampler declared. Uniform layout is unchanged. Use highp float and NEAREST
 * patch sampling. projectedWaterColor(depth, world.xy, seconds, noiseEnabled)
 * returns encoded bytes; the caller samples color depth at floor(world.xy)+0.5.
 */
export const WATER_PROJECTION_GLSL = `
vec3 waterMasks(vec2 point){
vec2 texel=floor(point/${WATER_PROJECTED_TEXEL_SIZE}.0),p=texel+0.5;
float shape=sampleWaterNoise(p+vec2(13.,-29.),0.)*0.7
+sampleWaterNoise(vec2(-p.y+83.,p.x+137.),0.)*0.3;
vec2 c=mod(texel,256.);
float a=floor(waterPatchScalar(u_patches,mat2(37.,-11.,17.,53.)*c+vec2(91.,47.))*255.+0.5);
float b=floor(waterPatchScalar(u_patches,mat2(23.,43.,-41.,31.)*c+vec2(173.,113.))*255.+0.5);
vec2 dither=mod(a*vec2(73.,137.)+b*vec2(151.,61.)
+c.x*vec2(19.,43.)+c.y*vec2(29.,101.)+vec2(0.,67.),256.);
return vec3(shape,(dither+0.5)/256.);
}
float waterPick(float pos,float cut){
return floor(pos)+(fract(pos)>cut?1.:0.);
}
vec3 projectedWaterColor(float depth,vec2 point,float seconds,float enabled){
vec3 masks=waterMasks(point);
float shelf=waterPaletteBlend(depth/u_waterDepth.x,u_waterDepth.z);
float offshore=waterPaletteBlend((depth-u_waterDepth.x)/(u_waterDepth.y-u_waterDepth.x),u_waterDepth.z);
float amp=mix(u_waterNoise.x,u_waterNoise.y,clamp(depth/u_waterDepth.y,0.,1.));
vec3 delta=abs(depth<u_waterDepth.x?u_waterShallow-u_waterMiddle:u_waterMiddle-u_waterDeep);
float span=max(1.,max(delta.x,max(delta.y,delta.z)));
float noise=enabled>0.5?masks.x:0.;
float pos=clamp((shelf+offshore)*${WATER_PROJECTED_PALETTE_STEPS}.0
+noise*amp*${WATER_PROJECTED_PALETTE_STEPS}.0/span*(1.-offshore),0.,${WATER_PROJECTED_PALETTE_STEPS * 2}.0);
float fraction=fract(pos);
float strength=enabled>0.5?${WATER_EDGE_MOTION_STRENGTH}*clamp(amp/2.,0.,1.)*clamp(u_waterNoise.w/0.2,0.,1.):0.;
float time=mod(seconds,${WATER_EDGE_MOTION_PERIOD}.0);
float motion=strength>0.?sin(time*${(2 * Math.PI / WATER_EDGE_MOTION_PERIOD).toFixed(16)}+masks.x*${(2 * Math.PI).toFixed(16)})*strength:0.;
float stop=waterPick(pos+motion*4.*fraction*(1.-fraction),masks.y);
vec3 color=stop<=${WATER_PROJECTED_PALETTE_STEPS}.0?mix(u_waterShallow,u_waterMiddle,stop/${WATER_PROJECTED_PALETTE_STEPS}.0)
:mix(u_waterMiddle,u_waterDeep,(stop-${WATER_PROJECTED_PALETTE_STEPS}.0)/${WATER_PROJECTED_PALETTE_STEPS}.0);
float drift=enabled>0.5&&amp>0.?sampleWaterNoise(floor(point/${WATER_PROJECTED_TEXEL_SIZE}.0)+0.5,seconds):0.;
return clamp(floor(color+0.5)+waterPick(drift*amp,masks.z),0.,255.);
}
`;
