import type { SurfaceColor } from './island-surface';

export interface WaterSettings {
  /** Encoded RGB bytes, independent of the substrate and sunlight transfer. */
  shallow: SurfaceColor;
  middle: SurfaceColor;
  deep: SurfaceColor;
  /** Submerged foundation depth of the middle and deep palette anchors. */
  transitionDepth: number;
  deepDepth: number;
  /** 0: quintic palette coverage; 1: broader cubic coverage, resolved with spatial dithering. */
  blendSoftness: number;
  /** Maximum signed color variation in encoded byte levels, not depth displacement. */
  noiseShallow: number;
  noiseDeep: number;
  /** World units per baked patch texel, and world units per second of coherent drift. */
  noiseScale: number;
  noiseSpeed: number;
  waveEndSoftness: number;
}

export const WATER_MAX_DEPTH = 16;

export const DEFAULT_WATER_SETTINGS: Readonly<WaterSettings> = Object.freeze({
  shallow: Object.freeze([54, 191, 193] as const),
  middle: Object.freeze([31, 153, 176] as const),
  deep: Object.freeze([27, 113, 146] as const),
  transitionDepth: 3.5, deepDepth: 12, blendSoftness: 0.65,
  noiseShallow: 2, noiseDeep: 0.5, noiseScale: 4, noiseSpeed: 0.2,
  waveEndSoftness: 0.3,
});

export const WATER_COLOR_FIELDS = [
  ['shallow', 'waterShallow'], ['middle', 'waterMiddle'], ['deep', 'waterDeep'],
] as const;

export const WATER_NUMERIC_FIELDS = [
  ['transitionDepth', 'waterTransitionDepth', 0.1, WATER_MAX_DEPTH],
  ['deepDepth', 'waterDeepDepth', 0.2, WATER_MAX_DEPTH],
  ['blendSoftness', 'waterBlendSoftness', 0, 1],
  ['noiseShallow', 'waterNoiseShallow', 0, 24],
  ['noiseDeep', 'waterNoiseDeep', 0, 6],
  ['noiseScale', 'waterNoiseScale', 1, 32],
  ['noiseSpeed', 'waterNoiseSpeed', 0, 1],
  ['waveEndSoftness', 'waveEndSoftness', 0.05, 0.4],
] as const;

const isByte = (channel: unknown) => typeof channel === 'number' && Number.isInteger(channel) && channel >= 0 && channel <= 255;
const validatedFrozenSettings = new WeakSet<Readonly<WaterSettings>>();

/** Validation without allocation for CPU sampling; validation never mutates the source. */
export function assertWaterSettings(input: Readonly<WaterSettings>): void {
  if (!input || typeof input !== 'object') throw new Error('Water settings must be an object.');
  if (validatedFrozenSettings.has(input)) return;
  for (const [field] of WATER_COLOR_FIELDS) {
    const color = input[field];
    if (!Array.isArray(color) || color.length !== 3 || !isByte(color[0]) || !isByte(color[1]) || !isByte(color[2])) {
      throw new Error(`Water ${field} must contain three integer RGB bytes between 0 and 255.`);
    }
  }
  for (const [field, , min, max] of WATER_NUMERIC_FIELDS) {
    if (typeof input[field] !== 'number' || !Number.isFinite(input[field]) || input[field] < min || input[field] > max) {
      throw new Error(`Water ${field} must be finite and between ${min} and ${max}.`);
    }
  }
  if (input.transitionDepth >= input.deepDepth) {
    throw new Error('Water transitionDepth must be less than deepDepth.');
  }
  if (Object.isFrozen(input) && WATER_COLOR_FIELDS.every(([field]) => Object.isFrozen(input[field]))) {
    validatedFrozenSettings.add(input);
  }
}

export function validateWaterSettings(input: Readonly<WaterSettings>): WaterSettings {
  assertWaterSettings(input);
  return {
    shallow: [...input.shallow], middle: [...input.middle], deep: [...input.deep],
    transitionDepth: input.transitionDepth, deepDepth: input.deepDepth, blendSoftness: input.blendSoftness,
    noiseShallow: input.noiseShallow, noiseDeep: input.noiseDeep, noiseScale: input.noiseScale,
    noiseSpeed: input.noiseSpeed, waveEndSoftness: input.waveEndSoftness,
  };
}

export function resetWaterSettings(): WaterSettings {
  return validateWaterSettings(DEFAULT_WATER_SETTINGS);
}

export function waterSettingsFromParameters(params: URLSearchParams): WaterSettings {
  const settings = resetWaterSettings();
  for (const parameter of [
    ...WATER_COLOR_FIELDS.map(([, parameter]) => parameter),
    ...WATER_NUMERIC_FIELDS.map(([, parameter]) => parameter),
  ]) {
    if (params.getAll(parameter).length > 1) throw new Error(`Duplicate ${parameter}.`);
  }
  for (const [field, parameter] of WATER_COLOR_FIELDS) {
    const value = params.get(parameter);
    if (value !== null) {
      if (!/^(?:0|[1-9]\d{0,2}),(?:0|[1-9]\d{0,2}),(?:0|[1-9]\d{0,2})$/.test(value)) {
        throw new Error(`Invalid ${parameter}.`);
      }
      const [r, g, b] = value.split(',').map(Number);
      settings[field] = [r, g, b];
    }
  }
  for (const [field, parameter] of WATER_NUMERIC_FIELDS) {
    const value = params.get(parameter);
    if (value !== null) {
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) throw new Error(`Invalid ${parameter}.`);
      settings[field] = Number(value);
    }
  }
  return validateWaterSettings(settings);
}

export function waterParameters(settings: Readonly<WaterSettings>): URLSearchParams {
  assertWaterSettings(settings);
  const params = new URLSearchParams();
  for (const [field, parameter] of WATER_COLOR_FIELDS) params.set(parameter, settings[field].join(','));
  for (const [field, parameter] of WATER_NUMERIC_FIELDS) params.set(parameter, String(settings[field]));
  return params;
}
