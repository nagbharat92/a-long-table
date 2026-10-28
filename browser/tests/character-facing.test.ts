import { describe, expect, it } from 'vitest';
import { advanceCharacterAnimation, createCharacter } from '../src/core/game';
import { motionSourceBounds, sampleRabbitMotion } from '../src/core/character-motion';
import { createCharacterRig, RIG_WIDTH } from '../src/core/character-rig';

describe('character facing direction', () => {
  it('turns on horizontal travel and retains its heading through rest, vertical travel and tiny drift', () => {
    const character = createCharacter({ x: 20, y: 30 });
    expect(character.facingDirection).toBe(1);
    advanceCharacterAnimation(character, 0.1, 2, { x: -1, y: 0 }, true);
    expect(character.facingDirection).toBe(-1);
    for (let frame = 0; frame < 120; frame++) {
      advanceCharacterAnimation(character, 1 / 60, 0, { x: 0, y: 0 }, false);
    }
    expect(character.facingDirection).toBe(-1);
    advanceCharacterAnimation(character, 0.1, 2, { x: 0, y: -1 }, true);
    advanceCharacterAnimation(character, 0.1, 2, { x: 0, y: 1 }, true);
    advanceCharacterAnimation(character, 0.1, 2, { x: 0.001, y: 1 }, true);
    advanceCharacterAnimation(character, 0.1, 0.005, { x: 1, y: 0 }, true);
    advanceCharacterAnimation(character, 0.1, 0, { x: 1, y: 0 }, true);
    expect(character.facingDirection).toBe(-1);
    advanceCharacterAnimation(character, 0.1, 2, { x: 1, y: 0 }, true);
    expect(character.facingDirection).toBe(1);
    expect(character.position).toEqual({ x: 20, y: 30 });
  });

  it('keeps the same local animation, face and setup in either direction and mirrors selection bounds', () => {
    const character = createCharacter({ x: 20, y: 30 });
    const setup = createCharacterRig();
    setup.parts.head.offset = { x: 1.5, y: -1 };
    setup.parts.head.angle = 5;
    const saved = structuredClone(setup);
    for (const phase of [0, 0.12, 0.24, 0.42, 0.66, 0.98]) {
      character.hop = { phase, speed: 22, active: true };
      character.motionWeight = 1;
      character.facing = 1;
      character.facingDirection = 1;
      const right = sampleRabbitMotion(character, setup);
      character.facing = -1;
      character.facingDirection = -1;
      const left = sampleRabbitMotion(character, setup);
      expect(left.rig).toEqual(right.rig);
      expect(left.face).toEqual(right.face);
      expect(left.hop).toBe(right.hop);
      expect(left.summary.rotation).toBeCloseTo(-right.summary.rotation, 10);
      const a = motionSourceBounds(right), b = motionSourceBounds(left);
      expect(b.x).toBeCloseTo(RIG_WIDTH - a.x - a.width, 10);
      expect({ ...b, x: a.x }).toEqual(a);
    }
    expect(setup).toEqual(saved);
  });

  it('rejects invalid headings instead of collapsing or stretching the character', () => {
    const character = createCharacter({ x: 0, y: 0 });
    Object.assign(character, { facingDirection: 0 });
    expect(() => sampleRabbitMotion(character)).toThrow('facing direction');
  });
});
