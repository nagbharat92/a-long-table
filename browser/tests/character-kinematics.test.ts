import { describe, expect, it } from 'vitest';
import { rotateRigVector, solveRigEndpoint } from '../src/core/character-kinematics';
import { createCharacterRig, rigPoint, transformRig } from '../src/core/character-rig';

describe('single-link attachment IK', () => {
  it('aims a scaled part at an endpoint in world space, compensating parent rotation', () => {
    const rig = createCharacterRig();
    rig.parts.body.angle = 6;
    rig.parts.body.squashStretch = 0.2;
    rig.parts['left-arm'].squashStretch = -0.1;
    const before = structuredClone(rig), transforms = transformRig(rig);
    const tip = { x: 3.5, y: 25.5 }, pivot = transforms['left-arm'].position;
    const pose = rig.parts['left-arm'], scale = transforms['left-arm'].scale;
    const delta = rotateRigVector({
      x: (tip.x - pose.pivot.x) * scale.x, y: (tip.y - pose.pivot.y) * scale.y,
    }, -2 * Math.PI / 180);
    const target = { x: pivot.x + delta.x, y: pivot.y + delta.y };
    const result = solveRigEndpoint(rig, 'left-arm', tip, pivot, target);
    expect(result.angleLimited).toBe(false);
    expect(result.error).toBeLessThan(1e-10);
    expect(rig.parts['left-arm'].angle).toBeCloseTo(-8);
    const actual = rigPoint(rig, transformRig(rig), 'left-arm', tip);
    expect(actual.x).toBeCloseTo(target.x, 10);
    expect(actual.y).toBeCloseTo(target.y, 10);
    expect(rig.parts.body).toEqual(before.parts.body);
    expect(rig.parts['right-arm']).toEqual(before.parts['right-arm']);
    expect(rig.parts['left-arm'].pivot).toEqual(before.parts['left-arm'].pivot);
    expect(rig.parts['left-arm'].squashStretch).toBe(-0.1);
  });

  it('plants a flat sole while the parent leans and changes shape', () => {
    for (const angle of [-6, 0, 6]) {
      for (const shape of [-0.4, 0, 0.2]) {
        const rig = createCharacterRig();
        rig.parts.body.pivot.y = 29;
        rig.parts.body.angle = angle;
        rig.parts.body.squashStretch = shape;
        rig.parts['left-foot'].pivot.y = 26;
        const target = { x: 5, y: 29 }, pivot = { x: 6, y: 26 };
        expect(solveRigEndpoint(rig, 'left-foot', target, pivot, target).error).toBeLessThan(1e-10);
        expect(transformRig(rig)['left-foot'].angle).toBeCloseTo(0, 10);
        const sole = rigPoint(rig, transformRig(rig), 'left-foot', target);
        expect(sole.x).toBeCloseTo(5, 10);
        expect(sole.y).toBeCloseTo(29, 10);
      }
    }
  });

  it('reports angular and fixed-link reach errors rather than pretending to hit an unreachable target', () => {
    const rig = createCharacterRig();
    const pivot = transformRig(rig)['left-arm'].position;
    const tip = { x: 3.5, y: 25.5 };
    const rotated = rotateRigVector({ x: tip.x - 5, y: tip.y - 21 }, Math.PI / 2);
    const limited = solveRigEndpoint(rig, 'left-arm', tip, pivot, { x: pivot.x + rotated.x, y: pivot.y + rotated.y });
    expect(limited.angleLimited).toBe(true);
    expect(limited.error).toBeGreaterThan(1);
    expect(rig.parts['left-arm'].angle).toBe(18);
    const extended = solveRigEndpoint(rig, 'left-arm', tip, pivot, { x: pivot.x - 3, y: pivot.y + 9 });
    expect(extended.error).toBeGreaterThan(1);
  });

  it('rejects invalid or detached targets before modifying the rig', () => {
    const rig = createCharacterRig(), before = structuredClone(rig);
    expect(() => solveRigEndpoint(rig, 'body', { x: 9, y: 29 }, { x: 9, y: 23 }, { x: 9, y: 29 })).toThrow('attached');
    expect(() => solveRigEndpoint(rig, 'head', { x: NaN, y: 0 }, { x: 9, y: 18 }, { x: 9, y: 0 })).toThrow('finite');
    expect(() => solveRigEndpoint(rig, 'left-arm', { x: 5, y: 21 }, { x: 5, y: 21 }, { x: 5, y: 25 })).toThrow('nonzero');
    expect(() => solveRigEndpoint(rig, 'left-arm', { x: 3, y: 25 }, { x: -100, y: 21 }, { x: -102, y: 25 })).toThrow('attachment range');
    expect(rig).toEqual(before);
  });
});
