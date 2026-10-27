import { describe, expect, it } from 'vitest';
import { buildMotionArtwork, RABBIT_FACE } from '../src/core/character-face';
import { RIG_HEIGHT, RIG_WIDTH } from '../src/core/character-rig';

function sourceFixture(): Uint8ClampedArray {
  const source = new Uint8ClampedArray(RIG_WIDTH * RIG_HEIGHT * 4);
  for (let index = 0; index < source.length; index += 4) source.set([247, 249, 248, 255], index);
  source.set([0, 0, 0, 255], 10 * RIG_WIDTH * 4);
  for (const feature of RABBIT_FACE) {
    for (const region of feature.regions) {
      for (let y = region.y; y < region.y + region.height; y++) {
        for (let x = region.x; x < region.x + region.width; x++) source.set([0, 0, 0, 255], (y * RIG_WIDTH + x) * 4);
      }
    }
  }
  return source;
}

describe('motion facial cutouts', () => {
  it('separates both original eyes and the nose without leaving duplicate marks in Head', () => {
    const source = sourceFixture();
    const before = source.slice();
    const blink = source.slice();
    for (const x of [2, 11]) blink.set([247, 249, 248, 255], (13 * RIG_WIDTH + x) * 4);
    const artwork = buildMotionArtwork(source, blink);
    const head = artwork.layers.find(layer => layer.id === 'head')!;
    const face = artwork.face;
    expect(face.map(layer => layer.feature.id)).toEqual(['left-eye', 'right-eye', 'nose']);
    for (let index = 0; index < source.length; index += 4) {
      const feature = face.find(layer => layer.pixels[index + 3] > 0);
      if (feature) {
        expect(head.pixels.slice(index, index + 4)).toEqual(new Uint8ClampedArray([247, 249, 248, 255]));
      }
      const top = feature?.pixels ?? [...artwork.layers].reverse().find(layer => layer.pixels[index + 3])!.pixels;
      expect(top.slice(index, index + 4)).toEqual(source.slice(index, index + 4));
    }
    for (const layer of face.slice(0, 2)) {
      const x = Math.floor(layer.feature.pivot.x);
      expect(layer.blink[(13 * RIG_WIDTH + x) * 4 + 3]).toBe(0);
      expect(layer.blink[(14 * RIG_WIDTH + x) * 4 + 3]).toBe(255);
    }
    expect(face[2].blink).toEqual(face[2].pixels);
    expect(source).toEqual(before);
  });

  it('rejects an invalid blink image or missing facial pixels explicitly', () => {
    const source = sourceFixture();
    expect(() => buildMotionArtwork(source, new Uint8ClampedArray(4))).toThrow('blink source');
    const blink = source.slice();
    blink[(13 * RIG_WIDTH + 2) * 4 + 3] = 0;
    expect(() => buildMotionArtwork(source, blink)).toThrow('left-eye blink pixel must be opaque');
    source[(13 * RIG_WIDTH + 2) * 4 + 3] = 0;
    expect(() => buildMotionArtwork(source, source)).toThrow('left-eye source pixel is missing');
  });
});
