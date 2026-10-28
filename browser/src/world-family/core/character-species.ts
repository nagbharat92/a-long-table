import {
  CHARACTER_COLOR_PALETTES, generateAppearance, linkedAccessoryColor, linkedEarColor,
  type CharacterColors, type GeneratedCharacterAppearance,
} from './character-appearance';
import type { CharacterSpecies } from './character-rig';

export const CHARACTER_SPECIES = [
  { type: 'rabbit', name: 'Bunny' },
  { type: 'bear', name: 'Bear' },
  { type: 'cat', name: 'Cat' },
] as const;

export const BEAR_COLOR_PALETTES = [
  { name: 'Honey', coat: '#c88d50', shade: '#9b603a' },
  { name: 'Toffee', coat: '#b67a4c', shade: '#865332' },
  { name: 'Biscuit', coat: '#dbb17d', shade: '#ac8054' },
  { name: 'Cocoa', coat: '#94684f', shade: '#6e4838' },
  { name: 'Cinnamon', coat: '#c17d57', shade: '#92543e' },
  { name: 'Oat', coat: '#e5cbaa', shade: '#bca082' },
  { name: 'Rosewood', coat: '#b5897c', shade: '#896459' },
  { name: 'Polar', coat: '#f1e7d4', shade: '#c7baa5' },
] as const satisfies readonly (CharacterColors & { name: string })[];

export const CAT_COLOR_PALETTES = [
  { name: 'Blue velvet', coat: '#aeb9ce', shade: '#7d8ba8' },
  { name: 'Apricot', coat: '#e5b68b', shade: '#b98364' },
  { name: 'Milk', coat: '#f0e9dc', shade: '#c4bbaf' },
  { name: 'Lilac', coat: '#c8b7cc', shade: '#98869f' },
  { name: 'Silver', coat: '#c9ced2', shade: '#929ca8' },
  { name: 'Fawn', coat: '#cdb8a6', shade: '#a08a7c' },
  { name: 'Peach cream', coat: '#edcfb7', shade: '#c4a18c' },
  { name: 'Dusk', coat: '#9296ae', shade: '#666c86' },
] as const satisfies readonly (CharacterColors & { name: string })[];

export function characterSpecies(value: string | null): CharacterSpecies {
  if (value === null || value === 'rabbit') return 'rabbit';
  if (value === 'bear') return 'bear';
  if (value === 'cat') return 'cat';
  throw new RangeError('Choose Bunny, Bear or Cat.');
}

export function speciesPalettes(species: CharacterSpecies) {
  switch (species) {
    case 'rabbit': return CHARACTER_COLOR_PALETTES;
    case 'bear': return BEAR_COLOR_PALETTES;
    case 'cat': return CAT_COLOR_PALETTES;
    default: throw new RangeError('Unknown character species.');
  }
}

export function generateSpeciesAppearance(seed: number, species: CharacterSpecies): GeneratedCharacterAppearance {
  const appearance = generateAppearance(seed);
  if (species === 'rabbit') return appearance;
  const palettes = speciesPalettes(species);
  const palette = palettes[(Math.imul(seed, 2654435761) >>> 0) % palettes.length];
  return {
    ...appearance, version: 9, species,
    parameters: {
      ...appearance.parameters,
      color: { coat: palette.coat, shade: palette.shade },
      ears: {
        type: 'inner', shape: 'upright',
        color: species === 'cat' ? linkedEarColor(palette, 'inner') : '#e0b48a', colorMode: 'coat',
      },
      accessory: { type: 'none', color: linkedAccessoryColor(palette), colorMode: 'coat' },
    },
  };
}

export function originalBearAppearance(): GeneratedCharacterAppearance {
  const appearance = generateSpeciesAppearance(0, 'bear');
  appearance.parameters.expression.type = 'neutral';
  return appearance;
}

export function originalCatAppearance(): GeneratedCharacterAppearance {
  const appearance = generateSpeciesAppearance(0, 'cat');
  appearance.parameters.expression.type = 'neutral';
  return appearance;
}
