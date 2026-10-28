import { WOOD_FACINGS, WOOD_PALETTES, WOOD_PREVIEW_SIZE, WOOD_SHAPES, WOOD_SIZES, drawWoodPreview, generateWood, woodSeed } from './core/wood-appearance';
import { mountGroundAssetExplorer } from './ground-asset-explorer';

export function mountWoodExplorer(root: HTMLElement, parameters: URLSearchParams, signal: AbortSignal): void {
  mountGroundAssetExplorer(root, parameters, signal, {
    tab: 'wood', name: 'Wood', title: 'Wood', paletteLabel: 'Wood tone',
    intro: 'Fallen wood with bark, broken ends and growth rings. Use each piece alone or combine later.',
    dimensions: WOOD_PREVIEW_SIZE, shapes: WOOD_SHAPES, palettes: WOOD_PALETTES, sizes: WOOD_SIZES, facings: WOOD_FACINGS,
    seed: woodSeed, generate: generateWood, draw: drawWoodPreview,
  });
}
