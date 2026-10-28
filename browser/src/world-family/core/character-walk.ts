import type { Point } from './contracts';
import {
  characterSetup, createCharacterRig, rigParts, rigPoint, rigPose, transformRig, validateRigState,
  type CharacterRigState,
} from './character-rig';
import { rotateRigVector, solveRigEndpoint } from './character-kinematics';
import { RABBIT_ARTWORK_FACING, type RabbitMotionPose } from './character-motion';

export const WALK_STRIDE = 6;
export const WALK_SUPPORT = 0.58;
export const WALK_SPEED = 6;
export const WALK_TRANSITION_SECONDS = 0.64;
export const WALK_FOOT_LIFT = 1.35;
const SOURCE_PIXELS_PER_WORLD_UNIT = 29 / 12;
export const WALK_FEET = [
  { id: 'left-foot', sole: { x: 5, y: 29 }, edge: [0, 7], phase: 0 },
  { id: 'right-foot', sole: { x: 13, y: 29 }, edge: [11, 18], phase: 0.5 },
] as const;
export type WalkFootId = typeof WALK_FEET[number]['id'];

export class WalkRangeError extends RangeError {
  constructor(detail: string) {
    super(`Walk cannot use this rig setup: ${detail} Adjust the rig or choose another motion.`);
    this.name = 'WalkRangeError';
  }
}

export interface WalkContact {
  id: WalkFootId;
  support: boolean;
  sole: Point;
  anchor: Point;
}

export interface WalkPose extends RabbitMotionPose {
  walk: {
    distance: number;
    speed: number;
    status: WalkPreview['status'];
    contacts: WalkContact[];
  };
}

export interface WalkPreview {
  distance: number;
  seconds: number;
  speed: number;
  status: 'enter' | 'walking' | 'settle' | 'rest';
  transitionTime: number;
  from: RabbitMotionPose | null;
}

export function isWalkPose(pose: RabbitMotionPose): pose is WalkPose {
  return 'walk' in pose;
}

const wrap = (value: number) => {
  const phase = ((value % 1) + 1) % 1;
  return phase < 1e-10 || phase > 1 - 1e-10 ? 0 : phase;
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * t * (10 + t * (-15 + t * 6));

export function createWalkPreview(from: RabbitMotionPose | null = null): WalkPreview {
  return { distance: 0, seconds: 0, speed: WALK_SPEED, status: from ? 'enter' : 'walking', transitionTime: 0, from };
}

export function setWalkSpeed(state: WalkPreview, multiplier: number): void {
  if (![0.75, 1, 1.25].includes(multiplier)) throw new RangeError('Choose a supported walk travel speed.');
  state.speed = WALK_SPEED * multiplier;
}

export function seekWalk(state: WalkPreview, phase: number): void {
  if (!Number.isFinite(phase) || phase < 0 || phase > 1) throw new RangeError('Walk phase must be between 0 and 1.');
  state.distance = phase * WALK_STRIDE;
  state.seconds = state.distance / state.speed;
  state.status = 'walking';
  state.transitionTime = 0;
  state.from = null;
}

export function stopWalk(state: WalkPreview, from: WalkPose): void {
  if (state.status === 'settle' || state.status === 'rest') return;
  state.status = 'settle';
  state.transitionTime = 0;
  state.from = structuredClone(from);
}

export function advanceWalk(state: WalkPreview, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Walk time must be finite and non-negative.');
  state.seconds += seconds;
  let remaining = seconds;
  if (state.status === 'enter' || state.status === 'settle') {
    const used = Math.min(remaining, WALK_TRANSITION_SECONDS - state.transitionTime);
    state.transitionTime += used;
    remaining -= used;
    if (state.transitionTime >= WALK_TRANSITION_SECONDS) {
      state.status = state.status === 'enter' ? 'walking' : 'rest';
      state.from = null;
    }
  }
  if (state.status === 'walking') state.distance += state.speed * remaining;
}

function baseRig(setup?: CharacterRigState): CharacterRigState {
  if (setup?.species && setup.species !== 'rabbit') {
    throw new WalkRangeError('the first walk is calibrated for the rabbit.');
  }
  const rig = createCharacterRig();
  rig.parts.body.pivot.y = 29;
  rig.parts['left-foot'].pivot.y = rig.parts['right-foot'].pivot.y = 26;
  rig.parts['left-arm'].pivot.y = rig.parts['right-arm'].pivot.y = 22;
  rig.joints = false;
  if (setup) {
    const clean = characterSetup(setup), defaults = createCharacterRig();
    for (const part of rigParts(rig)) {
      const pose = rigPose(rig, part.id), bind = rigPose(clean, part.id), initial = rigPose(defaults, part.id);
      if (bind.pivot.x !== initial.pivot.x) pose.pivot.x = bind.pivot.x;
      if (bind.pivot.y !== initial.pivot.y) pose.pivot.y = bind.pivot.y;
      pose.offset = { ...bind.offset };
      pose.angle = bind.angle;
      pose.squashStretch = bind.squashStretch;
    }
  }
  return rig;
}

function checkRig(rig: CharacterRigState): void {
  try {
    validateRigState(rig);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    throw new WalkRangeError('the authored motion exceeds a part angle or attachment range.');
  }
}

function seatFoot(rig: CharacterRigState, id: WalkFootId, target: Point, angle: number): void {
  const registration = WALK_FEET.find(foot => foot.id === id)!;
  const pose = rig.parts[id];
  const transforms = transformRig(rig), scale = transforms[id].scale;
  const rest = rotateRigVector({
    x: (registration.sole.x - pose.pivot.x) * scale.x,
    y: (registration.sole.y - pose.pivot.y) * scale.y,
  }, angle * Math.PI / 180);
  const pivot = { x: target.x - rest.x, y: target.y - rest.y };
  try {
    const result = solveRigEndpoint(rig, id, registration.sole, pivot, target);
    if (result.angleLimited || result.error > 1e-7) {
      throw new WalkRangeError(`${id === 'left-foot' ? 'the left' : 'the right'} foot cannot reach its contact.`);
    }
  } catch (error) {
    if (!(error instanceof RangeError) || error instanceof WalkRangeError) throw error;
    throw new WalkRangeError(`${id === 'left-foot' ? 'the left' : 'the right'} foot needs more attachment travel.`);
  }
}

function swingX(u: number): number {
  const a = WALK_STRIDE * WALK_SUPPORT / 2;
  const tangent = -WALK_STRIDE * (1 - WALK_SUPPORT);
  return (2 * u ** 3 - 3 * u ** 2 + 1) * -a
    + (u ** 3 - 2 * u ** 2 + u) * tangent
    + (-2 * u ** 3 + 3 * u ** 2) * a
    + (u ** 3 - u ** 2) * tangent;
}

// Each alternating step compresses, rises over its support foot, then lowers into contact.
const BOUNCE = [
  [0, -0.015, -1.2, -0.1],
  [0.15, -0.065, -0.4, 0],
  [0.46, 0.018, -1.7, -0.55],
  [0.65, 0.03, -2.2, -0.85],
  [0.86, 0.005, -1.8, -0.45],
  [1, -0.015, -1.2, -0.1],
] as const;

function bounceAt(phase: number): { shape: number; angle: number; y: number } {
  const p = wrap(phase * 2);
  const end = BOUNCE.findIndex(key => key[0] > p);
  const a = BOUNCE[end - 1], b = BOUNCE[end];
  const t = smooth((p - a[0]) / (b[0] - a[0]));
  return { shape: mix(a[1], b[1], t), angle: mix(a[2], b[2], t), y: mix(a[3], b[3], t) };
}

function blendRig(from: CharacterRigState, to: CharacterRigState, t: number): CharacterRigState {
  const rig = structuredClone(to);
  for (const part of rigParts(rig)) {
    const a = rigPose(from, part.id), b = rigPose(to, part.id), p = rigPose(rig, part.id);
    p.pivot = { x: mix(a.pivot.x, b.pivot.x, t), y: mix(a.pivot.y, b.pivot.y, t) };
    p.offset = { x: mix(a.offset.x, b.offset.x, t), y: mix(a.offset.y, b.offset.y, t) };
    p.angle = mix(a.angle, b.angle, t);
    p.squashStretch = mix(a.squashStretch, b.squashStretch, t);
  }
  return rig;
}

export function sampleCharacterWalk(
  state: WalkPreview, facingDirection: -1 | 1, setup?: CharacterRigState,
): WalkPose {
  if (!Number.isFinite(state.distance) || state.distance < 0 || !Number.isFinite(state.seconds) || state.seconds < 0
    || !Number.isFinite(state.speed) || state.speed <= 0
    || !Number.isFinite(state.transitionTime) || state.transitionTime < 0 || state.transitionTime > WALK_TRANSITION_SECONDS
    || !['enter', 'walking', 'settle', 'rest'].includes(state.status)
    || (facingDirection !== -1 && facingDirection !== 1)) {
    throw new RangeError('The walk clock or facing is invalid.');
  }
  const cycles = state.distance / WALK_STRIDE, phase = wrap(cycles);
  const base = baseRig(setup), neutral = transformRig(base);
  const home = WALK_FEET.map(foot => ({
    x: rigPoint(base, neutral, foot.id, foot.sole).x, y: 29,
  }));
  let rig = structuredClone(base);
  const walking = state.status !== 'rest' && state.status !== 'settle';
  const p = walking ? phase : 0;
  const bodyAction = bounceAt(p);
  const cadence = state.speed / WALK_STRIDE;
  const headAction = bounceAt(p - 0.065 * cadence);
  const earAction = bounceAt(p - 0.12 * cadence);
  const armPhase = (p - 0.025 * cadence) * Math.PI * 2;
  let hop = 0;
  if (walking) {
    rig.parts.body.squashStretch += bodyAction.shape;
    rig.parts.body.angle += bodyAction.angle;
    rig.parts.body.offset.y += bodyAction.y;
    rig.parts.head.angle += headAction.angle * 0.7 - bodyAction.angle;
    rig.parts.head.offset.y += (bodyAction.shape - headAction.shape) * 5;
    rig.parts.head.offset.x += (headAction.angle - bodyAction.angle) * 0.12;
    for (const id of ['left-ear', 'right-ear'] as const) {
      rig.parts[id].angle += (earAction.angle - headAction.angle) * 2.8;
      rig.parts[id].offset.y += (headAction.shape - earAction.shape) * 3;
    }
    for (const [index, id] of (['left-arm', 'right-arm'] as const).entries()) {
      const swing = Math.cos(armPhase) * (index === 0 ? -1 : 1);
      rig.parts[id].angle += swing * 13 - bodyAction.angle;
      rig.parts[id].offset.y += -0.2 * swing;
    }
  }
  checkRig(rig);
  const targets = WALK_FEET.map((foot, index) => {
    const local = wrap(cycles + foot.phase);
    const support = !walking || local <= WALK_SUPPORT + 1e-10;
    const u = support ? 0 : (local - WALK_SUPPORT) / (1 - WALK_SUPPORT);
    const dx = !walking ? 0 : support
      ? WALK_STRIDE * (WALK_SUPPORT / 2 - local) : swingX(u);
    const lift = support ? 0 : WALK_FOOT_LIFT * Math.sin(Math.PI * u) ** 2;
    return {
      id: foot.id, support,
      point: { x: home[index].x + RABBIT_ARTWORK_FACING * dx, y: 29 - lift },
      angle: support ? 0 : -6 * Math.sin(Math.PI * u) ** 2,
    };
  });
  const stepPhase = wrap(phase * 2);
  let beat = state.status === 'rest' ? 'rest' : stepPhase < 0.2 ? 'contact / compress'
    : stepPhase < 0.5 ? 'push / passing' : stepPhase < 0.72 ? 'rise' : 'reach / lower';
  if (state.status === 'enter' || state.status === 'settle') {
    if (!state.from || !Number.isFinite(state.from.hop) || state.from.hop < 0) {
      throw new RangeError('Walk transitions need a valid starting pose.');
    }
    const t = state.transitionTime / WALK_TRANSITION_SECONDS;
    const from = state.from, fromTransforms = transformRig(from.rig);
    const first = WALK_FEET.findIndex(foot =>
      rigPoint(from.rig, fromTransforms, foot.id, foot.sole).y - from.hop * SOURCE_PIXELS_PER_WORLD_UNIT < 29 - 1e-7);
    const order = first < 0 ? [1, 0] : [first, 1 - first];
    rig = blendRig(from.rig, rig, smooth(t));
    hop = mix(from.hop, hop, smooth(t));
    checkRig(rig);
    targets.forEach((target, index) => {
      const source = rigPoint(from.rig, fromTransforms, target.id, WALK_FEET[index].sole);
      const start = { x: source.x, y: source.y - from.hop * SOURCE_PIXELS_PER_WORLD_UNIT };
      const step = order.indexOf(index);
      const u = from.hop > 0 ? t : Math.max(0, Math.min(1, t * 2 - step));
      const w = smooth(u);
      target.point = {
        x: mix(start.x, target.point.x, w),
        y: mix(start.y, target.point.y, w) - (from.hop > 0 ? 0 : 0.65) * Math.sin(Math.PI * u) ** 2,
      };
      target.angle = mix(fromTransforms[target.id].angle * 180 / Math.PI, target.angle, w);
      target.support = u === 1 || (u === 0 && Math.abs(start.y - 29) < 1e-7);
    });
    beat = state.status === 'enter' ? 'starting' : 'settling';
  }
  for (const target of targets) {
    seatFoot(rig, target.id, {
      x: target.point.x, y: target.point.y + hop * SOURCE_PIXELS_PER_WORLD_UNIT,
    }, target.angle);
  }
  const transforms = transformRig(rig);
  const contacts = targets.map((target, index): WalkContact => {
    const source = rigPoint(rig, transforms, target.id, WALK_FEET[index].sole);
    const sole = { x: source.x, y: source.y - hop * SOURCE_PIXELS_PER_WORLD_UNIT };
    return {
      id: target.id, support: target.support, sole,
      anchor: { x: sole.x + RABBIT_ARTWORK_FACING * state.distance, y: sole.y },
    };
  });
  const blink = state.seconds % 4.7 > 4.56;
  const body = transforms.body;
  return {
    facingDirection, phase, beat, hop, rig,
    summary: { hop, scaleX: body.scale.x, scaleY: body.scale.y,
      rotation: body.angle * facingDirection * RABBIT_ARTWORK_FACING, blink },
    face: { eyeScale: { x: 1, y: 1 }, eyeOffset: { x: 0, y: 0 },
      noseScale: { x: 1, y: 1 }, noseOffset: { x: 0, y: 0 }, blink },
    walk: { distance: state.distance, speed: state.speed, status: state.status, contacts },
  };
}

export function validateWalkSetup(setup?: CharacterRigState): void {
  const state = createWalkPreview();
  for (let frame = 0; frame < 100; frame++) {
    seekWalk(state, frame / 100);
    sampleCharacterWalk(state, 1, setup);
  }
}
