import { part, SIZE, stamp, type Palette } from './authored-artwork';
import type { RigLayer } from './character-rig';

/** Authored anatomy measured against Bunny; no sampled or resized source pixels. */
export function familyBody(palette: Palette): RigLayer[] {
  const layers: RigLayer[] = [];
  for (const right of [false, true]) {
    const pixels = new Uint8ClampedArray(SIZE);
    stamp(pixels, right ? 10 : 4, 24, right ? [
      ' XX ', 'XccX', 'XccX', ' XcX', '  XX',
    ] : [
      ' XX', 'XcX', 'XcX', 'XcX', 'XX ',
    ], palette);
    layers.push(part(right ? 'right-foot' : 'left-foot', pixels, { x: right ? 12 : 6, y: 25 }));
  }
  const body = new Uint8ClampedArray(SIZE);
  stamp(body, 4, 18, [
    '  XXXXXX  ',
    'XhccccccsX',
    'XhccccccsX',
    'XcccccccsX',
    'XcccccccsX',
    'XcccccccsX',
    'XcccccccsX',
    'XccccccssX',
    'XccXXXXccX',
  ], palette);
  layers.push(part('body', body, { x: 9, y: 23 }));
  for (const right of [false, true]) {
    const pixels = new Uint8ClampedArray(SIZE);
    stamp(pixels, right ? 11 : 2, 20, right ? [
      ' XX ', 'Xcs ', 'XcsX', 'XcsX', 'XcsX', ' XX ',
    ] : [
      ' XX', ' Xs', 'Xsc', 'Xsc', 'Xsc', ' XX',
    ], palette);
    layers.push(part(right ? 'right-arm' : 'left-arm', pixels, { x: right ? 12 : 5, y: 21 }));
  }
  return layers;
}

export function familyHead(palette: Palette): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(SIZE);
  stamp(pixels, 0, 6, [
    '   XXXXXXXXXXXX   ',
    '  XhhccccccccccX  ',
    ' XhhccccccccccccX ',
    ' XhcccccccccccccX ',
    'XhccccccccccccccsX',
    'XccccccccccccccssX',
    'XccccccccccccccssX',
    'XccccccccccccccssX',
    'XccccccccccccccssX',
    'XccccccccccccccssX',
    ' XccccccccccccssX ',
    '  XcccccccccsssX  ',
    '   XXXssssssXXX   ',
  ], palette);
  return pixels;
}
