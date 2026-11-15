export type IslandMaterial = 'turf' | 'meadow' | 'moss' | 'earth' | 'dry-sand' | 'wet-sand' | 'rock' | 'soil';
export type TextureColor = readonly [number, number, number];

const color = (r: number, g: number, b: number): TextureColor => Object.freeze([r, g, b] as const);

export const MATERIAL_COLORS: Record<IslandMaterial, TextureColor> = Object.freeze({
  turf: color(111, 157, 72),
  meadow: color(155, 183, 87),
  moss: color(65, 117, 78),
  earth: color(164, 126, 82),
  'dry-sand': color(226, 205, 151),
  'wet-sand': color(162, 153, 111),
  rock: color(150, 143, 122),
  soil: color(132, 104, 72),
});

/** Palette index zero is the broad, uninterrupted material base. */
export const MATERIAL_PALETTES: Record<IslandMaterial, readonly TextureColor[]> = Object.freeze({
  turf: Object.freeze([MATERIAL_COLORS.turf, color(102, 148, 65), color(123, 167, 80), color(94, 139, 62), color(132, 172, 87)]),
  meadow: Object.freeze([MATERIAL_COLORS.meadow, color(145, 173, 79), color(167, 192, 97), color(137, 163, 74), color(176, 198, 104)]),
  moss: Object.freeze([MATERIAL_COLORS.moss, color(58, 108, 72), color(76, 128, 84), color(53, 100, 68), color(84, 134, 90)]),
  earth: Object.freeze([MATERIAL_COLORS.earth, color(154, 117, 76), color(175, 136, 91), color(145, 109, 71), color(182, 143, 98)]),
  'dry-sand': Object.freeze([MATERIAL_COLORS['dry-sand'], color(216, 195, 141), color(235, 214, 162), color(207, 187, 135), color(240, 219, 169)]),
  'wet-sand': Object.freeze([MATERIAL_COLORS['wet-sand'], color(153, 144, 104), color(173, 163, 121), color(144, 136, 98), color(180, 170, 127)]),
  rock: Object.freeze([MATERIAL_COLORS.rock, color(141, 134, 114), color(160, 153, 132), color(132, 125, 106), color(168, 160, 138)]),
  soil: Object.freeze([MATERIAL_COLORS.soil, color(123, 96, 66), color(143, 114, 80), color(114, 88, 61), color(150, 120, 85)]),
});

/** One texel per world unit; nearest-neighbor sampling repeats every 256 units. */
export const ISLAND_TEXTURE_SIZE = 256;
export const ISLAND_TEXTURE_TEXEL_WORLD_SIZE = 1;
const materials = Object.keys(MATERIAL_COLORS) as IslandMaterial[];
const wrap = (pixel: number) => ((pixel % ISLAND_TEXTURE_SIZE) + ISLAND_TEXTURE_SIZE) % ISLAND_TEXTURE_SIZE;
const texelIndex = (coordinate: number) => {
  const texel = coordinate / ISLAND_TEXTURE_TEXEL_WORLD_SIZE;
  const nearest = Math.round(texel);
  // Equivalent triangle interpolations can straddle an exact pixel boundary.
  return wrap(Math.floor(Math.abs(texel - nearest) <= 1e-8 ? nearest : texel));
};

function randomSource(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function generateTexture(material: IslandMaterial, seed: number): Uint8Array {
  const pixels = new Uint8Array(ISLAND_TEXTURE_SIZE * ISLAND_TEXTURE_SIZE);
  const random = randomSource(seed);
  const integer = (limit: number) => Math.floor(random() * limit);
  const put = (x: number, y: number, ink: number) => {
    pixels[wrap(y) * ISLAND_TEXTURE_SIZE + wrap(x)] = ink;
  };
  const grass = material === 'turf' || material === 'meadow';
  const sand = material === 'dry-sand' || material === 'wet-sand';
  const stone = material === 'rock';
  const count = stone ? 210 : sand ? 460 : 650;

  for (let mark = 0; mark < count; mark++) {
    const x = integer(ISLAND_TEXTURE_SIZE), y = integer(ISLAND_TEXTURE_SIZE);
    const ink = 1 + integer(2);
    if (grass) {
      // Short bent blades in small tufts, not a per-pixel noise blanket.
      const direction = random() < 0.5 ? -1 : 1;
      const height = 2 + integer(3);
      for (let step = 0; step < height; step++) {
        if (step === height - 1) put(x, y - step, ink);
        put(x + (step === height - 1 ? direction : 0), y - step, ink);
      }
      if (random() < 0.45) {
        put(x + 2, y, ink);
        put(x + 2, y - 1, 3);
      }
      if (random() < 0.2) put(x + direction, y - height, 4);
    } else if (sand) {
      put(x, y, ink);
      put(x + 1, y, ink);
      if (random() < 0.4) put(x, y + 1, 3);
      if (random() < 0.2) put(x - 1, y, 4);
    } else {
      const width = stone ? 6 + integer(12) : 2 + integer(material === 'moss' ? 5 : 4);
      const height = stone ? 3 + integer(8) : 2 + integer(3);
      const lean = random() - 0.5;
      const cuts = Array.from({ length: height }, () => integer(2));
      for (let row = 0; row < height; row++) {
        const edge = Math.floor(Math.abs(row - (height - 1) / 2) * width / (height * 1.5));
        const offset = Math.floor(row * lean);
        for (let col = edge + cuts[row]; col < width - edge; col++) {
          put(x + col + offset, y + row, ink);
        }
      }
      // Broken, off-grid facets / compact earth flecks; no horizontal strata.
      if (random() < 0.45) {
        const length = stone ? 2 + integer(5) : 1 + integer(2);
        for (let step = 0; step < length; step++) {
          put(x + Math.floor(width / 2) + Math.floor(step / 2), y + step, 3);
        }
      }
      if (random() < 0.4) {
        put(x + Math.floor(width / 2), y, 4);
        put(x + Math.floor(width / 2) + 1, y, 4);
      }
    }
  }
  return pixels;
}

/**
 * Generates private palette-indexed tiles once per sampler, never per sample.
 * Seeds use their unsigned 32-bit representation. Returned colors are immutable
 * shared palette entries, so callers cannot corrupt later samples.
 */
export function createIslandTextures(seed: number): {
  sample(material: IslandMaterial, u: number, v: number): TextureColor;
} {
  if (!Number.isFinite(seed)) throw new RangeError('Texture seed must be finite');
  const tiles = new Map(materials.map((material, index) => [
    material,
    generateTexture(material, (seed >>> 0) ^ Math.imul(index + 1, 0x9e3779b1)),
  ]));
  return {
    sample(material, u, v) {
      if (!Number.isFinite(u) || !Number.isFinite(v)) throw new RangeError('Texture coordinates must be finite');
      const tile = tiles.get(material);
      if (!tile) throw new RangeError(`Unknown island material: ${material}`);
      const x = texelIndex(u);
      const y = texelIndex(v);
      return MATERIAL_PALETTES[material][tile[y * ISLAND_TEXTURE_SIZE + x]];
    },
  };
}
