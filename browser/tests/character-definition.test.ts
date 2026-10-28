import { describe, expect, it } from 'vitest';
import { approvedRabbitSource } from './helpers/rabbit-source';
import { buildCharacterArtwork, characterDefinitionRecipe, originalCharacterAppearance } from '../src/core/character-definition';
import { CHARACTER_EAR_SHAPES } from '../src/core/character-ear-shape';
import { CHARACTER_EXPRESSIONS } from '../src/core/character-expression';
import { CHARACTER_ACCESSORIES } from '../src/core/character-accessory';
import { CHARACTER_COLOR_PALETTES, CHARACTER_EAR_MARKINGS, generateAppearance } from '../src/core/character-appearance';
import { auditRig, characterSetup, createCharacterRig, RIG_WIDTH, validateRigState } from '../src/core/character-rig';
import { sampleRabbitMotion } from '../src/core/character-motion';
import type { CharacterState } from '../src/core/contracts';

function composite(buffers: Uint8ClampedArray[]): Uint8ClampedArray {
  const result = new Uint8ClampedArray(buffers[0].length);
  for (const pixels of buffers) {
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3]) result.set(pixels.subarray(i, i + 4), i);
    }
  }
  return result;
}

describe('shared character definition', () => {
  it('reproduces the approved original and reconstructs every customized recipe in both renderers', () => {
    const original = approvedRabbitSource(), before = original.slice();
    expect(buildCharacterArtwork(original, originalCharacterAppearance()).source).toEqual(original);
    const appearance = generateAppearance(42);
    for (const color of [CHARACTER_COLOR_PALETTES[0], CHARACTER_COLOR_PALETTES[6]]) {
      appearance.parameters.color = color;
      for (const { type: shape } of CHARACTER_EAR_SHAPES) {
        appearance.parameters.ears.shape = shape;
        for (const { type: marking } of CHARACTER_EAR_MARKINGS) {
          appearance.parameters.ears.type = marking;
          for (const { type: expression } of CHARACTER_EXPRESSIONS) {
            appearance.parameters.expression.type = expression;
            for (const { type: accessory } of CHARACTER_ACCESSORIES) {
              appearance.parameters.accessory.type = accessory;
              const artwork = buildCharacterArtwork(original, appearance);
              expect(auditRig(createCharacterRig(), artwork.layers, artwork.source).restDifferencePixels).toBe(0);
              expect(composite(artwork.motion.layers.map(layer => layer.pixels).concat(artwork.motion.face.map(layer => layer.pixels))))
                .toEqual(artwork.source);
              expect(artwork.layers.filter(layer => layer.attachment)).toHaveLength(accessory === 'none' ? 0 : 1);
            }
          }
        }
      }
    }
    expect(original).toEqual(before);
  });

  it('assigns the full folded ear silhouettes to ear joints, with neckwear on its own body attachment', () => {
    const appearance = generateAppearance(42);
    appearance.parameters.ears.shape = 'both-floppy';
    appearance.parameters.accessory.type = 'bandana';
    const artwork = buildCharacterArtwork(approvedRabbitSource(), appearance);
    for (const layer of artwork.layers) {
      for (let y = 0; y < 6; y++) {
        for (let x = 0; x < RIG_WIDTH; x++) {
          if (!layer.pixels[(y * RIG_WIDTH + x) * 4 + 3]) continue;
          expect(layer.id).toBe(x < RIG_WIDTH / 2 ? 'left-ear' : 'right-ear');
        }
      }
    }
    expect(artwork.layers.find(layer => layer.attachment)?.id).toBe('body');
  });

  it('blinks complete expression drawings without changing ears, nose, accessories or the head underpainting', () => {
    const appearance = generateAppearance(42);
    for (const { type } of CHARACTER_EXPRESSIONS) {
      appearance.parameters.expression.type = type;
      const artwork = buildCharacterArtwork(approvedRabbitSource(), appearance);
      const open = composite(artwork.motion.layers.map(layer => layer.pixels).concat(artwork.motion.face.map(layer => layer.pixels)));
      const closed = composite(artwork.motion.layers.map(layer => layer.pixels).concat(artwork.motion.face.map(layer => layer.blink)));
      expect(closed).not.toEqual(open);
      for (let i = 0; i < open.length; i += 4) {
        const x = i / 4 % RIG_WIDTH, y = Math.floor(i / 4 / RIG_WIDTH);
        const eyeRegion = artwork.motion.face.filter(layer => layer.feature.id !== 'nose')
          .some(layer => layer.feature.regions.some(region =>
            x >= region.x && x < region.x + region.width && y >= region.y && y < region.y + region.height));
        if (!eyeRegion) expect(closed.slice(i, i + 4)).toEqual(open.slice(i, i + 4));
      }
    }
  });

  it('layers valid rig setup over animation without baking inspection controls or changing the saved setup', () => {
    const character: CharacterState = {
      position: { x: 20, y: 30 }, direction: { x: 1, y: 0 }, route: [], routeIndex: 0,
      selected: false, gaitDistance: 0, animationTime: 0, motionWeight: 1, facing: 1, facingDirection: 1,
      hop: { phase: 0, speed: 22, active: true },
    };
    const setup = createCharacterRig();
    for (let frame = 0; frame < 60; frame++) {
      character.hop.phase = frame / 60;
      expect(sampleRabbitMotion(character, setup)).toEqual(sampleRabbitMotion(character));
    }
    setup.parts.head.offset = { x: 1.5, y: -2 };
    setup.parts.head.pivot.y = 17.5;
    setup.parts['left-ear'].angle = 12;
    setup.explode = 1; setup.stress = 1; setup.padding = true;
    const before = structuredClone(setup);
    const clean = characterSetup(setup);
    for (let frame = 0; frame < 60; frame++) {
      character.hop.phase = frame / 60;
      const plain = sampleRabbitMotion(character), pose = sampleRabbitMotion(character, clean);
      expect(pose.rig.parts.head.pivot.y).toBe(17.5);
      expect(pose.rig.parts.head.offset.x).toBeCloseTo(plain.rig.parts.head.offset.x + 1.5);
      expect(pose.rig.explode).toBe(0);
      expect(pose.rig.stress).toBe(0);
      expect(pose.rig.padding).toBe(false);
      expect(() => validateRigState(pose.rig)).not.toThrow();
    }
    expect(setup).toEqual(before);
    const recipe = characterDefinitionRecipe(generateAppearance(42), setup);
    expect(recipe.rig.setup).toEqual(clean);
    expect(recipe.rig.layers.find(layer => layer.id === 'left-ear')?.regions)
      .toEqual([{ x: 0, y: 0, width: 9, height: 6 }]);
    expect(recipe.parameters.ears?.shape).toBe('both-floppy');
  });
});
