import {
  MUSHROOM_FACINGS, MUSHROOM_PALETTES, MUSHROOM_PREVIEW_SIZE, MUSHROOM_SHAPES, MUSHROOM_SIZES, MUSHROOM_STEMS,
  drawMushroomPreview, generateMushroom, mushroomSeed,
} from './core/mushroom-appearance';
import { mountGroundAssetExplorer } from './ground-asset-explorer';

export function mountMushroomExplorer(root: HTMLElement, parameters: URLSearchParams, signal: AbortSignal): void {
  mountGroundAssetExplorer(root, parameters, signal, {
    tab: 'mushrooms', name: 'Mushroom', title: 'Mushrooms', paletteLabel: 'Cap color',
    intro: 'Rounded woodland caps and a white-spotted fly agaric with a pale stem collar. Choose Red for the classic red-and-white toadstool. Visual assets only, not a guide to edible mushrooms.',
    dimensions: MUSHROOM_PREVIEW_SIZE, shapes: MUSHROOM_SHAPES, palettes: MUSHROOM_PALETTES,
    sizes: MUSHROOM_SIZES, facings: MUSHROOM_FACINGS,
    defaultSeed: 618,
    seed: mushroomSeed, generate: generateMushroom, draw: drawMushroomPreview,
    references: [{
      title: 'Fly agaric: cap, veil remnants and stem collar',
      url: 'https://en.wikipedia.org/wiki/Amanita_muscaria',
      note: 'Nature study: domed red cap, irregular pale warts, white gills and hanging stem ring. Original pixel artwork, not traced.',
    }],
    extraChoices: [{
      title: 'Stem length', names: MUSHROOM_STEMS,
      selected: appearance => appearance.stem,
      set: (appearance, index) => { appearance.stem = index; },
    }],
  });
}
