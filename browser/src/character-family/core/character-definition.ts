import { renderAppearance, type CharacterAppearance } from './character-appearance';
import { expressionFeatures, expressionSource, renderExpressionBlink } from './character-expression';
import type { FaceLayer } from './character-face';
import { buildBearArtwork } from './bear-artwork';
import { buildCatArtwork } from './cat-artwork';
import {
  buildRigLayers, characterRigRecipe, characterSetup, RIG_WIDTH, sourceOwner,
  type CharacterRigState, type RigLayer, type RigPartId,
} from './character-rig';

export interface CharacterArtwork {
  source: Uint8ClampedArray;
  layers: RigLayer[];
  motion: { layers: RigLayer[]; face: FaceLayer[] };
}

export function originalCharacterAppearance(): CharacterAppearance {
  return {
    version: 8, seed: 0,
    parameters: {
      color: { coat: '#f7f9f8', shade: '#cacfe3' },
      pattern: { type: 'solid', color: '#ffffff', seed: 0 },
      ears: { type: 'plain', shape: 'upright', color: '#ffffff', colorMode: 'coat' },
      expression: { type: 'neutral' },
      accessory: { type: 'none', color: '#eb493b', colorMode: 'coat' },
    },
  };
}

export function characterPixelOwner(x: number, y: number): RigPartId {
  return y < 6 ? (x < RIG_WIDTH / 2 ? 'left-ear' : 'right-ear') : sourceOwner(x, y);
}

export function buildCharacterArtwork(original: Uint8ClampedArray, appearance: CharacterAppearance): CharacterArtwork {
  if (appearance.species === 'bear') return buildBearArtwork(appearance);
  if (appearance.species === 'cat') return buildCatArtwork(appearance);
  if (appearance.species !== undefined && appearance.species !== 'rabbit') throw new Error('Unknown character species.');
  const expression = appearance.parameters.expression;
  const accessory = appearance.parameters.accessory;
  if (!expression || !accessory) throw new Error('A shared character requires expression and accessory settings.');
  const source = renderAppearance(original, appearance);
  const uncovered = structuredClone(appearance);
  uncovered.parameters.accessory = { ...accessory, type: 'none' };
  const bare = renderAppearance(original, uncovered);
  const layers = buildRigLayers(bare, characterPixelOwner);
  if (accessory.type !== 'none') {
    const pixels = new Uint8ClampedArray(source.length);
    for (let i = 0; i < source.length; i += 4) {
      if (source.subarray(i, i + 4).some((value, channel) => value !== bare[i + channel])) {
        pixels.set(source.subarray(i, i + 4), i);
      }
    }
    layers.splice(layers.length - 1, 0, {
      id: 'body', attachment: 'accessory', pixels, padding: new Uint8ClampedArray(source.length),
      bounds: { x: 5, y: 19, width: 9, height: 7 },
    });
  }
  const withoutEyes = structuredClone(uncovered);
  withoutEyes.parameters.expression = { type: 'neutral' };
  const underlay = renderAppearance(expressionSource(original, { type: 'happy' }), withoutEyes);
  const closed = underlay.slice();
  renderExpressionBlink(closed, expression);
  const motionLayers = layers.map(layer => ({ ...layer, pixels: layer.pixels.slice() }));
  const head = motionLayers.find(layer => layer.id === 'head')!;
  const face = expressionFeatures(expression).map(feature => {
    const pixels = new Uint8ClampedArray(source.length), blink = new Uint8ClampedArray(source.length);
    for (const region of feature.regions) {
      for (let y = region.y; y < region.y + region.height; y++) {
        for (let x = region.x; x < region.x + region.width; x++) {
          const i = (y * RIG_WIDTH + x) * 4;
          if (feature.id === 'nose') {
            pixels.set(bare.subarray(i, i + 4), i);
            blink.set(bare.subarray(i, i + 4), i);
            const fill = underlay.subarray((10 * RIG_WIDTH + 7) * 4, (10 * RIG_WIDTH + 7) * 4 + 4);
            head.pixels.set(fill, i);
          } else {
            if (bare.subarray(i, i + 3).some((value, channel) => value !== underlay[i + channel])) {
              pixels.set(bare.subarray(i, i + 4), i);
            }
            if (closed.subarray(i, i + 3).some((value, channel) => value !== underlay[i + channel])) {
              blink.set(closed.subarray(i, i + 4), i);
            }
            head.pixels.set(underlay.subarray(i, i + 4), i);
          }
        }
      }
    }
    return { feature, pixels, blink };
  });
  return { source, layers, motion: { layers: motionLayers, face } };
}

export function characterDefinitionRecipe(appearance: CharacterAppearance, state: CharacterRigState) {
  if ((appearance.species ?? 'rabbit') !== (state.species ?? 'rabbit')) {
    throw new Error('The character artwork and rig must use the same species.');
  }
  const setup = characterSetup(state);
  const rig = characterRigRecipe(setup);
  for (const layer of rig.layers) {
    if ((!appearance.species || appearance.species === 'rabbit') && (layer.id === 'left-ear' || layer.id === 'right-ear')) {
      layer.regions = [{ x: layer.id === 'left-ear' ? 0 : RIG_WIDTH / 2, y: 0, width: RIG_WIDTH / 2, height: 6 }];
    }
  }
  return {
    ...appearance,
    rig: { ...rig, setup, attachments: [{ id: 'accessory', parent: 'body' }] },
  };
}

export function exportCharacterDefinition(appearance: CharacterAppearance, state: CharacterRigState): string {
  return JSON.stringify(characterDefinitionRecipe(appearance, state), null, 2);
}
