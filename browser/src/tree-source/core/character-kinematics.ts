import type { Point } from './contracts';
import {
  RABBIT_PARTS, RIG_POSITION_LIMIT, rigPoint, transformRig, type CharacterRigState, type RigPartId,
} from './character-rig';

export function rotateRigVector(point: Point, angle: number): Point {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: point.x * c - point.y * s, y: point.x * s + point.y * c };
}

export function solveRigEndpoint(
  rig: CharacterRigState, id: RigPartId, sourceTip: Point, pivotTarget: Point, tipTarget: Point,
): { error: number; angleLimited: boolean } {
  if (![sourceTip, pivotTarget, tipTarget].every(point => Number.isFinite(point.x) && Number.isFinite(point.y))) {
    throw new RangeError('Rig endpoint targets must be finite.');
  }
  const part = RABBIT_PARTS.find(candidate => candidate.id === id);
  if (!part?.parent) throw new RangeError('Endpoint IK needs an attached rig part.');
  const transforms = transformRig(rig);
  const pose = rig.parts[id], parent = transforms[part.parent];
  const rest = {
    x: (sourceTip.x - pose.pivot.x) * transforms[id].scale.x,
    y: (sourceTip.y - pose.pivot.y) * transforms[id].scale.y,
  };
  const target = { x: tipTarget.x - pivotTarget.x, y: tipTarget.y - pivotTarget.y };
  if (Math.hypot(rest.x, rest.y) < 1e-9 || Math.hypot(target.x, target.y) < 1e-9) {
    throw new RangeError('Rig endpoint IK needs a nonzero link and target direction.');
  }
  const worldAngle = Math.atan2(target.y, target.x) - Math.atan2(rest.y, rest.x);
  const relative = worldAngle - parent.angle;
  const angle = Math.atan2(Math.sin(relative), Math.cos(relative)) * 180 / Math.PI;
  const limit = part.limit;
  const limited = Math.max(-limit, Math.min(limit, angle));
  const correction = rotateRigVector({
    x: pivotTarget.x - transforms[id].position.x, y: pivotTarget.y - transforms[id].position.y,
  }, -parent.angle);
  const offset = { x: pose.offset.x + correction.x, y: pose.offset.y + correction.y };
  if (Math.abs(offset.x) > RIG_POSITION_LIMIT || Math.abs(offset.y) > RIG_POSITION_LIMIT) {
    throw new RangeError(`The ${part.name.toLowerCase()} IK target is outside the attachment range.`);
  }
  pose.angle = limited;
  pose.offset = offset;
  const actual = rigPoint(rig, transformRig(rig), id, sourceTip);
  return { error: Math.hypot(actual.x - tipTarget.x, actual.y - tipTarget.y), angleLimited: limited !== angle };
}
