import type Phaser from 'phaser';
import { RIG_HEIGHT, RIG_WIDTH } from '../core/character-rig';

export const SOURCE_PIXEL_SCALE = 12 / RIG_HEIGHT;
export const RABBIT_TEXTURE = 'rabbit';
export const BLINK_TEXTURE = 'rabbit-blink';

export function readRabbitPixels(scene: Phaser.Scene, key = RABBIT_TEXTURE): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = RIG_WIDTH;
  canvas.height = RIG_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error(`Could not prepare the ${key} source pixels.`);
  const source = scene.textures.get(key).getSourceImage();
  if (!(source instanceof HTMLImageElement)) throw new Error(`The ${key} source is not an image.`);
  context.drawImage(source, 0, 0);
  return context.getImageData(0, 0, RIG_WIDTH, RIG_HEIGHT).data;
}
