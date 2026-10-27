import { describe, expect, it } from 'vitest';
import { dampedMotion } from '../src/core/motion-clock';
import { createCharacter, advanceCharacterAnimation } from '../src/core/game';
import { HOP_CONTACT_PHASE, HOP_DISTANCE, sampleRabbitMotion } from '../src/core/character-motion';

function advanceFor(
  character: ReturnType<typeof createCharacter>,
  seconds: number,
  steps: number[],
  speed: number,
): void {
  let elapsed = 0, index = 0;
  while (elapsed < seconds - 1e-12) {
    const delta = Math.min(steps[index++ % steps.length], seconds - elapsed);
    advanceCharacterAnimation(character, delta, speed * delta, { x: 1, y: 0 }, speed > 0);
    elapsed += delta;
  }
}

describe('elapsed-time motion clocks', () => {
  it('integrates an eased speed analytically, not with a per-frame lerp', () => {
    const expected = dampedMotion(0.25, 1, 1, 8);
    for (const fps of [15, 30, 60, 120, 144]) {
      let value = 0.25, integral = 0;
      for (let frame = 0; frame < fps; frame++) {
        const next = dampedMotion(value, 1, 1 / fps, 8);
        value = next.value;
        integral += next.integral;
      }
      expect(value).toBeCloseTo(expected.value, 12);
      expect(integral).toBeCloseTo(expected.integral, 12);
    }
    expect(dampedMotion(0.25, 1, 0.1, 8).integral).toBeGreaterThan(0.025);
    expect(dampedMotion(0.25, 1, 0.1, 8).integral).toBeLessThan(0.1);
    expect(dampedMotion(1, 0.25, 0.1, 8).integral).toBeGreaterThan(0.025);
    expect(dampedMotion(1, 0.25, 0.1, 8).integral).toBeLessThan(0.1);
    expect(dampedMotion(0, 22, 1e-8, 8).integral).toBeGreaterThanOrEqual(0);
  });

  it('gently accelerates cadence without changing physical distance or snapping to full speed', () => {
    const character = createCharacter({ x: 10, y: 20 });
    advanceFor(character, 0.1, [1 / 120], 22);
    expect(character.gaitDistance).toBeCloseTo(2.2);
    expect(character.hop.speed).toBeGreaterThan(0);
    expect(character.hop.speed).toBeLessThan(15);
    expect(character.hop.phase).toBeLessThan(character.gaitDistance / HOP_DISTANCE);
    expect(character.position).toEqual({ x: 10, y: 20 });
    advanceFor(character, 1, [1 / 120], 22);
    expect(character.hop.speed).toBeGreaterThan(21.9);
    const previous = character.hop.speed;
    advanceFor(character, 0.05, [1 / 120], 9.9);
    expect(character.hop.speed).toBeLessThan(previous);
    expect(character.hop.speed).toBeGreaterThan(9.9);
  });

  it('finishes an airborne hop through landing and a full recovery instead of fading in midair', () => {
    const character = createCharacter({ x: 10, y: 20 });
    character.hop = { phase: 0.42, speed: 22, active: true };
    character.direction = { x: 1, y: 0 };
    character.motionWeight = 1;
    character.facing = 1;
    const distance = character.gaitDistance;
    expect(sampleRabbitMotion(character).hop).toBeCloseTo(2.4);
    advanceFor(character, 0.1, [1 / 60], 0);
    expect(character.hop.phase).toBeGreaterThan(0.42);
    expect(character.motionWeight).toBe(1);
    const recoveryTime = (HOP_CONTACT_PHASE - character.hop.phase) * HOP_DISTANCE / 22 + 0.005;
    advanceFor(character, recoveryTime, [1 / 60], 0);
    expect(sampleRabbitMotion(character).hop).toBe(0);
    expect(character.hop.active).toBe(true);
    advanceFor(character, 1, [1 / 60], 0);
    expect(character.hop).toMatchObject({ phase: 0, active: false });
    const pose = sampleRabbitMotion(character);
    expect(pose.summary).toMatchObject({ hop: 0, rotation: 0 });
    expect(character.motionWeight).toBeLessThan(0.001);
    expect(pose.summary.scaleY).toBeLessThan(1);
    expect(pose.summary.scaleY).toBeGreaterThan(0.99);
    expect(pose.summary.scaleX).toBeGreaterThan(1);
    expect(pose.summary.scaleX).toBeLessThan(1.012);
    expect(pose.rig.parts.body.offset.y).toBeGreaterThan(0);
    expect(pose.rig.parts.head.squashStretch).toBe(0);
    const idle = sampleRabbitMotion({ ...character, motionWeight: 0 });
    expect(pose.rig.parts.head.angle).toBeCloseTo(idle.rig.parts.head.angle, 3);
    expect(Math.abs(pose.rig.parts.head.angle)).toBeGreaterThan(1);
    expect(character.position).toEqual({ x: 10, y: 20 });
    expect(character.gaitDistance).toBe(distance);
    advanceFor(character, 1, [1 / 60], 0);
    expect(character.hop).toMatchObject({ phase: 0, active: false });
  });

  it('cancels a grounded windup gently without inventing a jump', () => {
    const character = createCharacter({ x: 0, y: 0 });
    advanceFor(character, 0.1, [1 / 60], 22);
    const phase = character.hop.phase;
    advanceFor(character, 0.2, [1 / 60], 0);
    expect(character.hop.active).toBe(false);
    expect(character.hop.phase).toBeCloseTo(phase * Math.exp(-2), 12);
    expect(character.motionWeight).toBeGreaterThan(0);
    expect(sampleRabbitMotion(character).hop).toBe(0);
    advanceFor(character, 2, [1 / 60], 0);
    expect(character.motionWeight).toBeLessThan(1e-6);
  });

  it('matches start, stop, restart and shallow-to-fast transitions at every tested refresh rate', () => {
    const runs = [
      ...[15, 30, 60, 120, 144].map(fps => [1 / fps]),
      [0.011, 0.034, 0.007, 0.052],
    ];
    const timelines = runs.map(steps => {
      const character = createCharacter({ x: 0, y: 0 });
      return [[0.7, 22], [0.08, 0], [1, 0], [0.35, 9.9], [0.65, 22], [1.5, 0]].map(([seconds, speed]) => {
        advanceFor(character, seconds, steps, speed);
        return structuredClone(character);
      });
    });
    for (const timeline of timelines.slice(1)) {
      timeline.forEach((character, index) => {
        const expected = timelines[0][index];
        expect(character.hop.phase).toBeCloseTo(expected.hop.phase, 10);
        expect(character.hop.speed).toBeCloseTo(expected.hop.speed, 10);
        expect(character.hop.active).toBe(expected.hop.active);
        expect(character.motionWeight).toBeCloseTo(expected.motionWeight, 10);
        expect(character.facing).toBeCloseTo(expected.facing, 10);
        expect(character.animationTime).toBeCloseTo(expected.animationTime, 10);
        expect(character.gaitDistance).toBeCloseTo(expected.gaitDistance, 10);
      });
    }
  });

  it('rejects invalid clocks and zero-time travel before changing state', () => {
    const invalid: [number, number, number, number][] = [
      [NaN, 1, 1, 8], [1, Infinity, 1, 8], [1, 1, -1, 8], [1, 1, 1, 0], [-1, 1, 1, 8],
    ];
    for (const values of invalid) expect(() => dampedMotion(...values)).toThrow(RangeError);
    const character = createCharacter({ x: 0, y: 0 });
    const before = structuredClone(character);
    expect(() => advanceCharacterAnimation(character, 0, 1, { x: 1, y: 0 }, true)).toThrow(RangeError);
    expect(character).toEqual(before);
    character.hop = { phase: 0.5, speed: 0, active: true };
    const airborne = structuredClone(character);
    expect(() => advanceCharacterAnimation(character, 0.1, 0, { x: 0, y: 0 }, false)).toThrow(RangeError);
    expect(character).toEqual(airborne);
  });
});
