import { type PixelAssetDefinition, type PixelBrush } from './ground-pixel-art';
import type { PixelPoint } from './pixel-geometry';
import { seededRandom } from './random';

// Shared material slots: outline, four body tones, three accent tones,
// three ivory tones, three leaf tones, stem, and a quiet surface fleck.
const producePalettes = [
  { name: 'Orchard & hedgerow', tones: ['', '#302d29', '#743b40', '#ac4850', '#d66963', '#ef9d80', '#352f4b', '#565276', '#9691b1', '#928747', '#b9b66b', '#e3d79a', '#25483c', '#497453', '#8ca66b', '#776044', '#c4ab7f'] },
  { name: 'Russet & sage', tones: ['', '#332d2b', '#794b37', '#ad6548', '#ce8c60', '#e8b783', '#43384d', '#74556b', '#b5909b', '#8d743c', '#b39b55', '#d6c589', '#334b3f', '#657e59', '#a8b77c', '#70513a', '#bea078'] },
  { name: 'Crimson & blue bloom', tones: ['', '#292c33', '#703344', '#a73d57', '#d35e71', '#ef98a0', '#28384b', '#47617d', '#8da7b7', '#778345', '#a5b15e', '#d0d795', '#244943', '#487d68', '#8db799', '#725d48', '#bdba8c'] },
] as const;

const vegetablePalettes = [
  { name: 'Garden green & terracotta', tones: ['', '#29362d', '#803c49', '#bc4755', '#e77779', '#f4b6a2', '#a4512e', '#db7939', '#f4b35e', '#a99b73', '#ddd2ac', '#f3e7c7', '#244b38', '#4b8051', '#93b56d', '#c2cf8a', '#bc9b71'] },
  { name: 'Blue leaf & coral', tones: ['', '#283b37', '#873f53', '#c64e69', '#e4868d', '#f4b9b7', '#a94b35', '#df794b', '#f1b178', '#aaa88c', '#d9dbc1', '#f1efdb', '#28584e', '#548b76', '#98bda0', '#c5d6ac', '#b3ad82'] },
  { name: 'Olive leaf & ochre', tones: ['', '#373a29', '#813d40', '#ad4a4b', '#d87c6c', '#edb39c', '#a1602e', '#cf8c3d', '#efc271', '#a99b74', '#dbd0aa', '#f4e9cd', '#475833', '#78894b', '#b5c276', '#d9d89a', '#b5a773'] },
] as const;

function foldedLeaf(b: PixelBrush, base: PixelPoint, tip: PixelPoint, width: number, bend = 0): void {
  const dx = tip[0] - base[0], dy = tip[1] - base[1];
  const length = Math.hypot(dx, dy), nx = -dy / length, ny = dx / length;
  const p = (t: number, side: number): PixelPoint => [
    base[0] + dx * t + nx * (side + bend * Math.sin(t * Math.PI)),
    base[1] + dy * t + ny * (side + bend * Math.sin(t * Math.PI)),
  ];
  b.polygon([base, p(.23, -width * .5), p(.46, -width), p(.62, -width * .8),
    p(.77, -width * .85), tip, p(.78, width * .7), p(.59, width),
    p(.41, width * .78), p(.21, width * .48)], 12);
  b.polygon([p(.08, 0), p(.3, -width * .38), p(.48, -width * .72),
    p(.66, -width * .5), tip, p(.68, width * .48), p(.42, width * .48)], 13);
  b.polygon([p(.12, 0), p(.48, 0), p(.72, width * .28), tip,
    p(.55, width * .7), p(.32, width * .35)], 14);
  b.curve(base, p(.57, bend * .2), tip, 15);
  for (const t of [.34, .52, .69]) {
    b.line(p(t - .09, 0), p(t, -width * .6), 14);
    b.line(p(t - .09, .3), p(t + .04, width * .55), 13);
  }
}

function surfaceFlecks(b: PixelBrush, random: () => number, tones: readonly number[], count: number): void {
  for (let i = 0; i < count; i++) {
    const x = 10 + Math.floor(random() * 43), y = 16 + Math.floor(random() * 30);
    const tone = b.pixels[y][x];
    if (tones.includes(tone) && b.pixels[y][x - 1] && b.pixels[y][x + 1]
      && b.pixels[y - 1][x] && b.pixels[y + 1][x]) b.put(x, y, 16);
  }
}

function leafyGreens(b: PixelBrush, random: () => number): void {
  b.polygon([[27, 46], [29, 38], [39, 39], [37, 47], [32, 49]], 12);
  foldedLeaf(b, [31, 44], [13, 19], 7, -2);
  foldedLeaf(b, [32, 43], [27, 9], 7, 2);
  foldedLeaf(b, [34, 43], [47, 13], 8, -2);
  foldedLeaf(b, [34, 45], [55, 27], 7, 2);
  foldedLeaf(b, [30, 45], [9, 32], 8, -2);
  foldedLeaf(b, [33, 45], [34, 17], 8, -2);
  foldedLeaf(b, [31, 46], [20, 29], 7, 2);
  foldedLeaf(b, [33, 46], [45, 31], 7, -2);
  b.curve([18, 40], [20, 44], [26, 44], 1);
  b.curve([38, 42], [42, 42], [46, 38], 1);
  b.curve([23, 41], [28, 48], [37, 46], 14, 2);
  b.line([30, 47], [34, 48], 15);
  b.line([31, 47], [33, 47], 10);
  surfaceFlecks(b, random, [13], 9);
}

function carrot(b: PixelBrush, random: () => number): void {
  b.polygon([[28, 27], [34, 24], [39, 28], [38, 34], [34, 40], [29, 45],
    [24, 48], [25, 43], [27, 36]], 6);
  b.polygon([[29, 28], [34, 26], [37, 29], [35, 36], [30, 43], [25, 47], [29, 36]], 7);
  b.polygon([[30, 28], [33, 27], [34, 30], [31, 37], [27, 43], [29, 34]], 8);
  b.curve([25, 45], [22, 47], [20, 48], 9);
  b.line([33, 31], [36, 31], 6);
  b.line([28, 35], [30, 36], 6);
  b.line([31, 40], [33, 39], 6);
  b.line([29, 30], [30, 29], 11);
  for (const [tx, ty] of [[15, 15], [25, 8], [35, 8], [46, 12], [52, 23], [17, 26]]) {
    const root: PixelPoint = [33, 28], tip: PixelPoint = [tx, ty];
    b.curve(root, [(tx + 33) / 2, ty + 2], tip, 12, 2);
    b.line(root, tip, 14);
    for (let j = 1; j <= 4; j++) {
      const t = j / 5, x = 33 + (tx - 33) * t, y = 28 + (ty - 28) * t;
      const spread = 4 - t * 2 + random();
      b.line([x, y], [x - spread, y - 3], 13);
      b.line([x, y], [x + spread, y - 2], 13);
      b.line([x - spread, y - 3], [x - spread - 1, y - 5], 14);
      b.line([x + spread, y - 2], [x + spread + 1, y - 4], 14);
      b.line([x - spread + 1, y - 2], [x - spread - 2, y - 2], 13);
      b.line([x + spread - 1, y - 2], [x + spread + 2, y - 1], 14);
    }
  }
  b.line([32, 29], [34, 25], 15, 2);
}

function radish(b: PixelBrush, random: () => number): void {
  foldedLeaf(b, [32, 30], [15, 15], 5, -2);
  foldedLeaf(b, [32, 30], [28, 8], 6, 1);
  foldedLeaf(b, [33, 30], [46, 12], 6, -2);
  foldedLeaf(b, [34, 30], [51, 24], 5, 1);
  b.polygon([[29, 27], [36, 27], [42, 31], [43, 36], [40, 41], [34, 44],
    [29, 43], [23, 39], [22, 34], [24, 30]], 2);
  b.polygon([[29, 28], [36, 28], [40, 31], [41, 36], [37, 41], [30, 41], [24, 37], [24, 32]], 3);
  b.polygon([[27, 30], [33, 29], [36, 31], [33, 34], [27, 36], [25, 34]], 4);
  b.line([27, 31], [30, 30], 5, 2);
  b.polygon([[23, 37], [28, 39], [32, 38], [35, 40], [41, 37], [40, 41],
    [34, 44], [29, 43], [25, 41]], 9);
  b.polygon([[24, 38], [29, 40], [33, 39], [36, 41], [39, 40], [34, 43], [29, 42]], 10);
  b.line([27, 40], [31, 42], 11);
  b.curve([33, 43], [32, 47], [37, 47], 10);
  b.curve([37, 47], [41, 46], [40, 48], 11);
  b.line([31, 28], [29, 24], 14, 2);
  b.line([34, 28], [36, 23], 15);
  surfaceFlecks(b, random, [3, 4], 8);
}

export const VEGETABLE_ASSET: PixelAssetDefinition = {
  id: 'vegetables', name: 'Vegetable', title: 'Wild vegetables',
  shapes: ['Leafy greens', 'Carrot tops', 'Radish'], paletteLabel: 'Leaf & root',
  palettes: vegetablePalettes,
  intro: 'Folded greens, a tapered carrot and a blushing radish: original pixel studies of leaves and roots, not identification guides.',
  references: [
    { title: 'Lettuce — head photographs', url: 'https://en.wikipedia.org/wiki/Lettuce', note: 'Overlapping cupped leaves, irregular ruffled rims and pale branching midribs inform the layered greens.' },
    { title: 'Carrot — root and foliage photographs', url: 'https://en.wikipedia.org/wiki/Carrot', note: 'Long tapering orange roots carry short transverse marks; the tops split into fine feathery leaflets.' },
    { title: 'Radish — harvested roots photograph', url: 'https://en.wikipedia.org/wiki/Radish', note: 'Rounded red-to-white shoulders narrow into fine curling taproots beneath a stalked leafy crown.' },
  ],
  paint(b, appearance) {
    const random = seededRandom(appearance.seed ^ 0x564547);
    [leafyGreens, carrot, radish][appearance.shape](b, random);
  },
};

function apple(b: PixelBrush, random: () => number): void {
  b.polygon([[31, 22], [25, 19], [19, 20], [15, 24], [13, 30], [14, 37],
    [18, 44], [24, 48], [30, 47], [34, 48], [41, 46], [47, 39],
    [49, 31], [47, 25], [43, 21], [37, 20]], 1);
  b.polygon([[31, 24], [25, 21], [19, 22], [16, 26], [15, 32], [17, 39],
    [21, 44], [26, 47], [31, 45], [35, 47], [41, 44], [46, 37],
    [47, 30], [44, 24], [38, 22]], 2);
  b.polygon([[30, 25], [24, 22], [19, 24], [17, 30], [18, 37], [22, 42],
    [29, 45], [35, 44], [41, 40], [44, 32], [42, 25], [37, 23]], 3);
  b.polygon([[23, 23], [19, 27], [19, 33], [22, 38], [27, 39], [30, 34],
    [28, 28], [32, 26]], 4);
  b.curve([20, 30], [19, 25], [24, 24], 5, 2);
  b.curve([38, 26], [43, 30], [40, 36], 4);
  b.curve([27, 24], [32, 28], [37, 23], 2);
  b.curve([32, 24], [30, 17], [34, 13], 15, 2);
  b.line([32, 19], [34, 14], 16);
  foldedLeaf(b, [33, 19], [45, 13], 3, -1);
  b.line([28, 45], [31, 46], 1);
  surfaceFlecks(b, random, [3, 4], 22);
}

function pear(b: PixelBrush, random: () => number): void {
  b.polygon([[30, 17], [35, 17], [38, 22], [38, 27], [42, 32], [46, 38],
    [45, 43], [41, 47], [33, 49], [24, 47], [19, 43], [18, 37], [21, 31],
    [26, 27], [28, 23]], 1);
  b.polygon([[31, 18], [34, 19], [36, 23], [36, 28], [40, 33], [44, 38],
    [43, 43], [39, 46], [32, 47], [25, 45], [21, 41], [20, 37],
    [23, 32], [28, 28], [30, 23]], 9);
  b.polygon([[31, 19], [33, 20], [34, 28], [38, 33], [40, 39], [38, 44],
    [31, 46], [25, 43], [22, 39], [24, 33], [29, 29]], 10);
  b.polygon([[31, 22], [32, 27], [30, 32], [27, 35], [26, 40], [24, 38],
    [25, 34], [29, 29]], 11);
  b.curve([31, 18], [29, 11], [34, 9], 15, 2);
  b.line([31, 14], [33, 10], 16);
  foldedLeaf(b, [31, 15], [20, 13], 3, 0);
  b.curve([35, 46], [39, 45], [40, 43], 9);
  b.line([31, 47], [33, 47], 15);
  surfaceFlecks(b, random, [9, 10, 11], 65);
}

function berries(b: PixelBrush, random: () => number): void {
  b.curve([34, 17], [40, 29], [31, 43], 15, 2);
  foldedLeaf(b, [35, 20], [19, 13], 5, -1);
  foldedLeaf(b, [35, 20], [48, 15], 4, 1);
  const centers = [[30, 23], [40, 26], [23, 31], [34, 32], [45, 34], [27, 40], [38, 41], [33, 45]];
  for (const [cx, cy] of centers) {
    const r = cy === 45 ? 3.8 : 5 + random() * .5;
    b.line([35, cy - 6], [cx, cy - 2], 15);
    b.ellipse(cx, cy, r + 1, r + .5, 1);
    b.ellipse(cx, cy - .5, r, r - .3, 6);
    b.ellipse(cx - .7, cy - 1.1, r - 1, r - 1.4, 7);
    b.curve([cx - 3, cy - 1], [cx - 3, cy - 3], [cx, cy - 3], 8);
    b.put(cx - 2, cy - 3, 11);
    b.line([cx + 1, cy + 2], [cx + 3, cy + 2], 15);
    b.put(cx + 2, cy + 1, 16);
    b.put(cx + 2, cy + 3, 1);
  }
}

export const FRUIT_ASSET: PixelAssetDefinition = {
  id: 'fruit', name: 'Fruit', title: 'Fallen fruit',
  shapes: ['Apple', 'Pear', 'Berry cluster'], paletteLabel: 'Skin & bloom',
  palettes: producePalettes,
  intro: 'Notched apple shoulders, a crooked pear neck and a stem-linked currant cluster, shaded with quiet skin bloom and russet freckles.',
  references: [
    { title: 'Apple — whole fruit and section', url: 'https://en.wikipedia.org/wiki/Apple', note: 'The photograph shows a shallow stem basin, rounded uneven shoulders, fine skin streaks and a tucked-in blossom end.' },
    { title: 'Pear — hanging fruit', url: 'https://en.wikipedia.org/wiki/Pear', note: 'A narrow bent neck flares into a heavy asymmetric lower bowl; the skin is finely speckled.' },
    { title: 'Blackcurrant — fruiting raceme', url: 'https://en.wikipedia.org/wiki/Blackcurrant', note: 'Individual glossy berries overlap along a branching stalk and retain small dry blossom tips.' },
  ],
  paint(b, appearance) {
    const random = seededRandom(appearance.seed ^ 0x465255);
    [apple, pear, berries][appearance.shape](b, random);
  },
};

const shellPalettes = [
  { name: 'Rose limestone', tones: ['', '#493d3e', '#735653', '#a57970', '#c69a88', '#e3bca4', '#85655d', '#b28a79', '#d9b39a', '#a49d92', '#d4cbb8', '#f5e8ce', '#625a59', '#867b74', '#b3a79a', '#e9d8bd', '#c39d87'] },
  { name: 'Honey & chalk', tones: ['', '#493d30', '#796043', '#a28258', '#c8a576', '#e7ca96', '#8d7150', '#b69b70', '#ddc595', '#a8a18e', '#d8d2b8', '#f4efd6', '#625e51', '#88816c', '#b5ad94', '#e9dfbc', '#b5a17b'] },
  { name: 'Tidal lavender', tones: ['', '#3d3c4d', '#625b75', '#8c7c97', '#b19aaa', '#d6bdc5', '#736777', '#a18c9a', '#c9b0ba', '#969ba7', '#c7ccd0', '#e9eaDF', '#535b6b', '#7b8290', '#a3aab3', '#dce0db', '#afa3b7'] },
] as const;

function clam(b: PixelBrush, random: () => number): void {
  const rim: PixelPoint[] = [];
  for (let i = 0; i <= 88; i++) {
    const angle = (-74 + i * 148 / 88) * Math.PI / 180;
    const scallop = 1 + .035 * Math.cos(i * Math.PI / 4);
    rim.push([32 + Math.sin(angle) * 25 * scallop, 46 - Math.cos(angle) * 29 * scallop]);
  }
  b.polygon([[29, 47], [17, 44], [18, 38], ...rim, [46, 38], [47, 44], [35, 47]], 1);
  b.polygon([[32, 46], ...rim.map(([x, y]) => [32 + (x - 32) * .96, 46 + (y - 46) * .96] as PixelPoint)], 3);
  const mask = b.pixels.map(row => row.map(Boolean));
  for (let rib = 0; rib <= 11; rib++) {
    const a = (-72 + rib * 144 / 11) * Math.PI / 180;
    const end: PixelPoint = [32 + Math.sin(a) * 24, 46 - Math.cos(a) * 28];
    b.line([32, 45], end, 2, 2);
    b.line([31, 44], [end[0] - 1, end[1] + 1], 5, 2);
    b.line([32, 43], [end[0] + 1, end[1] + 2], 4);
  }
  // Fine concentric growth lines cross, rather than replace, the radial ribs.
  for (const radius of [13, 20, 25]) {
    let previous: PixelPoint | undefined;
    for (let step = 0; step <= 40; step++) {
      const a = (-73 + step * 146 / 40) * Math.PI / 180;
      const point: PixelPoint = [32 + Math.sin(a) * radius * .85, 46 - Math.cos(a) * radius];
      if (previous) b.line(previous, point, 7);
      previous = point;
    }
  }
  for (let y = 0; y < 56; y++) for (let x = 0; x < 64; x++) if (!mask[y][x]) b.pixels[y][x] = 0;
  b.polygon([[20, 40], [28, 44], [23, 44], [19, 42]], 7);
  b.polygon([[36, 44], [44, 40], [45, 43], [40, 45]], 4);
  b.line([28, 47], [36, 47], 2, 2);
  b.line([30, 46], [34, 46], 8);
  surfaceFlecks(b, random, [3, 4], 12);
}

function spiral(b: PixelBrush, random: () => number): void {
  b.polygon([[27, 10], [31, 14], [30, 17], [35, 19], [35, 22], [40, 25],
    [40, 28], [45, 32], [47, 38], [45, 43], [39, 47], [29, 49],
    [25, 46], [20, 42], [18, 36], [19, 31], [22, 27], [22, 23],
    [24, 20], [23, 17], [26, 14]], 1);
  b.polygon([[27, 12], [29, 15], [28, 18], [33, 20], [33, 23], [38, 26],
    [38, 29], [43, 33], [45, 38], [43, 42], [37, 45], [29, 47],
    [25, 43], [21, 40], [20, 35], [23, 29], [24, 25], [26, 21], [25, 17]], 3);
  b.polygon([[27, 15], [27, 20], [25, 24], [24, 30], [22, 35], [24, 40],
    [28, 41], [31, 35], [33, 29], [30, 23], [29, 19]], 5);
  b.curve([25, 18], [29, 20], [32, 20], 2);
  b.curve([24, 23], [30, 27], [36, 25], 2, 2);
  b.curve([22, 29], [30, 34], [40, 29], 2, 2);
  b.curve([22, 28], [30, 31], [37, 27], 8);
  b.curve([21, 35], [30, 40], [42, 32], 6);
  for (let i = 0; i < 6; i++) {
    b.curve([24 + i * 2.5, 31], [22 + i * 2.6, 36], [27 + i * 2.4, 42], i % 2 ? 4 : 7);
  }
  b.polygon([[39, 31], [43, 33], [44, 38], [41, 43], [35, 46], [29, 48],
    [30, 43], [31, 37], [35, 33]], 11);
  b.polygon([[39, 33], [42, 35], [42, 39], [38, 43], [32, 46], [33, 39], [35, 35]], 9);
  b.polygon([[38, 34], [40, 35], [39, 40], [34, 44], [34, 39]], 12);
  b.curve([39, 32], [47, 36], [38, 44], 10, 2);
  b.curve([35, 35], [30, 41], [31, 46], 15);
  b.line([29, 46], [28, 48], 2);
  surfaceFlecks(b, random, [3, 4, 7], 16);
}

function brokenShell(b: PixelBrush, random: () => number): void {
  b.polygon([[12, 31], [17, 26], [21, 28], [25, 21], [29, 25], [34, 18],
    [39, 23], [42, 21], [47, 27], [51, 33], [50, 40], [44, 45],
    [35, 48], [25, 47], [18, 43], [13, 37]], 1);
  b.polygon([[14, 32], [18, 28], [22, 31], [26, 24], [30, 28], [34, 21],
    [39, 26], [42, 24], [46, 28], [49, 34], [48, 39], [42, 44],
    [34, 46], [25, 45], [19, 41], [15, 36]], 4);
  b.polygon([[17, 33], [23, 33], [27, 27], [31, 30], [35, 25], [40, 29],
    [43, 27], [47, 33], [45, 38], [39, 42], [31, 44], [23, 41]], 10);
  b.polygon([[21, 34], [26, 31], [31, 33], [35, 28], [41, 31], [43, 34],
    [40, 38], [34, 41], [27, 40]], 9);
  b.polygon([[25, 35], [30, 35], [35, 31], [39, 33], [39, 36], [33, 38], [28, 38]], 12);
  b.curve([18, 34], [27, 49], [44, 38], 11, 2);
  b.curve([16, 37], [23, 49], [40, 44], 7);
  b.curve([18, 40], [27, 49], [44, 42], 8);
  b.line([18, 28], [22, 31], 11);
  b.line([26, 24], [30, 28], 11);
  b.line([34, 21], [39, 26], 11);
  b.line([42, 24], [47, 30], 11);
  b.line([29, 27], [30, 32], 2);
  b.line([30, 32], [28, 34], 6);
  for (let i = 0; i < 7; i++) b.line([22 + i * 3, 43 + Math.sin(i / 2) * 2], [23 + i * 3, 45 + Math.sin(i / 2)], 6);
  surfaceFlecks(b, random, [4, 7, 9], 15);
}

export const SHELL_ASSET: PixelAssetDefinition = {
  id: 'shells', name: 'Shell', title: 'Shells',
  shapes: ['Clam shell', 'Spiral shell', 'Broken shell'], paletteLabel: 'Weathered mineral',
  palettes: shellPalettes,
  intro: 'A ribbed fan, a stepped whelk and a chipped hollow valve: original beach-shell studies with chalky edges and worn growth lines.',
  references: [
    { title: 'Great scallop — beachworn valves', url: 'https://en.wikipedia.org/wiki/Pecten_maximus', note: 'Broad radial ribs converge at the hinge, the rim is scalloped, and concentric growth lines cross the ribs.' },
    { title: 'Common whelk — museum shell', url: 'https://en.wikipedia.org/wiki/Common_whelk', note: 'Convex stepped whorls have waved folds; a broad pale oval aperture ends in a notched canal. The pale inner lip also informs the imagined broken valve.' },
  ],
  paint(b, appearance) {
    const random = seededRandom(appearance.seed ^ 0x53484c);
    [clam, spiral, brokenShell][appearance.shape](b, random);
  },
};

export const HARVEST_SHORE_ASSETS = [VEGETABLE_ASSET, FRUIT_ASSET, SHELL_ASSET] as const;
