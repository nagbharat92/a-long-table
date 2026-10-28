import type { CharacterAppearance } from './character-appearance';
import type { CharacterArtwork } from './character-definition';
import type { CharacterExpressionType } from './character-expression';
import type { FaceLayer } from './character-face';
import { RIG_WIDTH, type RigLayer } from './character-rig';
import { bounds, color, composite, mix, part, SIZE, stamp, type Color, type Palette } from './authored-artwork';
import { familyBody, familyHead } from './family-artwork';

const INK: Color = [39, 43, 53, 255];
const NOSE: Color = [216, 139, 143, 255];

const EYES: Record<CharacterExpressionType, readonly [readonly string[], readonly string[]]> = {
  neutral: [['   ', ' # ', ' # '], ['   ', ' # ', ' # ']],
  happy: [[' # ', ' ##', '   '], [' # ', '# #', '   ']],
  sleepy: [['   ', ' ##', '   '], ['   ', ' ##', '   ']],
  curious: [[' # ', ' # ', '   '], ['   ', ' # ', '   ']],
};

function faceLayers(expression: CharacterExpressionType): FaceLayer[] {
  const drawing = EYES[expression];
  if (!drawing) throw new Error('Unknown cat expression.');
  const palette: Palette = { '#': INK, n: NOSE };
  const eyes = ([1, 10] as const).map((x, index): FaceLayer => {
    const pixels = new Uint8ClampedArray(SIZE), blink = new Uint8ClampedArray(SIZE);
    stamp(pixels, x, 12, drawing[index], palette);
    stamp(blink, x, 14, [index === 0 ? ' ##' : '## '], palette);
    return {
      feature: {
        id: index === 0 ? 'left-eye' : 'right-eye', pivot: { x: x + 1.5, y: 14.5 },
        regions: [{ x, y: 12, width: 3, height: 3 }],
      },
      pixels, blink,
    };
  });
  const pixels = new Uint8ClampedArray(SIZE);
  stamp(pixels, 6, 15, ['n'], palette);
  return [...eyes, {
    feature: { id: 'nose', pivot: { x: 6.5, y: 15.5 }, regions: [{ x: 6, y: 15, width: 1, height: 1 }] },
    pixels, blink: pixels.slice(),
  }];
}

/**
 * Complete, overlapping feline silhouettes on the shared 18x29 canvas.
 * The open hook leaves air between the tail and flank; its root is hidden by the belly.
 */
export function buildCatArtwork(appearance: CharacterAppearance): CharacterArtwork {
  const coat = color(appearance.parameters.color.coat), shade = color(appearance.parameters.color.shade);
  const palette: Palette = { X: INK, c: coat, s: shade, h: mix(coat, [255, 249, 235, 255], 0.16) };
  const tail = new Uint8ClampedArray(SIZE);
  stamp(tail, 12, 20, [
    '   XX ',
    '    cX',
    '   XcX',
    '  XcsX',
    ' XcssX',
    'XcssX ',
    ' XXX  ',
  ], palette);
  const layers: RigLayer[] = [part('tail', tail, { x: 13, y: 24 }), ...familyBody(palette)];
  for (const right of [false, true]) {
    const pixels = new Uint8ClampedArray(SIZE), x = right ? 10 : 3;
    const top = right ? 2 : 3;
    stamp(pixels, x, top, right ? [
      '   X ', '  XcX', ' XccX', 'XccsX', ' XsX ', '  X  ',
    ] : [
      ' X  ', 'XhX ', 'XhcX', ' XsX', '  X ',
    ], palette);
    const ears = appearance.parameters.ears;
    if (ears && ears.type !== 'plain') {
      const accent = color(ears.color);
      const marked = ears.type === 'both' || (ears.type === 'single' && !right);
      const markings: Palette = { a: accent };
      if (ears.type === 'inner') {
        stamp(pixels, x + (right ? 2 : 1), top + 1, right ? [' a', 'aa'] : ['a ', 'aa'], markings);
      } else {
        for (let y = top; y <= top + 3; y++) {
          for (let dx = 0; dx < 5; dx++) {
            const i = (y * RIG_WIDTH + x + dx) * 4;
            if (!pixels[i + 3] || INK.every((value, channel) => value === pixels[i + channel])) continue;
            if (marked || (ears.type === 'tips' && y <= top + 1)) pixels.set(accent, i);
          }
        }
      }
    }
    layers.push(part(right ? 'right-ear' : 'left-ear', pixels, { x: right ? 12 : 5, y: 7 }));
  }
  const accessory = appearance.parameters.accessory;
  if (accessory && accessory.type !== 'none') {
    const pixels = new Uint8ClampedArray(SIZE), base = color(accessory.color);
    const materials: Palette = {
      B: base, H: mix(base, [255, 255, 255, 255], 0.16), S: mix(base, [0, 0, 0, 255], 0.3),
      G: [226, 182, 91, 255],
    };
    if (accessory.type === 'collar') {
      stamp(pixels, 5, 19, ['SHHHHHHHS', 'SBBBBBBBS', '   GG    ', '   SS    '], materials);
    } else if (accessory.type === 'bandana') {
      stamp(pixels, 5, 19, ['SHHHHHHS ', 'SBBBBBSHB', ' SBBBS BS', '  SBS   S', '   S     '], materials);
    } else {
      throw new Error('Unknown cat accessory.');
    }
    layers.push({ id: 'body', attachment: 'accessory', pixels, padding: new Uint8ClampedArray(SIZE), bounds: bounds(pixels) });
  }
  const head = familyHead(palette);
  stamp(head, 6, 16, ['X'], palette);
  const face = faceLayers(appearance.parameters.expression?.type ?? 'neutral');
  const motionHead = part('head', head, { x: 9, y: 18 });
  layers.push(part('head', composite([head, ...face.map(layer => layer.pixels)]), { x: 9, y: 18 }));
  const source = composite(layers.map(layer => layer.pixels));
  const motionLayers = layers.map(layer => layer.id === 'head' ? motionHead : {
    ...layer, pixels: layer.pixels.slice(), padding: layer.padding.slice(), bounds: { ...layer.bounds },
  });
  return { source, layers, motion: { layers: motionLayers, face } };
}
