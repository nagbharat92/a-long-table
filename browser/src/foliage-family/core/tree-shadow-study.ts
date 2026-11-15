import { LAYER_TREES, TREE_ASSET, TREE_BASELINE, TREE_LAYER_SIZE, TREE_SIZE, type TreeAppearance } from './tree-assets';
import { prepareTreeMotion, type TreeWind } from './tree-motion';
import { validateSunSettings, type SunSettings } from '../../world-family/render/island-sun';

export const TREE_SHADOW_HEIGHT = 212;

interface TreeFrame {
  x: number;
  y: number;
  pixels: number[][];
  tones: readonly string[];
}

export interface ShadowStudyFrame {
  pixels: Uint8ClampedArray;
  groundShadowPixels: number;
  treeShadowPixels: number;
}

export function color(hex: string): readonly [number, number, number] {
  return [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16)) as [number, number, number];
}

function shadowSamples(mask: Uint16Array, width: number, height: number, x: number, y: number, radius: number): number {
  const sample = (sx: number, sy: number): number => {
    const ix = Math.round(sx), iy = Math.round(sy);
    return ix >= 0 && ix < width && iy >= 0 && iy < height && mask[iy * width + ix] ? 1 : 0;
  };
  if (radius < 0.5) return sample(x, y);
  let hits = sample(x, y);
  for (let index = 0; index < 8; index++) {
    const angle = index * Math.PI / 4;
    hits += sample(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
  }
  return hits / 9;
}

export function qualityMask(mask: Uint16Array, width: number, height: number, mapSize: SunSettings['mapSize']): Uint16Array {
  const step = 2048 / mapSize;
  if (step === 1) return mask;
  const result = new Uint16Array(mask.length);
  for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) {
    let depth = 0;
    for (let oy = 0; oy < step && y + oy < height; oy++) for (let ox = 0; ox < step && x + ox < width; ox++) {
      depth = Math.max(depth, mask[(y + oy) * width + x + ox]);
    }
    if (!depth) continue;
    for (let oy = 0; oy < step && y + oy < height; oy++) for (let ox = 0; ox < step && x + ox < width; ox++) {
      result[(y + oy) * width + x + ox] = depth;
    }
  }
  return result;
}

export function coverage(mask: Uint16Array, width: number, height: number, x: number, y: number, sun: SunSettings): number {
  if (sun.shadowMode === 'hard' || sun.softness === 0) return mask[y * width + x] ? 1 : 0;
  const radius = sun.shadowMode === 'filtered'
    ? sun.softness * 0.65
    : Math.tan(sun.softness * Math.PI / 360) * (mask[y * width + x] || 80) * 0.4;
  return shadowSamples(mask, width, height, x, y, radius);
}

export function prepareTreeShadowStudy(
  appearance: TreeAppearance, layered: boolean, groundColor: readonly [number, number, number],
): (seconds: number, wind: TreeWind, settings: SunSettings) => ShadowStudyFrame {
  const layers = layered
    ? [...LAYER_TREES.map((layer, index) => ({
      ...appearance, ...layer, seed: (appearance.seed + index * 73) >>> 0,
    })), { ...appearance, x: 76, y: 5 }]
    : [{ ...appearance, x: 0, y: 0 }];
  const prepared = layers.map(layer => ({
    x: layer.x, y: layer.y,
    tones: TREE_ASSET.palettes[layer.palette].tones,
    draw: prepareTreeMotion(layer),
  }));
  const width = layered ? TREE_LAYER_SIZE.width : TREE_SIZE.width;
  const height = TREE_SHADOW_HEIGHT;
  const base = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 4;
    base[index] = groundColor[0];
    base[index + 1] = groundColor[1];
    base[index + 2] = groundColor[2];
    base[index + 3] = 255;
  }
  return (seconds, wind, settings) => {
    const sun = validateSunSettings(settings);
    const azimuth = sun.azimuth * Math.PI / 180;
    const length = 1 / Math.tan(sun.elevation * Math.PI / 180);
    const shadowX = -Math.cos(azimuth) * length * 0.22;
    const shadowY = -Math.sin(azimuth) * length * 0.2;
    const pixels = base.slice();
    const frames: TreeFrame[] = prepared.map(tree => ({
      x: tree.x, y: tree.y, tones: tree.tones, pixels: tree.draw(seconds, wind),
    }));
    const groundMask = new Uint16Array(width * height);
    const receivers = frames.map(() => new Uint16Array(TREE_SIZE.width * TREE_SIZE.height));
    frames.forEach((source, sourceIndex) => {
      source.pixels.forEach((row, y) => row.forEach((tone, x) => {
        if (!tone || y > TREE_BASELINE) return;
        const z = TREE_BASELINE - y;
        const worldX = source.x + x;
        const groundX = Math.round(worldX + z * shadowX);
        const groundY = Math.round(TREE_BASELINE + source.y + z * shadowY);
        const spread = tone >= 3 ? 2 : 0;
        for (let oy = -spread; oy <= spread; oy++) for (let ox = -spread; ox <= spread; ox++) {
          const gx = groundX + ox, gy = groundY + oy;
          if (gx >= 0 && gx < width && gy >= 0 && gy < height) {
            const index = gy * width + gx;
            groundMask[index] = Math.max(groundMask[index], z);
          }
        }
        for (let receiverIndex = 0; receiverIndex < frames.length; receiverIndex++) {
          if (receiverIndex === sourceIndex || Math.abs(shadowY) < 0.01) continue;
          const receiver = frames[receiverIndex];
          const travel = (receiverIndex - sourceIndex) * 2.16 / shadowY;
          if (travel <= 0 || z <= travel) continue;
          const rx = Math.round(worldX + travel * shadowX - receiver.x);
          const ry = Math.round(y + travel + source.y - receiver.y);
          if (rx >= 0 && rx < TREE_SIZE.width && ry >= 0 && ry < TREE_SIZE.height) {
            const index = ry * TREE_SIZE.width + rx;
            receivers[receiverIndex][index] = Math.max(receivers[receiverIndex][index], Math.round(travel));
          }
        }
      }));
    });
    let groundShadowPixels = 0, treeShadowPixels = 0;
    const ground = qualityMask(groundMask, width, height, sun.mapSize);
    ground.forEach((_, index) => {
      const shade = coverage(ground, width, height, index % width, Math.floor(index / width), sun);
      if (!shade || sun.intensity === 0 || sun.shadowStrength === 0) return;
      groundShadowPixels++;
      const pixel = index * 4;
      const darkness = Math.min(1, shade * sun.shadowStrength * sun.intensity * (1 - 0.25 * sun.skyFill));
      pixels[pixel] = Math.round(pixels[pixel] * (1 - darkness * 0.3));
      pixels[pixel + 1] = Math.round(pixels[pixel + 1] * (1 - darkness * 0.27));
      pixels[pixel + 2] = Math.round(pixels[pixel + 2] * (1 - darkness * 0.27));
    });
    const receiverMasks = receivers.map(mask => qualityMask(mask, TREE_SIZE.width, TREE_SIZE.height, sun.mapSize));
    frames.forEach((tree, treeIndex) => {
      tree.pixels.forEach((row, y) => row.forEach((tone, x) => {
        if (!tone) return;
        const dx = x + tree.x, dy = y + tree.y;
        if (dx < 0 || dx >= width || dy < 0 || dy >= height) return;
        const shade = coverage(receiverMasks[treeIndex], TREE_SIZE.width, TREE_SIZE.height, x, y, sun);
        const [red, green, blue] = color(tree.tones[tone]);
        const index = (dy * width + dx) * 4;
        const light = (sun.intensity * 0.79 + sun.skyFill * 0.7)
          * (1 - Math.min(1, shade * sun.shadowStrength * sun.intensity) * 0.33);
        const warmth = (sun.warmth - 0.3) * sun.intensity;
        pixels[index] = Math.round(red * light * (1 + warmth * 0.14));
        pixels[index + 1] = Math.round(green * light * (1 - warmth * 0.02));
        pixels[index + 2] = Math.round(blue * light * (1 - warmth * 0.15));
        pixels[index + 3] = 255;
        if (shade && sun.intensity > 0 && sun.shadowStrength > 0) treeShadowPixels++;
      }));
    });
    return { pixels, groundShadowPixels, treeShadowPixels };
  };
}
