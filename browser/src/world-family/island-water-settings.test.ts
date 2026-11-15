import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WATER_SETTINGS, resetWaterSettings, validateWaterSettings, waterParameters,
  waterSettingsFromParameters, WATER_COLOR_FIELDS, WATER_MAX_DEPTH, WATER_NUMERIC_FIELDS,
  type WaterSettings,
} from './render/island-water-settings';

describe('editable water settings', () => {
  it('provides frozen turquoise anchors, ordered foundation depths and the coordinated wave default', () => {
    expect(DEFAULT_WATER_SETTINGS).toEqual({
      shallow: [54, 191, 193], middle: [31, 153, 176], deep: [27, 113, 146],
      transitionDepth: 3.5, deepDepth: 12, blendSoftness: 0.65,
      noiseShallow: 2, noiseDeep: 0.5, noiseScale: 4, noiseSpeed: 0.2, waveEndSoftness: 0.3,
    });
    expect(Object.isFrozen(DEFAULT_WATER_SETTINGS)).toBe(true);
    for (const [field] of WATER_COLOR_FIELDS) expect(Object.isFrozen(DEFAULT_WATER_SETTINGS[field])).toBe(true);
    expect(WATER_MAX_DEPTH).toBe(16);
    expect(waterSettingsFromParameters(new URLSearchParams())).toEqual(DEFAULT_WATER_SETTINGS);
  });

  it('round-trips every setting and canonical reset without altering unrelated URL state', () => {
    const input: WaterSettings = {
      ...resetWaterSettings(), shallow: [0, 255, 185], middle: [54, 128, 150], deep: [20, 75, 98],
      transitionDepth: 2.1, deepDepth: 16, blendSoftness: 1, noiseShallow: 24, noiseDeep: 0,
      noiseScale: 7.125, noiseSpeed: 0.137, waveEndSoftness: 0.4,
    };
    const before = structuredClone(input), serialized = waterParameters(input);
    expect([...serialized.keys()]).toHaveLength(WATER_COLOR_FIELDS.length + WATER_NUMERIC_FIELDS.length);
    expect(waterSettingsFromParameters(serialized)).toEqual(input);
    expect(input).toEqual(before);
    serialized.set('sunIntensity', '0.75');
    const previousUrl = serialized.toString();
    expect(waterSettingsFromParameters(serialized)).toEqual(input);
    expect(serialized.toString()).toBe(previousUrl);
    const reset = resetWaterSettings();
    expect(waterSettingsFromParameters(waterParameters(reset))).toEqual(DEFAULT_WATER_SETTINGS);
    expect(waterParameters(reset).toString()).toBe(waterParameters(DEFAULT_WATER_SETTINGS).toString());
    expect(waterParameters(reset).get('waterShallow')).toBe('54,191,193');
  });

  it('deep-copies input/default colors so edits and reset cannot leak into another settings object', () => {
    const input = resetWaterSettings(), before = structuredClone(input);
    const copy = validateWaterSettings(input), reset = resetWaterSettings();
    expect(copy).toEqual(input);
    expect(copy).not.toBe(input);
    for (const [field] of WATER_COLOR_FIELDS) {
      expect(copy[field]).not.toBe(input[field]);
      expect(reset[field]).not.toBe(DEFAULT_WATER_SETTINGS[field]);
    }
    copy.shallow = [1, 2, 3];
    (copy.middle as [number, number, number])[0] = 7;
    copy.noiseSpeed = 1;
    expect(input).toEqual(before);
    expect(reset).toEqual(DEFAULT_WATER_SETTINGS);
    expect(DEFAULT_WATER_SETTINGS.middle).toEqual([31, 153, 176]);
    expect(validateWaterSettings(Object.freeze(input))).toEqual(before);
  });

  it.each(WATER_NUMERIC_FIELDS)('enforces finite numeric limits for %s', (field, _parameter, min, max) => {
    for (const value of [NaN, Infinity, -Infinity, min - 0.001, max + 0.001, '1', undefined]) {
      const input = { ...resetWaterSettings(), [field]: value } as WaterSettings;
      const before = structuredClone(input);
      expect(() => validateWaterSettings(input)).toThrow(`Water ${field} must be finite`);
      expect(() => waterParameters(input)).toThrow();
      expect(input).toEqual(before);
    }
  });

  it('revalidates mutable colours even when the outer settings object is frozen', () => {
    const settings = Object.freeze(resetWaterSettings());
    expect(validateWaterSettings(settings)).toEqual(DEFAULT_WATER_SETTINGS);
    (settings.shallow as [number, number, number])[0] = -1;
    expect(() => validateWaterSettings(settings)).toThrow('integer RGB bytes');
  });

  it.each(WATER_COLOR_FIELDS)('rejects invalid RGB bytes for %s', (field, parameter) => {
    for (const value of [[-1, 100, 113], [45, 256, 113], [45.5, 100, 113], [NaN, 100, 113],
      [45, Infinity, 113], ['45', 100, 113], [45, 100], [45, 100, 113, 255], new Array(3), null, undefined]) {
      const input = { ...resetWaterSettings(), [field]: value } as WaterSettings;
      const before = structuredClone(input);
      expect(() => validateWaterSettings(input)).toThrow(`Water ${field} must contain three integer RGB bytes`);
      expect(() => waterParameters(input)).toThrow();
      expect(input).toEqual(before);
    }
    expect(() => waterSettingsFromParameters(new URLSearchParams(`${parameter}=0,256,0`))).toThrow();
  });

  it('rejects equal/reversed/out-of-optical-range depth anchors instead of silently clamping', () => {
    for (const [transitionDepth, deepDepth] of [[3.5, 3.5], [4, 3], [16, 16]]) {
      const input = { ...resetWaterSettings(), transitionDepth, deepDepth };
      expect(() => validateWaterSettings(input)).toThrow('transitionDepth must be less than deepDepth');
      expect(() => waterSettingsFromParameters(new URLSearchParams(
        `waterTransitionDepth=${transitionDepth}&waterDeepDepth=${deepDepth}`,
      ))).toThrow('transitionDepth must be less than deepDepth');
    }
    expect(() => validateWaterSettings({ ...resetWaterSettings(), deepDepth: 16.01 })).toThrow();
    expect(validateWaterSettings({ ...resetWaterSettings(), transitionDepth: 0.1, deepDepth: 0.2 })).toBeTruthy();
    expect(validateWaterSettings({ ...resetWaterSettings(), transitionDepth: 15.9, deepDepth: 16 })).toBeTruthy();
  });

  it.each([
    'waterTransitionDepth=', 'waterDeepDepth= ', 'waterNoiseShallow=NaN', 'waterNoiseDeep=Infinity',
    'waterBlendSoftness=0.5x', 'waterNoiseSpeed=0x10', 'waterNoiseScale=1_0', 'waterNoiseSpeed=1e999',
    'waveEndSoftness=0.049', 'waveEndSoftness=0.401', 'waterShallow=', 'waterShallow=88,166',
    'waterMiddle=54,125,149,255', 'waterDeep=45, 100,113', 'waterDeep=45.0,100,113',
    'waterShallow=088,166,185', 'waterShallow=%2358a6b9', 'waterDeep=-1,100,113',
  ])('rejects malformed URL parameter %s without mutation', query => {
    const params = new URLSearchParams(query), before = params.toString();
    expect(() => waterSettingsFromParameters(params)).toThrow();
    expect(params.toString()).toBe(before);
  });

  it('rejects duplicates for every recognized parameter, even when the repeated value agrees', () => {
    const defaults = waterParameters(DEFAULT_WATER_SETTINGS);
    for (const [parameter, value] of defaults) {
      const params = new URLSearchParams([[parameter, value], [parameter, value]]), before = params.toString();
      expect(() => waterSettingsFromParameters(params)).toThrow(`Duplicate ${parameter}.`);
      expect(params.toString()).toBe(before);
    }
  });

  it('accepts the sun-style strict decimal/exponent syntax and all wave endpoint boundaries', () => {
    const params = new URLSearchParams({
      waterTransitionDepth: '+3.5', waterDeepDepth: '1.6e1', waterNoiseSpeed: '.137',
      waterNoiseScale: '7.', waveEndSoftness: '.05',
    });
    expect(waterSettingsFromParameters(params)).toMatchObject({
      transitionDepth: 3.5, deepDepth: 16, noiseSpeed: 0.137, noiseScale: 7, waveEndSoftness: 0.05,
    });
    expect(validateWaterSettings({ ...resetWaterSettings(), waveEndSoftness: 0.4 }).waveEndSoftness).toBe(0.4);
  });
});
