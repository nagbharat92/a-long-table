import { drawGroundArt, GROUND_ART_FACINGS, GROUND_ART_SIZES, groundArtSeed } from './core/ground-pixel-art';
import { drawTreeLayers, generateTree, LAYER_TREES, TREE_ASSET, TREE_BRANCHES, TREE_GROWTH, TREE_LAYER_SIZE, TREE_SIZE, type TreeAppearance } from './core/tree-assets';
import { DEFAULT_TREE_WIND, prepareTreeMotion, TREE_MOTION_MODES, TREE_WIND_PRESETS, type TreeWind } from './core/tree-motion';
import { mountGroundAssetExplorer } from './ground-asset-explorer';

export function mountTreeExplorer(root: HTMLElement, parameters: URLSearchParams, signal: AbortSignal): void {
  const cache = new Map<string, ReturnType<typeof prepareTreeMotion>>();
  function drawMotion(context: CanvasRenderingContext2D, appearance: TreeAppearance, seconds: number, wind: TreeWind, offsetX = 0, offsetY = 0): void {
    const key = JSON.stringify(appearance);
    let frame = cache.get(key);
    if (!frame) {
      frame = prepareTreeMotion(appearance);
      if (cache.size >= 24) cache.delete(cache.keys().next().value!);
      cache.set(key, frame);
    }
    const pixels = frame(seconds, wind);
    const tones = TREE_ASSET.palettes[appearance.palette].tones;
    pixels.forEach((row, y) => row.forEach((tone, x) => {
      if (!tone) return;
      context.fillStyle = tones[tone];
      context.fillRect(x + offsetX, y + offsetY, 1, 1);
    }));
  }
  signal.addEventListener('abort', () => cache.clear(), { once: true });
  mountGroundAssetExplorer(root, parameters, signal, {
    tab: 'trees', name: TREE_ASSET.name, title: TREE_ASSET.title,
    paletteLabel: TREE_ASSET.paletteLabel, intro: TREE_ASSET.intro,
    dimensions: TREE_SIZE, shapes: TREE_ASSET.shapes, palettes: TREE_ASSET.palettes,
    sizes: GROUND_ART_SIZES, facings: GROUND_ART_FACINGS,
    defaultSeed: 9,
    seed: value => groundArtSeed(value, 'Tree'),
    generate: generateTree,
    draw: (context, appearance) => drawGroundArt(context, TREE_ASSET, appearance),
    companion: { label: 'Layered color study', dimensions: TREE_LAYER_SIZE, draw: drawTreeLayers },
    motion: {
      modes: TREE_MOTION_MODES, presets: TREE_WIND_PRESETS, defaults: DEFAULT_TREE_WIND,
      draw(context, appearance, seconds, wind) {
        context.clearRect(0, 0, TREE_SIZE.width, TREE_SIZE.height);
        drawMotion(context, appearance, seconds, wind);
      },
      drawCompanion(context, appearance, seconds, wind) {
        context.clearRect(0, 0, TREE_LAYER_SIZE.width, TREE_LAYER_SIZE.height);
        LAYER_TREES.forEach((layer, index) => {
          drawMotion(context, { ...appearance, ...layer, seed: (appearance.seed + index * 73) >>> 0 }, seconds, wind, layer.x, layer.y);
        });
        drawMotion(context, appearance, seconds, wind, 76, 5);
      },
    },
    extraChoices: [{
      title: 'Growth', names: TREE_GROWTH,
      selected: appearance => appearance.growth,
      set: (appearance, index) => { appearance.growth = index; },
    }, {
      title: 'Branches', names: TREE_BRANCHES,
      selected: appearance => appearance.branches ?? 0,
      set: (appearance, index) => { appearance.branches = index; },
    }],
  });
}
