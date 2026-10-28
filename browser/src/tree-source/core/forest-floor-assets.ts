import { type PixelAssetDefinition, type PixelBrush } from './ground-pixel-art';
import type { PixelPoint } from './pixel-geometry';
import { seededRandom } from './random';

// All contours are authored in the unscaled 64 × 56 frame. Tone zero is air,
// including the openings between scales and beneath exposed roots.
const leafPalettes = [
  { name: 'Copper maple', tones: ['', '#482d28', '#763c2a', '#ad542e', '#d77b36', '#f0b65b', '#a99049'] },
  { name: 'Ochre oak', tones: ['', '#49382a', '#75502d', '#a67a35', '#cba44e', '#e7cd7b', '#8e914e'] },
  { name: 'Wine and russet', tones: ['', '#3f292e', '#68343a', '#93423e', '#bd6650', '#dc9a6b', '#907746'] },
] as const;
const seedPalettes = [
  { name: 'Warm chestnut', tones: ['', '#382a25', '#584033', '#825838', '#ad7e4c', '#d2ad71', '#b49366'] },
  { name: 'Weathered pine', tones: ['', '#302e29', '#514a3c', '#756851', '#9c8b69', '#c5b68b', '#a79f7a'] },
  { name: 'Red woodland oak', tones: ['', '#3e2824', '#654032', '#925b3c', '#b98151', '#dfb97d', '#a19061'] },
] as const;
const stonePalettes = [
  { name: 'River slate', tones: ['', '#303d46', '#485661', '#687984', '#91a0a5', '#bdc8c4', '#87958b'] },
  { name: 'Warm sandstone', tones: ['', '#4b4038', '#6c5a48', '#95816a', '#b7a38a', '#d9cbb0', '#a9a18b'] },
  { name: 'Blue grey flint', tones: ['', '#333744', '#4b5064', '#737b90', '#9ba6b7', '#cbd2d5', '#939eaa'] },
] as const;
const rootPalettes = [
  { name: 'Old oak', tones: ['', '#352b25', '#594232', '#805b3d', '#ac8052', '#d0aa72', '#78754c'] },
  { name: 'Silver driftwood', tones: ['', '#363630', '#56564a', '#7b7966', '#a19c81', '#c7bfa1', '#808566'] },
  { name: 'Damp cedar', tones: ['', '#34272a', '#553b33', '#7e5140', '#a77151', '#c99b6d', '#77734c'] },
] as const;

function stipple(brush: PixelBrush, seed: number, from: number, to: number, count: number): void {
  const random = seededRandom(seed);
  const candidates: PixelPoint[] = [];
  brush.pixels.forEach((row, y) => row.forEach((tone, x) => {
    if (tone === from) candidates.push([x, y]);
  }));
  for (let i = 0; i < count && candidates.length; i++) {
    const [point] = candidates.splice(Math.floor(random() * candidates.length), 1);
    brush.put(point[0], point[1], to);
  }
}

function maple(brush: PixelBrush, ox = 0, oy = 0, scale = 1): void {
  const p = (points: readonly PixelPoint[], tone: number) =>
    brush.polygon(points.map(([x, y]) => [ox + x * scale, oy + y * scale]), tone);
  const l = (a: PixelPoint, b: PixelPoint, tone: number) =>
    brush.line([ox + a[0] * scale, oy + a[1] * scale], [ox + b[0] * scale, oy + b[1] * scale], tone);
  p([[31, 40], [20, 42], [22, 37], [12, 32], [18, 30], [15, 21], [24, 25],
    [25, 16], [29, 19], [34, 8], [37, 19], [42, 16], [41, 26], [52, 23],
    [48, 32], [53, 34], [41, 38], [43, 42], [34, 41]], 1);
  p([[31, 39], [22, 40], [25, 36], [16, 32], [21, 31], [18, 25], [26, 28],
    [27, 20], [30, 23], [34, 12], [35, 25], [39, 20], [38, 29], [48, 26],
    [45, 32], [49, 34], [38, 37], [40, 40], [34, 39]], 3);
  p([[32, 37], [26, 33], [21, 27], [28, 29], [29, 23], [32, 26], [34, 13], [34, 36]], 4);
  p([[35, 36], [40, 31], [47, 28], [44, 33], [46, 34], [37, 37]], 4);
  p([[24, 38], [28, 35], [33, 38], [27, 39]], 6);
  l([31, 47], [34, 16], 2);
  l([32, 45], [34, 35], 5);
  for (const [a, b] of [
    [[33, 36], [20, 28]], [[33, 33], [28, 23]], [[34, 35], [45, 29]],
    [[33, 38], [22, 38]], [[34, 38], [41, 39]],
  ] as const) l(a, b, 2);
  l([32, 35], [23, 30], 5);
  l([35, 34], [41, 31], 5);
}

export const LEAF_ASSET: PixelAssetDefinition = {
  id: 'leaves', name: 'Leaf', title: 'Fallen leaves',
  shapes: ['Single leaf', 'Curled leaf', 'Leaf pile'],
  paletteLabel: 'Autumn pigment', palettes: leafPalettes,
  intro: 'Hand-shaped autumn leaves with uneven lobes, branching veins and papery folds. Light catches the upper-left edges, not the ground.',
  references: [{
    title: 'Sugar maple — leaf morphology', url: 'https://en.wikipedia.org/wiki/Acer_saccharum',
    note: 'Five palmate lobes, smaller basal lobes, deep rounded notches and uneven yellow-to-red autumn colour inform original contours and vein fans.',
  }],
  paint(brush, appearance) {
    if (appearance.shape === 0) maple(brush);
    else if (appearance.shape === 1) {
      brush.polygon([[16, 40], [13, 35], [15, 28], [21, 22], [28, 20], [34, 14], [37, 19],
        [44, 18], [42, 24], [49, 27], [48, 34], [43, 40], [33, 44], [23, 43]], 1);
      brush.polygon([[16, 35], [18, 29], [24, 24], [30, 24], [34, 18], [35, 24],
        [41, 21], [39, 27], [46, 29], [43, 34], [33, 37], [23, 40], [18, 39]], 3);
      brush.polygon([[18, 32], [26, 25], [32, 25], [35, 21], [34, 30], [27, 35], [20, 37]], 4);
      brush.curve([18, 38], [29, 30], [44, 30], 2);
      brush.line([27, 34], [25, 27], 2);
      brush.line([34, 32], [37, 26], 2);
      // The lower lip folds back over a dark, continuous inner crease.
      brush.polygon([[16, 36], [22, 39], [31, 38], [41, 33], [47, 29], [48, 34],
        [42, 40], [33, 43], [23, 42], [18, 40]], 2);
      brush.polygon([[18, 37], [24, 40], [32, 39], [42, 35], [46, 31], [45, 36],
        [39, 40], [31, 42], [23, 41]], 6);
      brush.curve([20, 39], [32, 44], [44, 35], 5);
      brush.curve([27, 43], [26, 47], [20, 48], 2);
    } else {
      maple(brush, 0, 15, 0.68);
      brush.polygon([[32, 44], [24, 34], [29, 34], [28, 25], [34, 29], [41, 19],
        [43, 29], [50, 26], [48, 34], [55, 35], [48, 42], [39, 46]], 1);
      brush.polygon([[33, 42], [28, 36], [33, 36], [31, 29], [36, 33], [41, 23],
        [42, 33], [47, 30], [45, 36], [51, 36], [46, 40], [39, 44]], 6);
      brush.line([35, 46], [42, 27], 2);
      brush.line([39, 37], [34, 34], 4);
      brush.line([38, 40], [47, 36], 5);
      maple(brush, 9, 20, 0.59);
      brush.curve([30, 44], [36, 48], [44, 48], 2);
    }
    stipple(brush, appearance.seed ^ 0x1eaf, 3, 2, 8);
  },
};

function scalePlate(brush: PixelBrush, x: number, y: number, width: number, height: number, light: boolean): void {
  brush.polygon([[x, y - height], [x + width, y - 1], [x + width - 1, y + 2],
    [x, y + 4], [x - width, y + 1], [x - width, y - 1]], 1);
  brush.polygon([[x, y - height + 1], [x + width - 1, y - 1], [x, y + 2], [x - width + 1, y]], light ? 4 : 3);
  brush.line([x - width + 1, y], [x - 1, y + 2], light ? 5 : 4);
  brush.put(x, y, 2);
  brush.put(x - 1, y - 1, light ? 5 : 4);
}

export const SEED_ASSET: PixelAssetDefinition = {
  id: 'seeds', name: 'Seed', title: 'Pinecones & acorns',
  shapes: ['Closed cone', 'Open cone', 'Capped acorn'],
  paletteLabel: 'Seed shell', palettes: seedPalettes,
  intro: 'Overlapping woody scale ranks distinguish compact and opened cones; a pebbled cup sits above a polished, tapered acorn.',
  references: [
    { title: 'Conifer cone — overlapping scales', url: 'https://en.wikipedia.org/wiki/Conifer_cone',
      note: 'Imbricate scales surround a central axis; woody plates flex outward when dry. Diamond bosses and separated ranks are drawn anew.' },
    { title: 'English oak — acorn morphology', url: 'https://en.wikipedia.org/wiki/Quercus_robur',
      note: 'Ovoid acorns have a pointed tip, brown ripening colour and distinctive shallow cup; these inform the tapered nut and contrasting textured cap.' },
  ],
  paint(brush, appearance) {
    if (appearance.shape === 0) {
      brush.curve([33, 45], [37, 47], [40, 46], 1, 3);
      brush.polygon([[30, 10], [35, 13], [41, 23], [44, 34], [41, 43],
        [34, 47], [26, 45], [21, 39], [21, 29], [25, 18]], 1);
      brush.polygon([[30, 13], [34, 15], [39, 26], [41, 35], [37, 44],
        [28, 43], [24, 37], [24, 28]], 2);
      const ranks = [
        [[31, 16, 3]], [[28, 22, 4], [35, 23, 4]],
        [[25, 29, 4], [32, 29, 4], [39, 30, 3]],
        [[26, 36, 5], [35, 36, 5]], [[29, 42, 5], [37, 42, 4]],
      ];
      for (const rank of ranks) for (const [x, y, width] of rank) scalePlate(brush, x, y, width, 4, x < 34);
    } else if (appearance.shape === 1) {
      brush.curve([32, 43], [35, 47], [40, 47], 1, 3);
      brush.polygon([[31, 9], [35, 14], [37, 38], [33, 46], [28, 42], [27, 20]], 2);
      for (const [x, y, width, height] of [
        [31, 15, 4, 5], [25, 22, 7, 5], [38, 23, 7, 5], [31, 24, 5, 5],
        [20, 30, 9, 5], [43, 32, 9, 6], [31, 32, 7, 5],
        [22, 39, 9, 5], [42, 41, 8, 6], [32, 41, 7, 5],
      ]) scalePlate(brush, x, y, width, height, x < 34);
      brush.line([30, 11], [32, 14], 5);
    } else {
      brush.polygon([[22, 24], [40, 23], [45, 30], [43, 39], [38, 46],
        [33, 49], [27, 46], [22, 40], [19, 31]], 1);
      brush.polygon([[23, 27], [39, 26], [42, 31], [40, 40], [35, 46], [31, 46],
        [25, 40], [22, 33]], 3);
      brush.polygon([[24, 29], [31, 28], [32, 42], [34, 46], [29, 43], [25, 38]], 4);
      brush.curve([26, 31], [25, 36], [29, 40], 5, 2);
      brush.curve([40, 32], [40, 40], [35, 44], 2);
      brush.curve([30, 19], [25, 14], [29, 10], 1, 3);
      brush.line([27, 14], [28, 11], 4);
      brush.ellipse(31, 24, 14, 9, 1);
      brush.ellipse(31, 23, 12, 7, 2);
      brush.ellipse(29, 21, 10, 4, 3);
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 5; col++) {
          const x = 20 + col * 5 + (row % 2) * 2;
          const y = 20 + row * 3;
          if (brush.pixels[y][x] < 2) continue;
          brush.line([x, y], [x + 2, y + 1], col < 3 ? 5 : 4);
          brush.put(x + 1, y + 2, 1);
        }
      }
      brush.curve([20, 28], [31, 35], [43, 27], 1);
      brush.curve([21, 27], [31, 32], [41, 28], 4);
    }
    stipple(brush, appearance.seed ^ 0xc0ae, 3, 4, 5);
  },
};

function pebble(brush: PixelBrush, x: number, y: number, sx: number, sy: number, vein = false): void {
  const p = (points: readonly PixelPoint[], tone: number) =>
    brush.polygon(points.map(([px, py]) => [x + px * sx, y + py * sy]), tone);
  p([[-1, -0.25], [-0.84, -0.7], [-0.4, -0.95], [0.25, -1], [0.76, -0.65],
    [1, -0.15], [0.92, 0.5], [0.48, 0.9], [-0.22, 1], [-0.8, 0.7], [-1, 0.2]], 1);
  p([[-0.88, -0.23], [-0.73, -0.61], [-0.36, -0.83], [0.22, -0.86], [0.67, -0.55],
    [0.88, -0.1], [0.78, 0.47], [0.4, 0.73], [-0.2, 0.8], [-0.72, 0.57]], 3);
  p([[-0.86, -0.22], [-0.7, -0.56], [-0.32, -0.8], [0.2, -0.82],
    [0.51, -0.49], [0.23, -0.12], [-0.5, 0.1]], 4);
  p([[0.52, -0.48], [0.87, -0.06], [0.77, 0.46], [0.37, 0.73], [-0.18, 0.79],
    [-0.68, 0.57], [-0.13, 0.49], [0.48, 0.23]], 2);
  p([[-0.69, -0.48], [-0.32, -0.76], [0.13, -0.78], [-0.01, -0.6], [-0.4, -0.54]], 5);
  if (vein) {
    brush.curve([x - sx * 0.45, y - sy * 0.63], [x + sx * 0.1, y], [x + sx * 0.58, y + sy * 0.45], 6);
  }
}

export const PEBBLE_ASSET: PixelAssetDefinition = {
  id: 'pebbles', name: 'Pebble', title: 'Small stones',
  shapes: ['Single pebble', 'Loose cluster', 'Skipping stone'],
  paletteLabel: 'Mineral colour', palettes: stonePalettes,
  intro: 'Small water-worn stones with softened corners, broad quiet highlights and occasional mineral seams, rather than jagged boulder faces.',
  references: [{
    title: 'Pebble — rounded river stones', url: 'https://en.wikipedia.org/wiki/Pebble',
    note: 'Smooth surfaces, varied colours and quartz/mineral streaks inform low, rounded silhouettes and restrained highlights.',
  }],
  paint(brush, appearance) {
    if (appearance.shape === 0) pebble(brush, 32, 39, 13, 9, true);
    else if (appearance.shape === 1) {
      pebble(brush, 22, 34, 9, 6);
      pebble(brush, 43, 39, 10, 7, true);
      pebble(brush, 27, 42, 11, 6);
      pebble(brush, 12, 44, 4, 3);
    } else pebble(brush, 32, 41, 19, 7, true);
    stipple(brush, appearance.seed ^ 0x570ae, 3, 6, 3);
  },
};

function rootStrand(brush: PixelBrush, a: PixelPoint, c: PixelPoint, b: PixelPoint, width: number): void {
  brush.curve(a, c, b, 1, width);
  brush.curve([a[0], a[1] - 1], [c[0], c[1] - 1], [b[0], b[1] - 1], 3, Math.max(1, width - 3));
  brush.curve([a[0], a[1] - 2], [c[0], c[1] - 2], [b[0], b[1] - 2], 4, Math.max(1, width - 5));
}

export const ROOT_ASSET: PixelAssetDefinition = {
  id: 'roots', name: 'Root', title: 'Roots',
  shapes: ['Exposed arch', 'Branching root', 'Twisted root'],
  paletteLabel: 'Weathered wood', palettes: rootPalettes,
  intro: 'Exposed roots lift into open arches, divide into tapering fingers and wind across one another. Grain follows each bend.',
  references: [
    { title: 'Roots — primary and secondary growth', url: 'https://en.wikipedia.org/wiki/Tree_root',
      note: 'Primary and secondary branching, anchorage, and above-ground roots inform tapering branch junctions.' },
    { title: 'Buttress roots — surface structure', url: 'https://en.wikipedia.org/wiki/Buttress_root',
      note: 'Surface-spreading roots may intertwine into a mesh; original small exposed-root silhouettes adapt this structural idea, not the scale of tropical buttresses.' },
  ],
  paint(brush, appearance) {
    if (appearance.shape === 0) {
      brush.polygon([[7, 48], [12, 43], [16, 31], [22, 23], [29, 19], [35, 19],
        [42, 23], [47, 34], [51, 43], [57, 48], [46, 48], [41, 40], [38, 32],
        [34, 29], [28, 29], [24, 34], [21, 43], [18, 48]], 1);
      brush.polygon([[11, 46], [16, 39], [19, 31], [25, 24], [31, 22], [36, 22],
        [41, 26], [44, 35], [48, 45], [52, 47], [47, 46], [43, 39], [40, 31],
        [35, 26], [28, 26], [22, 32], [18, 44]], 3);
      brush.curve([16, 40], [19, 21], [32, 22], 4, 3);
      brush.curve([32, 22], [42, 21], [45, 38], 4, 2);
      brush.curve([17, 39], [21, 24], [31, 24], 5);
      brush.curve([24, 28], [19, 34], [17, 46], 2);
      brush.curve([34, 25], [40, 27], [43, 42], 2);
      brush.line([13, 44], [10, 47], 4);
      brush.line([48, 44], [53, 47], 4);
      brush.ellipse(36, 25, 2, 2, 2);
      brush.put(35, 24, 5);
    } else if (appearance.shape === 1) {
      brush.polygon([[14, 20], [22, 17], [29, 22], [31, 30], [37, 35], [47, 36],
        [56, 42], [51, 42], [44, 40], [37, 41], [45, 48], [37, 48], [29, 41],
        [22, 42], [13, 48], [7, 48], [17, 39], [22, 35], [22, 29], [18, 25]], 1);
      brush.polygon([[17, 21], [23, 20], [26, 24], [27, 32], [34, 38], [44, 38],
        [51, 40], [39, 39], [32, 39], [40, 47], [37, 46], [28, 39], [22, 39],
        [12, 46], [22, 36], [25, 32], [23, 26]], 3);
      brush.curve([19, 21], [29, 25], [25, 35], 4, 3);
      brush.curve([25, 35], [21, 38], [12, 45], 4);
      brush.curve([27, 33], [33, 40], [47, 38], 4);
      brush.curve([25, 37], [30, 37], [39, 46], 4);
      brush.curve([21, 23], [27, 26], [25, 30], 5);
      brush.curve([24, 31], [22, 35], [18, 38], 2);
      brush.curve([29, 37], [32, 39], [35, 43], 2);
      brush.line([46, 39], [53, 41], 2);
      brush.line([20, 20], [23, 22], 2);
    } else {
      rootStrand(brush, [10, 44], [24, 17], [51, 42], 8);
      rootStrand(brush, [12, 31], [34, 59], [51, 29], 7);
      // Repaint only the crossing: the upper strand changes at each overlap.
      rootStrand(brush, [28, 32], [34, 32], [39, 35], 8);
      brush.curve([13, 41], [22, 25], [30, 30], 5);
      brush.curve([15, 32], [25, 43], [33, 42], 5);
      brush.curve([36, 43], [45, 40], [50, 30], 2);
      brush.curve([31, 33], [35, 32], [39, 35], 5);
      brush.curve([12, 44], [9, 46], [6, 47], 1, 2);
      brush.curve([49, 41], [54, 45], [57, 47], 1, 2);
      brush.curve([12, 31], [10, 27], [14, 25], 1, 2);
      brush.line([50, 30], [54, 27], 1, 2);
    }
    stipple(brush, appearance.seed ^ 0x7007, 3, 2, 7);
  },
};

export const FOREST_FLOOR_ASSETS: readonly PixelAssetDefinition[] = [
  LEAF_ASSET, SEED_ASSET, PEBBLE_ASSET, ROOT_ASSET,
];
