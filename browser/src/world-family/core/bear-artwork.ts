import type { CharacterAppearance } from './character-appearance';
import type { CharacterArtwork } from './character-definition';
import type { CharacterExpressionType } from './character-expression';
import type { FaceFeature, FaceLayer } from './character-face';
import { RIG_WIDTH } from './character-rig';
import { bounds, color, composite, mix, part, SIZE, stamp, type Color, type Palette } from './authored-artwork';
import { familyBody, familyHead } from './family-artwork';

const INK: Color = [43, 29, 24, 255];
const NOSE: Color = [105, 55, 34, 255];

const EYES: Record<CharacterExpressionType, readonly [readonly string[], readonly string[]]> = {
  neutral: [['   ', ' # ', ' # '], ['   ', ' # ', ' # ']],
  happy: [[' # ', ' ##', '   '], [' # ', '# #', '   ']],
  sleepy: [['   ', ' ##', '   '], ['   ', '###', '   ']],
  curious: [[' # ', ' w#', ' ##'], ['   ', '   ', ' ##']],
};

function faceLayers(expression: CharacterExpressionType): FaceLayer[] {
  const drawing = EYES[expression];
  if (!drawing) throw new Error('Unknown bear expression.');
  const palette = { '#': INK, w: [255, 247, 224, 255] as Color, n: NOSE };
  const eyes = ([1, 10] as const).map((x, index): FaceLayer => {
    const pixels = new Uint8ClampedArray(SIZE), blink = new Uint8ClampedArray(SIZE);
    stamp(pixels, x, 12, drawing[index], palette);
    if (expression === 'curious' && index === 0) stamp(pixels, x + 2, 11, ['##'], palette);
    stamp(blink, x, 14, [index === 0 ? ' ##' : '###'], palette);
    const feature: FaceFeature = {
      id: index === 0 ? 'left-eye' : 'right-eye',
      pivot: { x: x + 1.5, y: 14.5 },
      regions: [{ x, y: 11, width: index === 0 ? 4 : 3, height: 4 }],
    };
    return { feature, pixels, blink };
  });
  const pixels = new Uint8ClampedArray(SIZE);
  stamp(pixels, 5, 15, ['nn'], palette);
  return [...eyes, {
    feature: { id: 'nose', pivot: { x: 6, y: 15.5 }, regions: [{ x: 5, y: 15, width: 2, height: 1 }] },
    pixels, blink: pixels.slice(),
  }];
}

/** Independently drawn, overlapping bear parts; no rabbit source pixels or partitioning. */
export function buildBearArtwork(appearance: CharacterAppearance): CharacterArtwork {
  const coat = color(appearance.parameters.color.coat);
  const shade = color(appearance.parameters.color.shade);
  const palette: Palette = {
    X: INK, c: coat, s: shade,
    h: mix(coat, [255, 239, 201, 255], 0.23),
    m: mix([255, 232, 191, 255], coat, 0.12),
    n: NOSE,
  };
  const layers = familyBody(palette);
  for (const right of [false, true]) {
    const pixels = new Uint8ClampedArray(SIZE);
    const x = right ? 11 : 3;
    stamp(pixels, x, 3, right ? [
      ' XXX ', 'XhccX', 'XccsX', ' XsX ', '  X  ',
    ] : [
      ' XX ', 'XccX', 'XcsX', ' XsX', '  X ',
    ], palette);
    const ears = appearance.parameters.ears;
    if (ears && ears.type !== 'plain') {
      const accent = color(ears.color);
      const marked = ears.type === 'both' || (ears.type === 'single' && !right);
      for (let y = 4; y <= 6; y++) {
        for (let dx = 1; dx <= 4; dx++) {
          const i = (y * RIG_WIDTH + x + dx) * 4;
          if (!pixels[i + 3] || INK.every((value, channel) => value === pixels[i + channel])) continue;
          const inner = ears.type === 'inner' && dx >= 2 && dx <= 3 && y === 5;
          if (marked || inner || (ears.type === 'tips' && y === 4)) pixels.set(accent, i);
        }
      }
    }
    layers.push(part(right ? 'right-ear' : 'left-ear', pixels, { x: right ? 13.5 : 5, y: 7 }));
  }
  const accessory = appearance.parameters.accessory;
  if (accessory && accessory.type !== 'none') {
    const pixels = new Uint8ClampedArray(SIZE), base = color(accessory.color);
    const materials: Palette = {
      B: base, H: mix(base, [255, 255, 255, 255], 0.18),
      S: mix(base, [0, 0, 0, 255], 0.35),
      D: [109, 76, 36, 255], G: [211, 166, 79, 255], L: [248, 220, 147, 255],
    };
    if (accessory.type === 'collar') {
      stamp(pixels, 5, 19, ['SHHHHHHHS', 'SBBBBBBBS', '   DD    ', '  LGGD   ', '   DD    '], materials);
    } else if (accessory.type === 'bandana') {
      stamp(pixels, 5, 19, ['SHHHHHHS ', 'SBBBBBSHB', ' SBBBS BS', '  SBS   S', '   S     '], materials);
    } else {
      throw new Error('Unknown bear accessory.');
    }
    layers.push({
      id: 'body', attachment: 'accessory', pixels,
      padding: new Uint8ClampedArray(SIZE), bounds: bounds(pixels),
    });
  }
  const head = familyHead(palette);
  stamp(head, 3, 14, [' mmmm ', 'mmmmmm', ' mmmm ', '  mn  '], palette);
  const face = faceLayers(appearance.parameters.expression?.type ?? 'neutral');
  const motionHead = part('head', head, { x: 9, y: 18 });
  layers.push(part('head', composite([head, ...face.map(layer => layer.pixels)]), { x: 9, y: 18 }));
  const source = composite(layers.map(layer => layer.pixels));
  const motionLayers = layers.map(layer => layer.id === 'head' ? motionHead : {
    ...layer, pixels: layer.pixels.slice(), padding: layer.padding.slice(), bounds: { ...layer.bounds },
  });
  return { source, layers, motion: { layers: motionLayers, face } };
}
