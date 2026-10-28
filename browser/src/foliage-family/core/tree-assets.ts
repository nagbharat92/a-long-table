import { generateGroundArt, groundArtPixels, PixelBrush, type GroundArtAppearance, type PixelAssetDefinition } from './ground-pixel-art';
import { polygonContains, type PixelPoint } from './pixel-geometry';
import { seededRandom } from './random';
import { treeBranches, type TreeBranch } from './tree-branches';

export const TREE_SIZE = { width: 80, height: 176 } as const;
export const TREE_BASELINE = 169;
export const TREE_LAYER_SIZE = { width: 232, height: 176 } as const;
export const TREE_GROWTH = ['Full', 'Patchy', 'Sparse'] as const;
export const TREE_BRANCHES = ['Irregular', 'Uplifted', 'Drooping', 'Weathered'] as const;

export interface TreeAppearance extends GroundArtAppearance {
  growth: number;
  branches?: number;
}

type Crown = readonly [x: number, y: number, radiusX: number, radiusY: number];

const CROWNS: readonly (readonly Crown[])[] = [
  [[39, 18, 6, 11], [36, 34, 11, 16], [42, 53, 16, 22], [35, 73, 19, 23],
    [44, 91, 18, 22], [34, 111, 15, 15], [46, 133, 9, 6]],
  [[35, 22, 7, 12], [41, 42, 12, 17], [30, 63, 14, 16], [43, 82, 18, 22],
    [32, 103, 15, 18], [44, 124, 11, 8], [31, 142, 6, 4]],
  [[43, 16, 4, 9], [42, 34, 7, 15], [44, 54, 9, 20], [40, 78, 11, 24],
    [43, 102, 10, 19], [38, 125, 7, 9], [47, 143, 5, 3]],
];

const LOBE_OUTLINE: readonly PixelPoint[] = [
  [-1, 0.05], [-0.93, -0.23], [-0.78, -0.27], [-0.8, -0.52],
  [-0.59, -0.7], [-0.42, -0.9], [-0.12, -0.86], [0.07, -1],
  [0.32, -0.88], [0.55, -0.88], [0.65, -0.63], [0.85, -0.61],
  [0.93, -0.32], [0.88, -0.19], [1, 0.02], [0.95, 0.16],
  [0.84, 0.39], [0.61, 0.43], [0.65, 0.68], [0.35, 0.79],
  [0.13, 0.69], [-0.04, 0.94], [-0.27, 0.86], [-0.33, 0.61],
  [-0.6, 0.76], [-0.77, 0.56], [-0.71, 0.32], [-0.98, 0.3],
];

function crown(brush: PixelBrush, [cx, cy, rx, ry]: Crown, random: () => number): void {
  const outline: PixelPoint[] = LOBE_OUTLINE.map(([x, y]) => {
    const radius = 0.92 + random() * 0.16;
    return [Math.round(cx + x * rx * radius), Math.round(cy + y * ry * radius)];
  });
  // One broad lower shadow per mass, with no leaf texture or scattered highlights.
  for (let y = Math.floor(cy - ry - 2); y <= cy + ry + 2; y++) {
    for (let x = Math.floor(cx - rx - 2); x <= cx + rx + 2; x++) {
      if (!polygonContains(outline, x + 0.5, y + 0.5)) continue;
      const shadeEdge = cy + ry * 0.45 - (x - cx) * 0.22 + Math.sin((x - cx) / rx * 2.8) * ry * 0.12;
      brush.put(x, y, y > shadeEdge ? 3 : 4);
    }
  }
}

function branch(brush: PixelBrush, [from, control, to]: TreeBranch['points'], thickness: number): void {
  const left: PixelPoint = [(from[0] + control[0]) / 2, (from[1] + control[1]) / 2];
  const right: PixelPoint = [(control[0] + to[0]) / 2, (control[1] + to[1]) / 2];
  const middle: PixelPoint = [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2];
  brush.curve(from, left, middle, 1, thickness);
  brush.curve(middle, right, to, 1);
}

export const TREE_ASSET: PixelAssetDefinition<TreeAppearance> = {
  id: 'trees', name: 'Tree', title: 'Trees',
  dimensions: TREE_SIZE, baseline: TREE_BASELINE,
  shapes: ['Cloud crown', 'Open crown', 'Slender spire'],
  paletteLabel: 'Forest palette',
  palettes: [
    { name: 'Mist sage', tones: ['', '#626e62', '#89917a', '#739486', '#9bb49a'] },
    { name: 'Moss green', tones: ['', '#635b4b', '#92816a', '#4b705b', '#719363'] },
    { name: 'Deep fir', tones: ['', '#434e49', '#746e58', '#294a43', '#416650'] },
    { name: 'Blue spruce', tones: ['', '#414f59', '#737e7b', '#304d59', '#4f7377'] },
  ],
  intro: 'Compare foliage movement, root-anchored sway and both together. Heavy trees lean as one structure with spring-like resistance and damping. Branch styles vary the exposed wood; growth controls the foliage gaps.',
  references: [],
  paint: paintTree,
};

function paintTree(brush: PixelBrush, appearance: TreeAppearance, foliageBrush: (mass: Crown) => PixelBrush = () => brush): void {
    if (!Number.isInteger(appearance.growth) || appearance.growth < 0 || appearance.growth >= TREE_GROWTH.length) {
      throw new RangeError('Invalid tree growth parameter.');
    }
    const branches = appearance.branches === undefined ? 0 : appearance.branches;
    if (!Number.isInteger(branches) || branches < 0 || branches >= TREE_BRANCHES.length) {
      throw new RangeError('Invalid tree branches parameter.');
    }
    const random = seededRandom(appearance.seed ^ 0x71ee);
    const lean = appearance.shape === 1 ? -2 : appearance.shape === 2 ? 2 : 0;
    brush.polygon([[39 + lean, 9], [40 + lean, 9], [42, 153], [43, 166], [45, 169],
      [35, 169], [38, 165], [38, 152]], 1);
    brush.polygon([[40 + lean, 28], [41 + lean, 28], [40, 154], [42, 167], [39, 167]], 2);
    const crowns: Crown[] = CROWNS[appearance.shape].flatMap(([x, y, rx, ry], index) => {
      if (appearance.growth === 2 && (index === 1 || index === 3)) return [];
      const sparse = appearance.growth === 2;
      const patchy = appearance.growth === 1;
      const offset = [1, -3, 5, -1, 3, -4, 2][index];
      const patchWidth = [0.8, 0.6, 0.92, 1, 0.65, 0.85, 0.7][index];
      const patchHeight = [0.8, 0.45, 0.5, 0.62, 0.48, 0.43, 0.65][index];
      const shiftY = [0, -3, 2, 0, 4, -2, 1][index];
      return [[x + (patchy ? offset : sparse ? offset * 1.4 : 0), y + (patchy || sparse ? shiftY : 0),
        rx * (sparse ? 0.38 + index % 3 * 0.09 : patchy ? patchWidth : 1),
        ry * (sparse ? 0.26 + index % 3 * 0.04 : patchy ? patchHeight : 1)]];
    });
    for (const { points, twigs, thickness } of treeBranches(appearance.seed, appearance.shape, branches)) {
      branch(brush, points, thickness);
      for (const twig of twigs) branch(brush, twig, 1);
    }
    for (const [x, y] of crowns) {
      brush.line([40, y + 5], [x, y + 1], 1, 2);
      brush.line([40, y + 4], [x, y + 1], 2);
    }
    for (const mass of crowns) crown(foliageBrush(mass), mass, random);
}

export interface TreePixelLayer {
  pixels: number[][];
  anchorX: number;
  anchorY: number;
}

export function treePixelLayers(appearance: TreeAppearance): TreePixelLayer[] {
  const foliage: { brush: PixelBrush; mass: Crown }[] = [];
  const bark = groundArtPixels({
    ...TREE_ASSET,
    paint(brush, recipe) {
      paintTree(brush, recipe, mass => {
        const leaf = new PixelBrush(TREE_SIZE);
        foliage.push({ brush: leaf, mass });
        return leaf;
      });
    },
  }, appearance);
  const scale = [0.6, 0.8, 1][appearance.size];
  const anchorX = TREE_SIZE.width / 2 + (appearance.facing ? -0.5 : 0.5) * scale;
  return [{ pixels: bark, anchorX, anchorY: TREE_BASELINE }, ...foliage.map(({ brush, mass }) => ({
    pixels: groundArtPixels({
      ...TREE_ASSET,
      paint(target) {
        brush.pixels.forEach((row, y) => row.forEach((tone, x) => {
          if (tone) target.put(x, y, tone);
        }));
      },
    }, appearance),
    anchorX,
    anchorY: TREE_BASELINE + (mass[1] + 4 - TREE_BASELINE) * scale,
  }))];
}

export function generateTree(seed: number): TreeAppearance {
  const random = seededRandom(seed ^ 0xc20a);
  return { ...generateGroundArt(TREE_ASSET, seed), growth: Math.floor(random() * TREE_GROWTH.length),
    branches: Math.floor(random() * TREE_BRANCHES.length) };
}

interface LayerTree {
  readonly x: number;
  readonly y: number;
  readonly shape: number;
  readonly size: number;
  readonly palette: number;
  readonly facing: number;
  readonly growth: number;
}

export const LAYER_TREES: readonly LayerTree[] = [
  { x: 12, y: -3, shape: 1, size: 1, palette: 0, facing: 0, growth: 1 },
  { x: 62, y: -7, shape: 2, size: 1, palette: 0, facing: 1, growth: 2 },
  { x: 140, y: -4, shape: 0, size: 1, palette: 0, facing: 0, growth: 0 },
  { x: 24, y: -1, shape: 0, size: 2, palette: 1, facing: 1, growth: 1 },
  { x: 124, y: 1, shape: 1, size: 2, palette: 1, facing: 0, growth: 2 },
  { x: -9, y: 3, shape: 2, size: 2, palette: 3, facing: 0, growth: 0 },
  { x: 160, y: 4, shape: 2, size: 2, palette: 2, facing: 1, growth: 1 },
];

export function treeLayerPixels(appearance: TreeAppearance): string[][] {
  const pixels = Array.from({ length: TREE_LAYER_SIZE.height }, () => Array<string>(TREE_LAYER_SIZE.width).fill(''));
  const layers: LayerTree[] = [...LAYER_TREES, { x: 76, y: 5, ...appearance }];
  for (const [index, layer] of layers.entries()) {
    const seed = index === layers.length - 1 ? appearance.seed : (appearance.seed + index * 73) >>> 0;
    const recipe = { ...appearance, ...layer, seed };
    const sprite = groundArtPixels(TREE_ASSET, recipe);
    const tones = TREE_ASSET.palettes[layer.palette].tones;
    sprite.forEach((row, y) => row.forEach((tone, x) => {
      const dx = x + layer.x;
      const dy = y + layer.y;
      if (tone && dx >= 0 && dx < TREE_LAYER_SIZE.width && dy >= 0 && dy < TREE_LAYER_SIZE.height) pixels[dy][dx] = tones[tone];
    }));
  }
  return pixels;
}

export function drawTreeLayers(context: CanvasRenderingContext2D, appearance: TreeAppearance): void {
  context.clearRect(0, 0, TREE_LAYER_SIZE.width, TREE_LAYER_SIZE.height);
  treeLayerPixels(appearance).forEach((row, y) => row.forEach((color, x) => {
    if (!color) return;
    context.fillStyle = color;
    context.fillRect(x, y, 1, 1);
  }));
}
