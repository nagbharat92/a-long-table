import { polygonContains, type PixelPoint } from './pixel-geometry';
import { seededRandom } from './random';
import type { GroundAssetAppearance } from '../ground-asset-explorer';

export const GROUND_ART_SIZE = { width: 64, height: 56 } as const;
export const GROUND_ART_SIZES = ['Small', 'Medium', 'Large'] as const;
export const GROUND_ART_FACINGS = ['Original', 'Mirrored'] as const;
export type GroundArtAppearance = GroundAssetAppearance;

export interface PixelAssetDefinition<Appearance extends GroundArtAppearance = GroundArtAppearance> {
  id: string;
  name: string;
  title: string;
  shapes: readonly string[];
  paletteLabel: string;
  palettes: readonly { readonly name: string; readonly tones: readonly string[] }[];
  intro: string;
  references: readonly { readonly title: string; readonly url: string; readonly note: string }[];
  dimensions?: { readonly width: number; readonly height: number };
  baseline?: number;
  paint: (brush: PixelBrush, appearance: Appearance) => void;
}

export class PixelBrush {
  readonly pixels: number[][];

  constructor(readonly dimensions: { readonly width: number; readonly height: number } = GROUND_ART_SIZE) {
    this.pixels = Array.from({ length: dimensions.height }, () => Array<number>(dimensions.width).fill(0));
  }

  put(x: number, y: number, tone: number): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && x < this.dimensions.width && y >= 0 && y < this.dimensions.height) this.pixels[y][x] = tone;
  }

  polygon(points: readonly PixelPoint[], tone: number): void {
    for (let y = 0; y < this.dimensions.height; y++) for (let x = 0; x < this.dimensions.width; x++) {
      if (polygonContains(points, x + 0.5, y + 0.5)) this.pixels[y][x] = tone;
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, tone: number): void {
    for (let y = 0; y < this.dimensions.height; y++) for (let x = 0; x < this.dimensions.width; x++) {
      if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) this.pixels[y][x] = tone;
    }
  }

  line(from: PixelPoint, to: PixelPoint, tone: number, thickness = 1): void {
    const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) * 2));
    for (let i = 0; i <= steps; i++) {
      const x = from[0] + (to[0] - from[0]) * i / steps;
      const y = from[1] + (to[1] - from[1]) * i / steps;
      if (thickness <= 1) this.put(x, y, tone);
      else this.ellipse(x + 0.5, y + 0.5, thickness / 2, thickness / 2, tone);
    }
  }

  curve(from: PixelPoint, control: PixelPoint, to: PixelPoint, tone: number, thickness = 1): void {
    let previous = from;
    for (let i = 1; i <= 32; i++) {
      const t = i / 32;
      const point: PixelPoint = [
        (1 - t) ** 2 * from[0] + 2 * (1 - t) * t * control[0] + t * t * to[0],
        (1 - t) ** 2 * from[1] + 2 * (1 - t) * t * control[1] + t * t * to[1],
      ];
      this.line(previous, point, tone, thickness);
      previous = point;
    }
  }
}

export function groundArtSeed(value: string, name: string): number {
  if (!/^\d{1,10}$/.test(value) || Number(value) > 4294967295) {
    throw new RangeError(`${name} seed must be a whole number from 0 to 4294967295.`);
  }
  return Number(value);
}

export function generateGroundArt<Appearance extends GroundArtAppearance>(asset: PixelAssetDefinition<Appearance>, seed: number): GroundArtAppearance {
  groundArtSeed(String(seed), asset.name);
  const random = seededRandom(seed ^ Array.from(asset.id).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) | 0, 0));
  return {
    version: 1, seed, shape: Math.floor(random() * asset.shapes.length),
    palette: Math.floor(random() * asset.palettes.length), size: Math.floor(random() * GROUND_ART_SIZES.length),
    facing: Math.floor(random() * GROUND_ART_FACINGS.length),
  };
}

export function groundArtPixels<Appearance extends GroundArtAppearance>(asset: PixelAssetDefinition<Appearance>, appearance: Appearance): number[][] {
  groundArtSeed(String(appearance.seed), asset.name);
  if (appearance.version !== 1) throw new RangeError(`Unsupported ${asset.id} recipe version.`);
  for (const [value, count] of [[appearance.shape, asset.shapes.length], [appearance.palette, asset.palettes.length],
    [appearance.size, GROUND_ART_SIZES.length], [appearance.facing, GROUND_ART_FACINGS.length]]) {
    if (!Number.isInteger(value) || value < 0 || value >= count) throw new RangeError(`Invalid ${asset.id} recipe parameter.`);
  }
  const dimensions = asset.dimensions ?? GROUND_ART_SIZE;
  const brush = new PixelBrush(dimensions);
  asset.paint(brush, appearance);
  const { width, height } = dimensions;
  const baseline = asset.baseline ?? 49;
  const center = width / 2;
  const scale = [0.6, 0.8, 1][appearance.size];
  return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => {
    const sx = Math.floor(center + (x + 0.5 - center) / scale);
    const sy = Math.floor(baseline + (y + 0.5 - baseline) / scale);
    return sx >= 0 && sx < width && sy >= 0 && sy < height ? brush.pixels[sy][appearance.facing ? width - 1 - sx : sx] : 0;
  }));
}

export function drawGroundArt<Appearance extends GroundArtAppearance>(context: CanvasRenderingContext2D, asset: PixelAssetDefinition<Appearance>, appearance: Appearance): void {
  const pixels = groundArtPixels(asset, appearance);
  const tones = asset.palettes[appearance.palette].tones;
  const { width, height } = asset.dimensions ?? GROUND_ART_SIZE;
  context.clearRect(0, 0, width, height);
  pixels.forEach((row, y) => row.forEach((tone, x) => {
    if (!tone) return;
    if (!tones[tone]) throw new RangeError(`Missing ${asset.id} artwork tone ${tone}.`);
    context.fillStyle = tones[tone];
    context.fillRect(x, y, 1, 1);
  }));
}
