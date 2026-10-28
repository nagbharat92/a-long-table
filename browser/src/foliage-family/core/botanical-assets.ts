import { type PixelAssetDefinition, type PixelBrush } from './ground-pixel-art';
import type { PixelPoint } from './pixel-geometry';
import { seededRandom } from './random';

type Point = PixelPoint;

function pointOn(from: Point, control: Point, to: Point, t: number): Point {
  const u = 1 - t;
  return [u * u * from[0] + 2 * u * t * control[0] + t * t * to[0],
    u * u * from[1] + 2 * u * t * control[1] + t * t * to[1]];
}

function frond(brush: PixelBrush, base: Point, bend: Point, tip: Point, width: number, random: () => number): void {
  // Pinnae sweep toward the tip; the gaps between pairs remain transparent.
  const length = Math.hypot(tip[0] - base[0], tip[1] - base[1]);
  const pairs = Math.round(length / 4.5);
  for (let i = 0; i < pairs; i++) {
    const t = 0.22 + i / (pairs - 1) * 0.71;
    const p = pointOn(base, bend, tip, t);
    const next = pointOn(base, bend, tip, Math.min(1, t + 0.03));
    const distance = Math.hypot(next[0] - p[0], next[1] - p[1]);
    const tx = (next[0] - p[0]) / distance;
    const ty = (next[1] - p[1]) / distance;
    const span = width * Math.sin(Math.PI * t) * Math.sqrt(1 - t) * 1.35 * (0.96 + random() * 0.07);
    for (const side of [-1, 1]) {
      const nx = -ty * side;
      const ny = tx * side;
      const root: Point = [p[0] + tx * (side === 1 ? 0.7 : 0), p[1] + ty * (side === 1 ? 0.7 : 0)];
      const forward = 1.3 + span * 0.35;
      const end: Point = [root[0] + nx * span + tx * forward, root[1] + ny * span + ty * forward];
      const leafLength = Math.hypot(end[0] - root[0], end[1] - root[1]);
      const vx = (end[0] - root[0]) / leafLength;
      const vy = (end[1] - root[1]) / leafLength;
      const halfWidth = Math.min(1.7, span * 0.26);
      const shoulder = (offset: number): Point => [
        root[0] + vx * leafLength * 0.43 - vy * offset,
        root[1] + vy * leafLength * 0.43 + vx * offset,
      ];
      brush.polygon([root, shoulder(halfWidth), end, shoulder(-halfWidth)], 1);
      brush.polygon([root, shoulder(halfWidth * 0.8), end, shoulder(-halfWidth * 0.45)], side === -1 ? 3 : 2);
      if (span > 3) {
        const ridge = shoulder(side === -1 ? halfWidth * 0.35 : -halfWidth * 0.35);
        brush.line(ridge, [root[0] + vx * leafLength * 0.78, root[1] + vy * leafLength * 0.78], side === -1 ? 4 : 3);
      }
    }
  }
  brush.curve(base, bend, tip, 2);
  brush.curve([base[0], base[1] - 1], bend, tip, 3);
}

function fiddlehead(brush: PixelBrush, x: number, y: number, direction: number): void {
  const p = (dx: number, dy: number): Point => [x + dx * direction, y + dy];
  brush.curve(p(-3, 28), p(-6, 12), p(-5, 0), 1, 3);
  brush.curve(p(-3, 28), p(-5, 12), p(-5, 0), 3);
  const curl: Point[] = [[-5, 0], [-4, -4], [-1, -6], [3, -5], [6, -2], [6, 2], [4, 5], [0, 5], [-2, 3], [-2, 0], [0, -1], [2, 0], [2, 2]];
  curl.slice(1).forEach((q, i) => brush.line(p(...curl[i]), p(...q), 2, 3));
  curl.slice(1).forEach((q, i) => brush.line(p(...curl[i]), p(...q), i < 6 ? 4 : 3));
  for (let i = 0; i < 4; i++) {
    const yy = 10 + i * 4;
    brush.line(p(-5, yy), p(-9, yy - 3), 2);
    brush.line(p(-5, yy + 1), p(-1, yy - 2), 3);
  }
}

export const FERN_ASSET: PixelAssetDefinition = {
  id: 'ferns', name: 'Fern', title: 'Ferns',
  shapes: ['Upright fronds', 'Spreading fan', 'Curled fiddlehead'],
  paletteLabel: 'Frond palette',
  palettes: [
    { name: 'Woodland jade', tones: ['', '#183e32', '#286348', '#4b9461', '#91bd73', '#c4d991'] },
    { name: 'Golden bracken', tones: ['', '#33442b', '#536c35', '#7f9647', '#bdc66d', '#e0db96'] },
    { name: 'Cool hart green', tones: ['', '#193f3c', '#286854', '#4b9676', '#8cc3a0', '#bfdbc0'] },
  ],
  intro: 'Original pixel fronds built around arching stems, paired tapered leaflets and the open spiral of a young fiddlehead.',
  references: [{
    title: 'Male fern — Dryopteris filix-mas',
    url: 'https://en.wikipedia.org/wiki/Dryopteris_filix-mas',
    note: 'Upright crowns carry paired pinnae along a rachis; the blade narrows at both ends. The unrolling leaf reference informs the open curled tips, not a copied outline.',
  }, {
    title: 'Unrolling male fern — nature photograph',
    url: 'https://upload.wikimedia.org/wikipedia/commons/8/8a/Uitrollend_blad_van_een_mannetjesvaren_%28Dryopteris_filix-mas%29_28-04-2025_%28d.j.b.%29_02.jpg',
    note: 'The young rachis turns inward in a tight spiral, with folded green pinnae nested inside. The original sprite exaggerates the opening to keep the curl readable at pixel scale.',
  }],
  paint(brush, appearance) {
    const random = seededRandom(appearance.seed ^ 0x4fe21);
    if (appearance.shape === 0) {
      frond(brush, [31, 48], [10, 32], [12, 22], 7, random);
      frond(brush, [33, 48], [52, 33], [52, 20], 7, random);
      frond(brush, [32, 48], [15, 25], [24, 7], 8.5, random);
      frond(brush, [32, 48], [44, 26], [38, 11], 8, random);
    } else if (appearance.shape === 1) {
      frond(brush, [31, 48], [17, 29], [5, 33], 6.5, random);
      frond(brush, [33, 48], [47, 28], [58, 31], 6.5, random);
      frond(brush, [31, 48], [10, 27], [13, 22], 7.5, random);
      frond(brush, [32, 48], [51, 24], [49, 20], 7.5, random);
      frond(brush, [32, 48], [23, 27], [30, 20], 7.5, random);
    } else {
      frond(brush, [31, 48], [17, 30], [9, 30], 7, random);
      frond(brush, [33, 48], [49, 32], [53, 25], 7, random);
      fiddlehead(brush, 23, 19, -1);
      fiddlehead(brush, 37, 14, 1);
    }
    brush.line([30, 48], [33, 45], 2);
    brush.put(32, 47, 5);
  },
};

function mossDome(brush: PixelBrush, cx: number, bottom: number, rx: number, height: number, random: () => number): void {
  const top = bottom - height;
  brush.polygon([[cx - rx, bottom - 2], [cx - rx, top + height * 0.6],
    [cx - rx * 0.72, top + height * 0.27], [cx - rx * 0.3, top + 1],
    [cx + rx * 0.15, top], [cx + rx * 0.63, top + height * 0.2],
    [cx + rx * 0.92, top + height * 0.55], [cx + rx, bottom - 3],
    [cx + rx * 0.65, bottom], [cx - rx * 0.55, bottom]], 1);
  brush.ellipse(cx - 0.5, top + height * 0.52, rx * 0.91, height * 0.45, 2);
  brush.ellipse(cx - rx * 0.17, top + height * 0.37, rx * 0.68, height * 0.29, 3);
  // Small directional shoots follow the dome rather than an all-over noise fill.
  for (let row = 0; row < 3; row++) {
    const yy = top + 3 + row * 3;
    const half = rx * (row === 0 ? 0.43 : 0.69);
    for (let xx = cx - half + (row % 2) * 2; xx < cx + half; xx += 4) {
      if (yy >= bottom - 2) continue;
      const x = Math.round(xx + (random() - 0.5));
      const y = Math.round(yy + (random() > 0.7 ? 1 : 0));
      brush.line([x, y + 1], [x - 1, y - 1], row === 0 ? 4 : 3);
      brush.put(x + 1, y, row === 0 && random() > 0.65 ? 5 : 4);
    }
  }
}

export const MOSS_ASSET: PixelAssetDefinition = {
  id: 'moss', name: 'Moss', title: 'Moss',
  shapes: ['Low cushion', 'Rounded mound', 'Trailing strip'],
  paletteLabel: 'Moss palette',
  palettes: [
    { name: 'Rainy emerald', tones: ['', '#203d28', '#386132', '#608943', '#94b45c', '#c9d88b'] },
    { name: 'Silver pincushion', tones: ['', '#2a4338', '#4d7060', '#78977a', '#adc3a0', '#d2dfb6'] },
    { name: 'Sunlit chartreuse', tones: ['', '#354228', '#5c6e32', '#8d9d43', '#bac76c', '#e0dfa2'] },
  ],
  intro: 'Soft, overlapping cushions with shaded lower skirts and carefully grouped tiny leafy shoots, never a ground shadow.',
  references: [{
    title: 'Pincushion moss — Leucobryum glaucum',
    url: 'https://en.wikipedia.org/wiki/Leucobryum_glaucum',
    note: 'The compact pincushion growth habit informs the clustered domes and fine upright shoots; silver-green tops contrast with the dense lower growth.',
  }, {
    title: 'Pincushion moss — nature photograph',
    url: 'https://upload.wikimedia.org/wikipedia/commons/5/5a/Leucobryum_glaucum.jpg',
    note: 'Dense bright-green cushions have rounded tops and tiny pointed shoots following their curved surfaces. Overlapping lobes and darker creases inform the controlled texture clusters.',
  }],
  paint(brush, appearance) {
    const random = seededRandom(appearance.seed ^ 0x710ab);
    const domes = appearance.shape === 0
      ? [[15, 46, 10, 10], [29, 45, 13, 14], [44, 46, 12, 11], [34, 48, 12, 9]]
      : appearance.shape === 1
        ? [[17, 46, 10, 15], [30, 43, 14, 23], [44, 46, 11, 17], [29, 48, 15, 14]]
        : [[11, 39, 7, 9], [22, 42, 10, 12], [35, 44, 10, 10], [46, 46, 9, 9], [54, 48, 5, 7]];
    for (const [x, bottom, radius, height] of domes) mossDome(brush, x, bottom, radius, height, random);
  },
};

function blade(brush: PixelBrush, base: Point, control: Point, tip: Point, width: number, tone: number): void {
  const left: Point[] = [];
  const right: Point[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const p = pointOn(base, control, tip, t);
    const w = width * Math.sin(Math.PI * t) * 0.5;
    left.push([p[0] - w, p[1]]);
    right.push([p[0] + w, p[1]]);
  }
  brush.polygon([...left, ...right.reverse()], tone);
  brush.curve(base, control, tip, tone + 1);
}

function cattail(brush: PixelBrush, x: number, top: number, lean: number): void {
  brush.line([x - lean, 48], [x, top + 9], 2);
  brush.line([x, top - 4], [x, top], 4);
  brush.polygon([[x - 2, top + 1], [x - 1, top], [x + 1, top], [x + 2, top + 1],
    [x + 2, top + 10], [x + 1, top + 12], [x - 1, top + 12], [x - 2, top + 10]], 6);
  brush.line([x - 1, top + 2], [x - 1, top + 9], 7);
  brush.line([x, top + 1], [x, top + 5], 8);
  brush.put(x + 1, top + 10, 7);
}

export const REED_ASSET: PixelAssetDefinition = {
  id: 'reeds', name: 'Reed', title: 'Reeds / rushes',
  shapes: ['Thin reeds', 'Broad blades', 'Cattails'],
  paletteLabel: 'Wetland palette',
  palettes: [
    { name: 'Marsh green', tones: ['', '#233e30', '#416640', '#72934e', '#abc174', '#d1d99b', '#4c3025', '#855038', '#b57b4e'] },
    { name: 'Blue sedge', tones: ['', '#203d3c', '#3c6460', '#68938a', '#a0bfb0', '#ced9bd', '#49332d', '#7b5442', '#b38660'] },
    { name: 'Autumn olive', tones: ['', '#3e4229', '#69703b', '#96964e', '#c1ba73', '#e2d59b', '#503023', '#8c5130', '#bd8050'] },
  ],
  intro: 'Slender wetland stems, pointed ribbon leaves and velvet-brown cattail cylinders, with open air between every tall stalk.',
  references: [{
    title: 'Broadleaf cattail — Typha latifolia',
    url: 'https://en.wikipedia.org/wiki/Typha_latifolia',
    note: 'Long strap-like leaves surround separate upright flower stems; the persistent female spike is a brown cylinder with a fine bare tip above it.',
  }, {
    title: 'Bulrush flower head and leaves — nature photograph',
    url: 'https://upload.wikimedia.org/wikipedia/commons/4/4c/Bulrush_%28Typha_latifolia%29_%288139113636%29.jpg',
    note: 'A velvety brown cylinder has softly rounded ends and a narrow pale stem above it; flat ribbon leaves cross behind it with bright edges and deep shaded folds.',
  }],
  paint(brush, appearance) {
    const random = seededRandom(appearance.seed ^ 0x7eed);
    if (appearance.shape === 0) {
      const stems: [Point, Point, Point][] = [
        [[27, 48], [16, 28], [14, 14]], [[29, 48], [24, 21], [25, 7]],
        [[32, 48], [35, 26], [33, 11]], [[34, 48], [42, 25], [45, 8]],
        [[36, 48], [50, 33], [52, 20]],
      ];
      stems.forEach(([base, control, tip], i) => {
        brush.curve(base, control, tip, i % 2 ? 3 : 2);
        const p = pointOn(base, control, tip, 0.45);
        blade(brush, p, [p[0] + (i % 2 ? 7 : -7), p[1] - 7],
          [p[0] + (i % 2 ? 8 : -8), p[1] - 14], 2, 3);
      });
      blade(brush, [32, 48], [15, 36], [8, 30], 2, 2);
    } else {
      blade(brush, [31, 48], [18, 30], [10, 21], 4, 1);
      blade(brush, [34, 48], [48, 31], [54, 19], 4, 2);
      blade(brush, [29, 48], [19, 22], [20, 10], 4.5, 2);
      blade(brush, [34, 48], [42, 20], [40, 6], 4, 1);
      if (appearance.shape === 2) {
        cattail(brush, 27, 9, -2);
        cattail(brush, 41, 16, 5);
      } else {
        blade(brush, [32, 48], [30, 23], [32, 5], 5, 2);
        blade(brush, [33, 48], [44, 35], [57, 31], 4, 1);
      }
      blade(brush, [32, 48], [28, 29], [26, 19], 3, 3);
      blade(brush, [34, 48], [39, 34], [46, 28], 3, 3);
    }
    for (let i = 0; i < 4; i++) brush.put(29 + i * 2, 46 + Math.floor(random() * 3), 3);
  },
};

export const BOTANICAL_ASSETS = [FERN_ASSET, MOSS_ASSET, REED_ASSET] as const;
