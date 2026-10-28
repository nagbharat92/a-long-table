import type { Point, Rectangle } from './contracts';
import { buildRigLayers, RIG_HEIGHT, RIG_WIDTH, type RigLayer } from './character-rig';

export interface FaceFeature {
  id: 'left-eye' | 'right-eye' | 'nose';
  pivot: Point;
  regions: Rectangle[];
}

export const RABBIT_FACE: readonly FaceFeature[] = [
  { id: 'left-eye', pivot: { x: 2.5, y: 14.5 }, regions: [{ x: 2, y: 13, width: 1, height: 2 }] },
  { id: 'right-eye', pivot: { x: 11.5, y: 14.5 }, regions: [{ x: 11, y: 13, width: 1, height: 2 }] },
  { id: 'nose', pivot: { x: 6.5, y: 16.5 }, regions: [
    { x: 6, y: 15, width: 1, height: 1 }, { x: 5, y: 16, width: 1, height: 1 }, { x: 7, y: 16, width: 1, height: 1 },
  ] },
];

export interface FaceLayer {
  feature: FaceFeature;
  pixels: Uint8ClampedArray;
  blink: Uint8ClampedArray;
}

export function buildMotionArtwork(
  source: Uint8ClampedArray,
  blink: Uint8ClampedArray,
): { layers: RigLayer[]; face: FaceLayer[] } {
  if (blink.length !== RIG_WIDTH * RIG_HEIGHT * 4) throw new Error('The blink source must be 18 by 29 RGBA pixels.');
  const layers = buildRigLayers(source);
  const head = layers.find(layer => layer.id === 'head')!;
  const fill = source.slice((10 * RIG_WIDTH + 7) * 4, (10 * RIG_WIDTH + 7) * 4 + 4);
  const face = RABBIT_FACE.map(feature => {
    const pixels = new Uint8ClampedArray(source.length);
    const closed = new Uint8ClampedArray(source.length);
    for (const region of feature.regions) {
      for (let y = region.y; y < region.y + region.height; y++) {
        for (let x = region.x; x < region.x + region.width; x++) {
          const index = (y * RIG_WIDTH + x) * 4;
          if (!source[index + 3]) throw new Error(`The ${feature.id} source pixel is missing.`);
          if (blink[index + 3] !== 255) throw new Error(`The ${feature.id} blink pixel must be opaque.`);
          pixels.set(source.subarray(index, index + 4), index);
          if (!fill.every((value, channel) => value === blink[index + channel])) {
            closed.set(blink.subarray(index, index + 4), index);
          }
          head.pixels.set(fill, index);
        }
      }
    }
    return { feature, pixels, blink: closed };
  });
  return { layers, face };
}
