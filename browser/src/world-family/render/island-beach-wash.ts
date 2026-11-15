import { ISLAND_WATER_HEIGHT } from '../core/island-water-level';
import type { IslandShoreSample } from './island-shore-field';

export const BEACH_WASH_PERIOD = 8;
export const BEACH_WASH_REACH = 8;
export const BEACH_WASH_RISE = 2;
export const BEACH_WAVE_OFFSHORE = 18;
export const DEFAULT_BEACH_WAVE_END_SOFTNESS = 0.3;
export const BEACH_WAVE_END_SOFTNESS_MIN = 0.05;
export const BEACH_WAVE_END_SOFTNESS_MAX = 0.4;
const BEACH_WAVE_CREST = 0.78;
export const BEACH_WASH_MAX_HEIGHT = ISLAND_WATER_HEIGHT + BEACH_WASH_RISE;
export interface BeachWash {
  coverage: number;
  foam: number;
  wetness: number;
  height: number;
}
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (a: number, b: number, value: number) => {
  const t = clamp((value - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const smoothSlope = (a: number, b: number, value: number) => {
  const t = clamp((value - a) / (b - a));
  return 6 * t * (1 - t) / (b - a);
};

export function validateBeachWaveEndSoftness(endSoftness: number): number {
  if (!Number.isFinite(endSoftness) || endSoftness < BEACH_WAVE_END_SOFTNESS_MIN
    || endSoftness > BEACH_WAVE_END_SOFTNESS_MAX) {
    throw new RangeError('Beach wave end softness must be finite and between 0.05 and 0.4.');
  }
  return endSoftness;
}

function beachSupport(beach: number, endSoftness: number): number {
  return beach * smooth(0.6, 0.6 + endSoftness, beach);
}

function waveCycle(phase: number, seconds: number): number {
  const time = ((seconds % 2560) + 2560) % 2560;
  // Keep phase precision independent of the elapsed cycle count.
  return ((time % BEACH_WASH_PERIOD) / BEACH_WASH_PERIOD + phase) % 1;
}

function waveProfile(distance: number, cycle: number) {
  const advance = smooth(0.04, 0.36, cycle) * (1 - smooth(0.44, 0.9, cycle));
  const front = 5 - advance * 12 + (1 - smooth(0, 0.15, cycle)) * 10;
  const envelope = smooth(0, 0.1, cycle) * (1 - smooth(0.9, 1, cycle));
  const coverage = smooth(front - 0.7, front + 0.7, distance)
    * (1 - smooth(14, BEACH_WAVE_OFFSHORE, distance)) * envelope;
  const runup = BEACH_WASH_RISE * advance
    * smooth(front - 0.8, front + 2.4, distance) * (1 - smooth(5, 9, distance));
  const runupSlope = BEACH_WASH_RISE * advance
    * (smoothSlope(front - 0.8, front + 2.4, distance) * (1 - smooth(5, 9, distance))
      - smooth(front - 0.8, front + 2.4, distance) * smoothSlope(5, 9, distance));
  const crestOffset = distance - front - 0.9;
  const crestStrength = BEACH_WAVE_CREST * smooth(0, 0.04, cycle) * (1 - smooth(0.4, 0.65, cycle));
  const crest = BEACH_WAVE_CREST * (1 - smooth(0.3, 3.3, Math.abs(distance - front - 0.9)))
    * smooth(0, 0.04, cycle) * (1 - smooth(0.4, 0.65, cycle)) * smooth(-2, 1, distance);
  const crestSlope = crestStrength
    * (-smoothSlope(0.3, 3.3, Math.abs(crestOffset)) * Math.sign(crestOffset) * smooth(-2, 1, distance)
      + (1 - smooth(0.3, 3.3, Math.abs(crestOffset))) * smoothSlope(-2, 1, distance));
  return { coverage, rise: Math.max(runup, crest), front, slope: runup >= crest ? runupSlope : crestSlope };
}

function wave(distance: number, cycle: number, beach: number, endSoftness: number) {
  const profile = waveProfile(distance, cycle), support = beachSupport(beach, endSoftness);
  return { coverage: profile.coverage * support, height: ISLAND_WATER_HEIGHT + profile.rise * support, front: profile.front };
}

export function beachWaveAt(
  distance: number, phase: number, beach: number, seconds: number, endSoftness = DEFAULT_BEACH_WAVE_END_SOFTNESS,
) {
  if (![distance, phase, beach, seconds].every(Number.isFinite)) throw new RangeError('Beach wave inputs must be finite.');
  validateBeachWaveEndSoftness(endSoftness);
  return wave(distance, waveCycle(phase, seconds), beach, endSoftness);
}

/** The full local height derivative, including support changes along a phase-coherent beach. */
export function beachWaveGradient(
  distance: number, phase: number, beach: number, seconds: number,
  distanceGradient: { x: number; y: number }, beachGradient: { x: number; y: number },
  endSoftness = DEFAULT_BEACH_WAVE_END_SOFTNESS,
) {
  if (![distance, phase, beach, seconds, distanceGradient.x, distanceGradient.y,
    beachGradient.x, beachGradient.y].every(Number.isFinite)) {
    throw new RangeError('Beach wave inputs and gradients must be finite.');
  }
  validateBeachWaveEndSoftness(endSoftness);
  const profile = waveProfile(distance, waveCycle(phase, seconds));
  const support = beachSupport(beach, endSoftness);
  const supportSlope = smooth(0.6, 0.6 + endSoftness, beach)
    + beach * smoothSlope(0.6, 0.6 + endSoftness, beach);
  return {
    x: profile.slope * support * distanceGradient.x + profile.rise * supportSlope * beachGradient.x,
    y: profile.slope * support * distanceGradient.y + profile.rise * supportSlope * beachGradient.y,
  };
}

export function shoreWaveWeight(
  distance: number, beach: number, endSoftness = DEFAULT_BEACH_WAVE_END_SOFTNESS,
): number {
  validateBeachWaveEndSoftness(endSoftness);
  return beachSupport(beach, endSoftness) * (1 - smooth(4, BEACH_WAVE_OFFSHORE, distance));
}

/** Shared phase and height for the displaced shore mesh and its sand contact. */
export function sampleBeachWash(
  shore: IslandShoreSample, seconds: number, groundHeight = ISLAND_WATER_HEIGHT,
  endSoftness = DEFAULT_BEACH_WAVE_END_SOFTNESS,
): BeachWash {
  if (!Number.isFinite(seconds)) throw new RangeError('Beach wash time must be finite.');
  if (!Number.isFinite(groundHeight)) throw new RangeError('Beach wash ground height must be finite.');
  validateBeachWaveEndSoftness(endSoftness);
  if (shore.kind !== 'beach' || shore.beachWeight <= 0.6
    || shore.distance <= -BEACH_WASH_REACH || shore.distance >= BEACH_WAVE_OFFSHORE || groundHeight > BEACH_WASH_MAX_HEIGHT) {
    return { coverage: 0, foam: 0, wetness: 0, height: ISLAND_WATER_HEIGHT };
  }
  const cycle = waveCycle(shore.phase, seconds);
  const current = wave(shore.distance, cycle, shore.beachWeight, endSoftness);
  const cover = (sample: ReturnType<typeof wave>) => sample.coverage
    * smooth(-0.02, 0.18, sample.height - groundHeight);
  const coverage = cover(current);
  const recent = wave(shore.distance, (cycle + 0.92) % 1, shore.beachWeight, endSoftness);
  const older = wave(shore.distance, (cycle + 0.84) % 1, shore.beachWeight, endSoftness);
  const oldest = wave(shore.distance, (cycle + 0.76) % 1, shore.beachWeight, endSoftness);
  const wetness = Math.max(coverage, cover(recent) * 0.9,
    cover(older) * 0.65, cover(oldest) * 0.5) * (1 - coverage);
  const behind = shore.distance - current.front;
  const cells = 0.5 + 0.5 * Math.sin(shore.distance * 1.05 + shore.breakup * 13);
  const pores = 0.5 + 0.5 * Math.sin(shore.distance * 4.7 - shore.breakup * 31);
  const foamDistance = behind + shore.breakup * 0.45 + (cells - 0.5) * 0.35;
  const breaking = smooth(0.04, 0.17, cycle) * (1 - smooth(0.5, 0.71, cycle));
  const core = smooth(0.05, 0.65, foamDistance) * (1 - smooth(2.15, 2.8, foamDistance));
  const perimeter = smooth(-0.5, 0.4, foamDistance) * (1 - smooth(2.4, 3.8, foamDistance));
  const lace = smooth(0.18, 0.72, cells * 0.6 + pores * 0.4);
  const heightEdge = 1 - smooth(0.08, 0.42, Math.abs(current.height - groundHeight));
  // Gate foam with the water mask before endpoint attenuation; foam owns its support factor once.
  const foamCoverage = waveProfile(shore.distance, cycle).coverage
    * smooth(-0.02, 0.18, current.height - groundHeight);
  const contactFoam = groundHeight > ISLAND_WATER_HEIGHT + 0.05 ? heightEdge * foamCoverage : 0;
  const frontFoam = Math.max(core, perimeter * lace * 0.85, contactFoam) * breaking;
  // Hold the trail at maximum run-up during retreat so it fades instead of forming another moving band.
  const trailDistance = shore.distance - (cycle <= 0.44 ? current.front : -7);
  const trail = smooth(0.8, 2.1, trailDistance) * (1 - smooth(2.4, 10, trailDistance));
  const residue = smooth(-BEACH_WASH_REACH + 0.8, -BEACH_WASH_REACH + 3, shore.distance)
    * (1 - smooth(5.5, 9, shore.distance))
    * smooth(0.14, 0.3, cycle) * (1 - smooth(0.32, 0.96, cycle));
  const foam = Math.max(frontFoam, residue * trail * (0.96 + cells * 0.04) * 0.62)
    * beachSupport(shore.beachWeight, endSoftness) * smooth(0, 0.35, foamCoverage);
  return { coverage, foam, wetness, height: current.height };
}

export const BEACH_WASH_GLSL = `
uniform float u_waveEndSoftness;
float beachCycle(float p,float t){return fract(mod(t,${BEACH_WASH_PERIOD.toFixed(2)})/${BEACH_WASH_PERIOD.toFixed(2)}+p);}
float beachSmoothSlope(float a, float b, float value) {
  float t=clamp((value-a)/(b-a),0.0,1.0);
  return 6.0*t*(1.0-t)/(b-a);
}
float beachEndEnvelope(float beach) {
  return smoothstep(0.6,0.6+u_waveEndSoftness,beach);
}
vec2 beachHeightProfile(float distance, float cycle, float front, float advance) {
  float runup=${BEACH_WASH_RISE.toFixed(2)}*advance
    *smoothstep(front-0.8,front+2.4,distance)*(1.0-smoothstep(5.0,9.0,distance));
  float runupSlope=${BEACH_WASH_RISE.toFixed(2)}*advance
    *(beachSmoothSlope(front-0.8,front+2.4,distance)*(1.0-smoothstep(5.0,9.0,distance))
      -smoothstep(front-0.8,front+2.4,distance)*beachSmoothSlope(5.0,9.0,distance));
  float offset=distance-front-0.9;
  float crestStrength=${BEACH_WAVE_CREST.toFixed(2)}*smoothstep(0.0,0.04,cycle)*(1.0-smoothstep(0.4,0.65,cycle));
  float crest=${BEACH_WAVE_CREST.toFixed(2)}*(1.0-smoothstep(0.3,3.3,abs(offset)))
    *smoothstep(0.0,0.04,cycle)*(1.0-smoothstep(0.4,0.65,cycle))*smoothstep(-2.0,1.0,distance);
  float crestSlope=crestStrength
    *(-beachSmoothSlope(0.3,3.3,abs(offset))*sign(offset)*smoothstep(-2.0,1.0,distance)
      +(1.0-smoothstep(0.3,3.3,abs(offset)))*beachSmoothSlope(-2.0,1.0,distance));
  return vec2(max(runup,crest),runup >= crest ? runupSlope : crestSlope);
}
vec4 beachProfile(float distance, float cycle) {
  float advance=smoothstep(0.04,0.36,cycle)*(1.0-smoothstep(0.44,0.9,cycle));
  float front=5.0-advance*12.0+(1.0-smoothstep(0.0,0.15,cycle))*10.0;
  float envelope=smoothstep(0.0,0.1,cycle)*(1.0-smoothstep(0.9,1.0,cycle));
  float coverage=smoothstep(front-0.7,front+0.7,distance)
    *(1.0-smoothstep(14.0,${BEACH_WAVE_OFFSHORE.toFixed(1)},distance))*envelope;
  vec2 height=beachHeightProfile(distance,cycle,front,advance);
  return vec4(coverage,height.x,front,height.y);
}
vec3 beachWave(float distance, float cycle, float beach) {
  vec4 profile=beachProfile(distance,cycle);
  float support=beach*beachEndEnvelope(beach);
  return vec3(profile.x*support,${ISLAND_WATER_HEIGHT.toFixed(2)}+profile.y*support,profile.z);
}
vec2 beachWaveGradient(float distance, float cycle, float beach, vec2 distanceGradient, vec2 beachGradient) {
  vec4 profile=beachProfile(distance,cycle);
  float edge=beachEndEnvelope(beach);
  float support=beach*edge;
  float supportSlope=edge+beach*beachSmoothSlope(0.6,0.6+u_waveEndSoftness,beach);
  return vec2(profile.w*support*distanceGradient.x+profile.y*supportSlope*beachGradient.x,
    profile.w*support*distanceGradient.y+profile.y*supportSlope*beachGradient.y);
}
vec4 beachWash(float distance, float beach, float phase, float breakup, float seconds, float ground) {
  if (beach <= 0.6 || distance <= -${BEACH_WASH_REACH.toFixed(1)}
    || distance >= ${BEACH_WAVE_OFFSHORE.toFixed(1)} || ground > ${BEACH_WASH_MAX_HEIGHT.toFixed(2)})
    return vec4(0.0,0.0,0.0,${ISLAND_WATER_HEIGHT.toFixed(2)});
  float cycle=beachCycle(phase,seconds);
  vec3 current=beachWave(distance,cycle,beach);
  float coverage=current.x*smoothstep(-0.02,0.18,current.y-ground);
  vec3 recent=beachWave(distance,fract(cycle+0.92),beach);
  vec3 older=beachWave(distance,fract(cycle+0.84),beach);
  vec3 oldest=beachWave(distance,fract(cycle+0.76),beach);
  float wetness=max(coverage,max(recent.x*smoothstep(-0.02,0.18,recent.y-ground)*0.9,
    max(older.x*smoothstep(-0.02,0.18,older.y-ground)*0.65,
    oldest.x*smoothstep(-0.02,0.18,oldest.y-ground)*0.5)))*(1.0-coverage);
  float behind=distance-current.z;
  float cells=0.5+0.5*sin(distance*1.05+breakup*13.0);
  float pores=0.5+0.5*sin(distance*4.7-breakup*31.0);
  float foamDistance=behind+breakup*0.45+(cells-0.5)*0.35;
  float breaking=smoothstep(0.04,0.17,cycle)*(1.0-smoothstep(0.5,0.71,cycle));
  float core=smoothstep(0.05,0.65,foamDistance)*(1.0-smoothstep(2.15,2.8,foamDistance));
  float perimeter=smoothstep(-0.5,0.4,foamDistance)*(1.0-smoothstep(2.4,3.8,foamDistance));
  float lace=smoothstep(0.18,0.72,cells*0.6+pores*0.4);
  float heightEdge=1.0-smoothstep(0.08,0.42,abs(current.y-ground));
  float foamCoverage=beachProfile(distance,cycle).x*smoothstep(-0.02,0.18,current.y-ground);
  float contactFoam=ground > ${ISLAND_WATER_HEIGHT.toFixed(2)}+0.05 ? heightEdge*foamCoverage : 0.0;
  float frontFoam=max(max(core,perimeter*lace*0.85),contactFoam)*breaking;
  float trailDistance=distance-(cycle <= 0.44 ? current.z : -7.0);
  float trail=smoothstep(0.8,2.1,trailDistance)*(1.0-smoothstep(2.4,10.0,trailDistance));
  float residue=smoothstep(-${BEACH_WASH_REACH.toFixed(1)}+0.8,-${BEACH_WASH_REACH.toFixed(1)}+3.0,distance)
    *(1.0-smoothstep(5.5,9.0,distance))
    *smoothstep(0.14,0.3,cycle)*(1.0-smoothstep(0.32,0.96,cycle));
  float foam=max(frontFoam,residue*trail*(0.96+cells*0.04)*0.62)
    *beach*beachEndEnvelope(beach)*smoothstep(0.0,0.35,foamCoverage);
  return vec4(coverage,foam,wetness,current.y);
}
`;
