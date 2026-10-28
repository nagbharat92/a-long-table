import type { CharacterPose, CharacterState, Point, Rectangle } from './contracts';
import {
  createCharacterRig, RABBIT_PARTS, RIG_PART_SHAPE, RIG_POSITION_LIMIT, RIG_WIDTH, rigPoint, transformRig,
  validateRigState, type CharacterRigState, type RigPartId, type RigTransform,
} from './character-rig';
import { rotateRigVector, solveRigEndpoint } from './character-kinematics';

export const HOP_DISTANCE = 14;
export const HOP_TAKEOFF_PHASE = 0.15;
export const HOP_CONTACT_PHASE = 0.62;
export const RABBIT_ARTWORK_FACING = -1;

// Symmetric around the resting silhouette, with clearance for the entire hop.
export const RABBIT_MOTION_FRAME: Rectangle = { x: -11, y: -14, width: 40, height: 57 };
export const IDLE_BOB_SECONDS = 0.8;

export interface RabbitMotionPose {
  facingDirection: -1 | 1;
  phase: number;
  beat: string;
  hop: number;
  summary: CharacterPose;
  rig: CharacterRigState;
  face: {
    eyeScale: Point;
    eyeOffset: Point;
    noseScale: Point;
    noseOffset: Point;
    blink: boolean;
  };
}

// Columns: cycle phase, local degrees, parent-space x/y, local shape amount.
type JointKey = readonly [number, number, number, number, number];
const JOINTS: Record<'body' | 'head', readonly JointKey[]> = {
  body: [
    [0, 0, 0, 0, 0],
    [0.1, -2, -0.12, 0, -0.38],
    [0.22, 5.2, 0.12, 0, 0.22],
    [0.4, 1, 0.1, 0, 0.035],
    [0.55, -2.8, 0.08, 0, 0.1],
    [0.65, 3, 0, 0, -0.42],
    [0.81, -0.5, 0, 0, 0.025],
    [1, 0, 0, 0, 0],
  ],
  head: [
    [0, 0, 0, 0, 0],
    [0.14, -3.6, -0.08, 0.32, -0.055],
    [0.28, 6.8, -0.12, 0.48, 0.055],
    [0.44, -2, 0.08, -0.16, 0.015],
    [0.58, -4.8, 0.12, -0.2, 0.025],
    [0.71, 6.5, 0.04, 0.45, -0.055],
    [1, 0, 0, 0, 0],
  ],
};

// Shared vector tangents carry the head around an arc, not to a stop at each pose.
const HEAD_PATH = [
  [0, 0, 0], [0.14, -0.28, 0.44], [0.28, -0.44, 0.52], [0.44, 0.3, -0.28],
  [0.58, 0.38, -0.22], [0.71, 0.22, 0.62], [0.84, -0.1, 0.14], [1, 0, 0],
] as const;

// A separate ballistic silhouette: grounded anticipation and contact, one floating apex.
// Columns: phase, world lift, derivative with respect to phase.
const LIFT = [
  [0, 0, 0], [HOP_TAKEOFF_PHASE, 0, 0], [0.27, 1.45, 12], [0.42, 2.4, 0],
  [0.54, 1.4, -14], [HOP_CONTACT_PHASE, 0, 0], [1, 0, 0],
] as const;

// Columns: phase, eye x/y scale, eye x/y offset, nose x/y scale, nose x/y offset.
type FaceKey = readonly [number, number, number, number, number, number, number, number, number];
const FACE: readonly FaceKey[] = [
  [0, 1, 1, 0, 0, 1, 1, 0, 0],
  [0.12, 1.04, 0.62, -0.06, 0.15, 1.04, 0.96, -0.03, 0.08],
  [0.24, 0.98, 1.16, 0.14, -0.12, 0.96, 1.1, 0.1, -0.12],
  [0.44, 1, 1.04, 0.18, -0.06, 1.02, 1.04, 0.16, -0.04],
  [0.59, 1.04, 0.86, 0.08, 0.06, 0.98, 1.08, 0.1, 0.04],
  [0.67, 1.06, 0.6, 0, 0.18, 1.08, 0.94, 0.02, 0.16],
  [0.76, 1, 0.9, -0.04, 0.04, 1.12, 0.96, -0.04, 0.22],
  [1, 1, 1, 0, 0, 1, 1, 0, 0],
];

function segment<T extends readonly number[]>(keys: readonly T[], phase: number): [T, T, number] {
  const end = keys.findIndex(key => key[0] > phase);
  const a = keys[end - 1], b = keys[end];
  return [a, b, (phase - a[0]) / (b[0] - a[0])];
}

function sampleTrack<T extends readonly number[]>(keys: readonly T[], phase: number): number[] {
  const [a, b, t] = segment(keys, phase);
  const start = keys.indexOf(a);
  const span = b[0] - a[0];
  // Carry velocity through monotone keys without overshooting authored shapes.
  const tangent = (key: number, column: number): number => {
    if (key === 0 || key === keys.length - 1) return 0;
    const previous = keys[key - 1], current = keys[key], next = keys[key + 1];
    const leftSpan = current[0] - previous[0], rightSpan = next[0] - current[0];
    const left = (current[column] - previous[column]) / leftSpan;
    const right = (next[column] - current[column]) / rightSpan;
    if (left * right <= 0) return 0;
    const w1 = 2 * rightSpan + leftSpan, w2 = rightSpan + 2 * leftSpan;
    return (w1 + w2) / (w1 / left + w2 / right);
  };
  return a.map((value, column) => column === 0 ? phase
    : hermite(value, b[column], tangent(start, column), tangent(start + 1, column), span, t));
}

function hermite(a: number, b: number, aSlope: number, bSlope: number, span: number, t: number): number {
  return (2 * t ** 3 - 3 * t ** 2 + 1) * a
    + (t ** 3 - 2 * t ** 2 + t) * span * aSlope
    + (-2 * t ** 3 + 3 * t ** 2) * b
    + (t ** 3 - t ** 2) * span * bSlope;
}

function sampleHeadPath(phase: number): Point {
  const [a, b, t] = segment(HEAD_PATH, phase);
  const start = HEAD_PATH.indexOf(a);
  const slope = (index: number, column: 1 | 2): number => {
    if (index === 0 || index === HEAD_PATH.length - 1) return 0;
    const previous = HEAD_PATH[index - 1], next = HEAD_PATH[index + 1];
    return (next[column] - previous[column]) / (next[0] - previous[0]);
  };
  const value = (column: 1 | 2) => hermite(a[column], b[column], slope(start, column), slope(start + 1, column), b[0] - a[0], t);
  return { x: value(1), y: value(2) };
}

function sampleLift(phase: number): number {
  const [a, b, t] = segment(LIFT, phase);
  return hermite(a[1], b[1], a[2], b[2], b[0] - a[0], t);
}

function motionBeat(phase: number, weight: number): string {
  if (weight === 0) return 'rest';
  if (phase < HOP_TAKEOFF_PHASE) return 'windup';
  if (phase < 0.28) return 'push';
  if (phase < 0.5) return 'float';
  if (phase < HOP_CONTACT_PHASE) return 'reach';
  if (phase < 0.72) return 'contact';
  if (phase < 0.87) return 'rebound';
  return 'settle';
}

function smooth(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function idleBob(seconds: number, delay = 0): number {
  const phase = (Math.max(0, seconds - delay) % IDLE_BOB_SECONDS) / IDLE_BOB_SECONDS;
  if (phase < 0.55) return smooth(phase / 0.55);
  return 1 - smooth((phase - 0.55) / 0.45);
}

function primaryAngles(phase: number, weight: number, facing: number): { body: number; head: number } {
  const body = sampleTrack(JOINTS.body, phase)[1] * weight * facing;
  return { body, head: body + sampleTrack(JOINTS.head, phase)[1] * weight * (0.3 + 0.7 * facing) };
}

function gravityFollowThrough(
  phase: number, cadence: number, weight: number, facing: number,
): { ears: number; arms: number } {
  let ear = 0, arm = 0, earWeight = 0, armWeight = 0;
  const earSupport = 6, armSupport = 0.5, gravity = 1;
  // A critically damped angular-spring response sampled in seconds, not frames.
  for (let index = 0; index < 8; index++) {
    const seconds = (index + 0.5) * 0.012;
    const past = ((phase - seconds * cadence / HOP_DISTANCE) % 1 + 1) % 1;
    const angles = primaryAngles(past, weight, facing);
    const e = seconds * Math.exp(-seconds * 48), a = seconds * Math.exp(-seconds * 36);
    // Upright ears have spring support against gravity; hanging arms favor world-down.
    ear += angles.head * earSupport / (earSupport - gravity) * e;
    arm += angles.body * armSupport / (armSupport + gravity) * a;
    earWeight += e;
    armWeight += a;
  }
  return { ears: ear / earWeight, arms: arm / armWeight };
}

function boundedWorldAngle(parent: number, desired: number, limit: number): number {
  return parent + limit * Math.tanh((desired - parent) / limit);
}

function aimMotionPart(
  rig: CharacterRigState, id: RigPartId, tip: Point, pivotTarget: Point, worldDegrees: number,
): void {
  const transform = transformRig(rig)[id], pose = rig.parts[id];
  const delta = rotateRigVector({
    x: (tip.x - pose.pivot.x) * transform.scale.x,
    y: (tip.y - pose.pivot.y) * transform.scale.y,
  }, worldDegrees * Math.PI / 180);
  const result = solveRigEndpoint(rig, id, tip, pivotTarget, { x: pivotTarget.x + delta.x, y: pivotTarget.y + delta.y });
  if (result.angleLimited || result.error > 1e-7) throw new Error(`The ${id} motion target could not be seated.`);
}

function solveMotionFeet(
  rig: CharacterRigState, transforms: Record<RigPartId, RigTransform>, hop: number, follow: number, envelope: number,
): void {
  const air = smooth(hop / 0.35);
  const positive = Math.max(0, rig.parts.body.squashStretch);
  const stretch = positive * positive / (positive + 0.005);
  const bodyDegrees = transforms.body.angle * 180 / Math.PI;
  const flightAngle = boundedWorldAngle(bodyDegrees, follow, 10);
  for (const id of ['left-foot', 'right-foot'] as const) {
    const pose = rig.parts[id];
    const sole = { x: id === 'left-foot' ? 5 : 13, y: 29 };
    pose.squashStretch = rig.parts.body.squashStretch * 0.1 * (1 - air) - 0.035 * air;
    const scale = transformRig(rig)[id].scale;
    const rest = { x: (sole.x - pose.pivot.x) * scale.x, y: (sole.y - pose.pivot.y) * scale.y };
    const hipCorrection = rotateRigVector({
      x: (pose.pivot.x - rig.parts.body.pivot.x) * (RIG_PART_SHAPE.stretch.x - 1) * stretch,
      y: (pose.pivot.y - rig.parts.body.pivot.y) * (RIG_PART_SHAPE.stretch.y - 1) * stretch,
    }, transforms.body.angle);
    const flightPivot = {
      x: transforms[id].position.x + hipCorrection.x,
      y: transforms[id].position.y + hipCorrection.y - 0.35 * air,
    };
    const worldDegrees = flightAngle * air * envelope;
    const rotated = rotateRigVector(rest, worldDegrees * Math.PI / 180);
    const floorTip = { x: sole.x, y: sole.y + hop * 29 / 12 };
    const tip = {
      x: floorTip.x * (1 - air) + (flightPivot.x + rotated.x) * air,
      y: Math.min(floorTip.y, floorTip.y * (1 - air) + (flightPivot.y + rotated.y) * air),
    };
    const pivot = { x: tip.x - rotated.x, y: tip.y - rotated.y };
    aimMotionPart(rig, id, sole, pivot, worldDegrees);
  }
}

export function sampleRabbitMotion(character: CharacterState, setup?: CharacterRigState): RabbitMotionPose {
  const { gaitDistance, animationTime, motionWeight: weight, facingDirection, hop: clock } = character;
  const facing = character.facing * facingDirection * RABBIT_ARTWORK_FACING;
  if (!Number.isFinite(gaitDistance) || gaitDistance < 0
    || !Number.isFinite(animationTime) || animationTime < 0
    || !Number.isFinite(weight) || weight < 0 || weight > 1
    || !Number.isFinite(facing) || Math.abs(facing) > 1
    || (facingDirection !== -1 && facingDirection !== 1)
    || !clock || !Number.isFinite(clock.phase) || clock.phase < 0 || clock.phase >= 1
    || !Number.isFinite(clock.speed) || clock.speed < 0 || typeof clock.active !== 'boolean') {
    throw new RangeError('Rabbit motion needs finite non-negative distance/time, weight 0–1, facing -1–1, facing direction -1 or 1, and a valid hop clock.');
  }
  const phase = clock.phase;
  const weighted = (value: number): number => weight === 0 ? 0 : value * weight;
  // Soften the short shape impulses at running cadence, without changing Shallows.
  const shapeWeight = 1 - 0.5 * smooth((clock.speed - 9.9) / (22 - 9.9));
  const rig = createCharacterRig();
  rig.joints = false;
  rig.parts.body.pivot = { x: 9, y: 29 };
  rig.parts['left-foot'].pivot.y = 26;
  rig.parts['right-foot'].pivot.y = 26;
  rig.parts['left-arm'].pivot.y = 22;
  rig.parts['right-arm'].pivot.y = 22;
  for (const id of ['body', 'head'] as const) {
    const [, angle, x, y, shape] = sampleTrack(JOINTS[id], phase);
    const pose = rig.parts[id];
    const lean = id === 'body' ? facing : 0.3 + 0.7 * facing;
    pose.angle = weighted(angle * lean);
    pose.offset = { x: weighted(x * facing), y: weighted(y) };
    pose.squashStretch = weighted(shape * (id === 'body' ? shapeWeight : 1));
  }
  const path = sampleHeadPath(phase);
  rig.parts.head.offset = { x: weighted(path.x * facing), y: weighted(path.y) };
  // Fade by locomotion weight, so starting and finishing a hop never switch poses abruptly.
  const idleWeight = 1 - smooth(weight);
  const bob = idleBob(animationTime) * idleWeight;
  const headBob = idleBob(animationTime, 0.11) * idleWeight;
  const earBob = idleBob(animationTime, 0.16) * idleWeight;
  const headWobble = (headBob - bob) * 6.5;
  const earWobble = (earBob - idleBob(animationTime, 0.05) * idleWeight) * 6.5;
  // Translate the upper body over planted feet; shape change only supports the weight shift.
  rig.parts.body.offset.y += bob * 1.95;
  rig.parts.body.squashStretch -= bob * 0.012;
  rig.parts.head.offset.y += (headBob - bob) * 1.95 + headBob * 0.45;
  rig.parts.head.angle += headWobble;
  const [, eyeX, eyeY, gazeX, gazeY, noseX, noseY, bobX, bobY] = sampleTrack(FACE, phase);
  const blink = animationTime % 4.7 > 4.56;
  const hop = Math.max(0, sampleLift(phase)) * weight;
  const transforms = transformRig(rig), body = transforms.body;
  const headDegrees = transforms.head.angle * 180 / Math.PI, bodyDegrees = body.angle * 180 / Math.PI;
  const envelope = smooth(phase / 0.06) * smooth((1 - phase) / 0.2);
  const response = gravityFollowThrough(phase, clock.speed, weight, facing);
  // Keep the idle's delayed rocking separate from the hop's gravity response.
  const movingHeadDegrees = headDegrees - headWobble;
  const earWorld = boundedWorldAngle(movingHeadDegrees, movingHeadDegrees + (response.ears - movingHeadDegrees) * envelope, 20);
  for (const [id, side] of [['left-ear', -1], ['right-ear', 1]] as const) {
    const compliance = 1 + side * 0.02;
    rig.parts[id].squashStretch = rig.parts.head.squashStretch * 0.25;
    aimMotionPart(rig, id, { x: rig.parts[id].pivot.x, y: 0 }, transforms[id].position, earWorld * compliance + earWobble);
    rig.parts[id].offset.y += (earBob - headBob) * 1.95;
  }
  const armWorld = boundedWorldAngle(bodyDegrees, bodyDegrees + (response.arms - bodyDegrees) * envelope, 16);
  for (const [id, tipX] of [['left-arm', 3.5], ['right-arm', 14]] as const) {
    rig.parts[id].squashStretch = rig.parts.body.squashStretch * 0.06;
    aimMotionPart(rig, id, { x: tipX, y: 25.5 }, transforms[id].position, armWorld);
    rig.parts[id].offset.y += (headBob - bob) * 0.15;
  }
  solveMotionFeet(rig, transforms, hop, response.arms, envelope);
  if (setup) {
    validateRigState(setup);
    const defaults = createCharacterRig();
    for (const part of RABBIT_PARTS) {
      const pose = rig.parts[part.id], bind = setup.parts[part.id], initial = defaults.parts[part.id];
      if (bind.pivot.x !== initial.pivot.x) pose.pivot.x = bind.pivot.x;
      if (bind.pivot.y !== initial.pivot.y) pose.pivot.y = bind.pivot.y;
      if (bind.offset.x) pose.offset.x = Math.max(-RIG_POSITION_LIMIT, Math.min(RIG_POSITION_LIMIT, pose.offset.x + bind.offset.x));
      if (bind.offset.y) pose.offset.y = Math.max(-RIG_POSITION_LIMIT, Math.min(RIG_POSITION_LIMIT, pose.offset.y + bind.offset.y));
      if (bind.angle) pose.angle = Math.max(-part.limit, Math.min(part.limit, pose.angle + bind.angle));
      if (bind.squashStretch) pose.squashStretch = Math.max(-1, Math.min(1, pose.squashStretch + bind.squashStretch));
    }
  }
  const composedBody = setup ? transformRig(rig).body : body;
  return {
    facingDirection, phase, beat: motionBeat(phase, weight), hop, rig,
    summary: {
      hop, scaleX: composedBody.scale.x, scaleY: composedBody.scale.y,
      rotation: composedBody.angle === 0 ? 0 : composedBody.angle * facingDirection * RABBIT_ARTWORK_FACING, blink,
    },
    face: {
      eyeScale: { x: 1 + (eyeX - 1) * weight, y: 1 + (eyeY - 1) * weight },
      eyeOffset: { x: weighted(gazeX * facing), y: weighted(gazeY) },
      noseScale: { x: 1 + (noseX - 1) * weight, y: 1 + (noseY - 1) * weight },
      noseOffset: { x: weighted(bobX * facing), y: weighted(bobY) },
      blink,
    },
  };
}

export function motionSourceBounds(pose: RabbitMotionPose): Rectangle {
  const transforms = transformRig(pose.rig);
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const part of RABBIT_PARTS) {
    const regions = [
      ...part.regions,
      ...part.padding.map(pad => ({
        x: pad.x - pad.radius, y: pad.y - pad.radius, width: pad.radius * 2, height: pad.radius * 2,
      })),
      ...(part.underpainting ?? []).flatMap(paint => paint.regions),
    ];
    // Half a source pixel also covers nearest-neighbor rasterization at rotated edges.
    for (const rect of regions) {
      for (const x of [rect.x - 0.5, rect.x + rect.width + 0.5]) {
        for (const y of [rect.y - 0.5, rect.y + rect.height + 0.5]) {
          const point = rigPoint(pose.rig, transforms, part.id, { x, y });
          left = Math.min(left, point.x); right = Math.max(right, point.x);
          top = Math.min(top, point.y); bottom = Math.max(bottom, point.y);
        }
      }
    }
  }
  return {
    x: pose.facingDirection !== RABBIT_ARTWORK_FACING ? RIG_WIDTH - right : left,
    y: top, width: right - left, height: bottom - top,
  };
}
