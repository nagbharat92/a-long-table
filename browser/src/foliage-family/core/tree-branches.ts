import type { PixelPoint } from './pixel-geometry';
import { seededRandom } from './random';

export interface TreeBranch {
  points: [PixelPoint, PixelPoint, PixelPoint];
  twigs: [PixelPoint, PixelPoint, PixelPoint][];
  thickness: number;
}

// Composed rhythms leave room for crowns and reserve long limbs for one or two accents.
const ARRANGEMENTS: readonly (readonly (readonly [number, number, number])[])[] = [
  [[42, 1, 0.25], [68, -1, 1], [92, 1, 0.55], [121, -1, 0.25], [141, 1, 0.7]],
  [[35, -1, 0.25], [61, 1, 0.65], [88, -1, 1], [117, 1, 0.3], [139, -1, 0.55]],
  [[46, 1, 0.3], [73, -1, 0.55], [99, 1, 1], [132, -1, 0.65]],
  [[38, -1, 0.25], [63, 1, 0.75], [82, -1, 0.3], [109, -1, 1], [136, 1, 0.45]],
];

export function treeBranches(seed: number, shape: number, style: number): TreeBranch[] {
  const random = seededRandom(seed ^ (style + 1) * 0x31a7);
  const lean = shape === 1 ? -2 : shape === 2 ? 2 : 0;
  const arrangement = ARRANGEMENTS[(Math.floor(random() * ARRANGEMENTS.length) + shape) % ARRANGEMENTS.length];
  const facing = random() < 0.5 ? -1 : 1;
  const gesture = style === 1 ? -0.75 : style === 2 ? 0.6 : random() * 0.8 - 0.5;
  return arrangement.map(([height, direction, weight]) => {
    const y = height + (random() - 0.5) * 4;
    const side = direction * facing;
    const broken = weight < 0.35 || (style === 3 && weight < 0.9);
    const length = (3 + weight * 11 + random()) * (style === 3 ? 0.6 : 1);
    const rise = broken ? -1 - random() * 2 : length * gesture;
    const origin: PixelPoint = [40 + lean * (1 - y / 169), y];
    const point = (reach: number, lift: number): PixelPoint =>
      [origin[0] + side * length * reach, y + lift];
    const control = point(0.55, rise * (style === 1 ? 0.65 : 0.15));
    const tip = point(1, rise);
    const twigs: TreeBranch['twigs'] = [];
    if (weight === 1 && style !== 3 && random() < 0.65) {
      const t = 0.7;
      const fork: PixelPoint = [
        origin[0] * (1 - t) ** 2 + 2 * control[0] * t * (1 - t) + tip[0] * t * t,
        y * (1 - t) ** 2 + 2 * control[1] * t * (1 - t) + tip[1] * t * t,
      ];
      twigs.push([fork, [fork[0] + side * 2, fork[1] - 1], [fork[0] + side * 3, fork[1] - 3]]);
    }
    return { points: [origin, control, tip], twigs, thickness: broken ? 1 : 1.5 + weight * 0.6 };
  });
}
