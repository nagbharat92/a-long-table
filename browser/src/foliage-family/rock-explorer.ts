import { ROCK_FACINGS, ROCK_PALETTES, ROCK_PREVIEW_SIZE, ROCK_SHAPES, ROCK_SIZES, drawRockPreview, generateRock, rockSeed } from './core/rock-appearance';
import { mountGroundAssetExplorer } from './ground-asset-explorer';

export function mountRockExplorer(root: HTMLElement, parameters: URLSearchParams, signal: AbortSignal): void {
  mountGroundAssetExplorer(root, parameters, signal, {
    tab: 'rocks', name: 'Rock', title: 'Rocks', paletteLabel: 'Stone',
    intro: 'Single stones to use alone or combine later. Compare silhouettes at the same size and facing.',
    dimensions: ROCK_PREVIEW_SIZE, shapes: ROCK_SHAPES, palettes: ROCK_PALETTES, sizes: ROCK_SIZES, facings: ROCK_FACINGS,
    seed: rockSeed, generate: generateRock, draw: drawRockPreview,
  });
}
