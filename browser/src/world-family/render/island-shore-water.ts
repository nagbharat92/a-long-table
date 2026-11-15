import type { IslandShoreSample } from './island-shore-field';
import type { SurfaceColor } from './island-surface';
import { waterBodyColor, waterPaletteColor, WATER_MAX_DEPTH } from './island-water-color';
import type { WaterSettings } from './island-water-settings';
import { sampleBeachWash } from './island-beach-wash';
import { ISLAND_WATER_HEIGHT } from '../core/island-water-level';
import { WATER_FOAM_COLOR } from './island-water-foam';

export const ISLAND_SEA: SurfaceColor = [45, 100, 113];
const CONTACT: SurfaceColor = [30, 82, 96];
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (a: number, b: number, value: number) => {
  const t = clamp((value - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export interface ShoreWaterOptions {
  depthColor?: boolean;
  waves?: boolean;
  shoreFoam?: boolean;
  rockContact?: boolean;
  depth?: number;
  groundHeight?: number;
  compositeFoam?: boolean;
  waterSettings?: Readonly<WaterSettings>;
  signedNoise?: number;
  bodyColor?: SurfaceColor;
}

export function shadeShoreWater(
  shore: IslandShoreSample,
  seconds: number,
  shadow = 0,
  ocean: SurfaceColor = ISLAND_SEA,
  surface: SurfaceColor = [0, 0, 0],
  options?: ShoreWaterOptions,
): {
  color: SurfaceColor;
  foam: number;
  wash: number;
  wetness: number;
  height: number;
} {
  if (!Number.isFinite(seconds)) throw new Error('Water animation time must be finite.');
  const depth = options?.depthColor === false ? WATER_MAX_DEPTH : options?.depth ?? WATER_MAX_DEPTH;
  const baseBody = options?.bodyColor ?? (options?.waterSettings
    ? waterPaletteColor(depth, options.signedNoise ?? 0, options.waterSettings)
    : options?.depthColor === false ? ocean : waterBodyColor(ocean, depth));
  const body = baseBody.map((value, channel) => value + surface[channel]);
  const wash = options?.shoreFoam === true ? sampleBeachWash(shore, seconds, options.groundHeight, options.waterSettings?.waveEndSoftness)
    : { coverage: 0, foam: 0, wetness: 0, height: ISLAND_WATER_HEIGHT };
  if ((shore.distance <= 0 || shore.distance >= shore.shallowWidth) && !wash.coverage && !wash.foam) {
    return { color: [body[0], body[1], body[2]], foam: 0, wash: wash.coverage, wetness: wash.wetness, height: wash.height };
  }
  const shallowness = clamp(shore.distance / shore.shallowWidth + shore.breakup * 0.035);
  const useWaves = options?.waves === true;
  const contact = shore.distance > 0
    ? (1 - smooth(0.15, 1.4, shore.distance)) * (1 - shore.beachWeight) * 0.3 : 0;
  const foam = Math.max(wash.foam, options?.rockContact === true
    ? rockContactFoam(shore.distance, shore.beachWeight, shore.breakup, seconds) : 0);
  const ripple = useWaves && shore.distance > 0 ? Math.sin(shore.distance * 0.85 + seconds * 0.65 + shore.phase * 4)
    * (1 - shallowness) * shore.beachWeight * 1.3 : 0;
  const component = (channel: number) => {
    const base = body[channel] + ripple;
    const contactColor = base * (1 - contact) + CONTACT[channel] * contact;
    const coverage = options?.compositeFoam === false ? 0 : foam;
    return Math.round((contactColor * (1 - coverage) + WATER_FOAM_COLOR[channel] * coverage) * (1 - shadow));
  };
  return { color: [component(0), component(1), component(2)], foam, wash: wash.coverage, wetness: wash.wetness, height: wash.height };
}

export function rockContactFoam(distance: number, beach: number, breakup: number, seconds: number): number {
  if (Number.isNaN(distance) || ![beach, breakup, seconds].every(Number.isFinite))
    throw new RangeError('Rock contact needs a valid distance and finite beach weight, breakup and time.');
  if (distance <= 0 || distance >= 1.8 || beach >= 0.6) return 0;
  const time = ((seconds % 2560) + 2560) % 2560;
  const pulse = smooth(0.25, 0.85, 0.5 + 0.5 * Math.sin(time * Math.PI / 4 + breakup * 4));
  return smooth(0.05, 0.3, distance) * (1 - smooth(0.4, 1.8, distance))
    * (1 - smooth(0.15, 0.6, beach)) * smooth(-0.25, 0.25, breakup) * pulse * 0.14;
}

export const ROCK_CONTACT_GLSL = `
float rockContactFoam(float distance, float beach, float breakup, float seconds) {
  float pulse=smoothstep(0.25,0.85,0.5+0.5*sin(seconds*${(Math.PI / 4).toFixed(12)}+breakup*4.0));
  return smoothstep(0.05,0.3,distance)*(1.0-smoothstep(0.4,1.8,distance))
    *(1.0-smoothstep(0.15,0.6,beach))*smoothstep(-0.25,0.25,breakup)*pulse*0.14;
}
`;
