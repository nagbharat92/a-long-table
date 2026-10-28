import { BOTANICAL_ASSETS } from './core/botanical-assets';
import { FOREST_FLOOR_ASSETS } from './core/forest-floor-assets';
import { HARVEST_SHORE_ASSETS } from './core/harvest-shore-assets';
import {
  GROUND_ART_FACINGS, GROUND_ART_SIZE, GROUND_ART_SIZES,
  drawGroundArt, generateGroundArt, groundArtSeed,
} from './core/ground-pixel-art';
import { mountGroundAssetExplorer } from './ground-asset-explorer';
import { GROUND_ASSET_GROUPS, type StaticGroundAssetTab } from './foliage-tabs';

export const NATURE_ASSETS = [...BOTANICAL_ASSETS, ...FOREST_FLOOR_ASSETS, ...HARVEST_SHORE_ASSETS];

const DEFAULT_SEEDS: Readonly<Record<string, number>> = {
  ferns: 35, moss: 112, reeds: 164, leaves: 51, seeds: 14,
  pebbles: 49, roots: 56, vegetables: 168, fruit: 39, shells: 40,
};

export function mountNatureAssetExplorer(root: HTMLElement, parameters: URLSearchParams, signal: AbortSignal): void {
  const asset = NATURE_ASSETS.find(asset => asset.id === parameters.get('tab'));
  if (!asset) throw new RangeError('Unknown nature asset family.');
  const tab = GROUND_ASSET_GROUPS.flatMap(group => [...group.assets])
    .map(([id]) => id).find((id): id is StaticGroundAssetTab => id === asset.id && id !== 'bush' && id !== 'grass');
  if (!tab) throw new RangeError(`Missing navigation for ${asset.title}.`);
  mountGroundAssetExplorer(root, parameters, signal, {
    tab, name: asset.name, title: asset.title, paletteLabel: asset.paletteLabel, intro: asset.intro,
    dimensions: GROUND_ART_SIZE, shapes: asset.shapes, palettes: asset.palettes, sizes: GROUND_ART_SIZES,
    facings: GROUND_ART_FACINGS, references: asset.references, defaultSeed: DEFAULT_SEEDS[asset.id],
    seed: value => groundArtSeed(value, asset.name),
    generate: seed => generateGroundArt(asset, seed),
    draw: (context, appearance) => drawGroundArt(context, asset, appearance),
  });
}
