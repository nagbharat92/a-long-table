import type { Ramp, World } from './contracts';

export interface PackedWorld {
  seed: number;
  generatorVersion: string;
  width: number;
  height: number;
  tileSize: number;
  seaLevel: number;
  heights: string;
  cells: string;
}

export interface PackedRelief {
  seed: number;
  generatorVersion: string;
  elevations: string;
  cliffCells: string;
  rampIds: number[][];
  ramps: Ramp[];
}

function decodeBytes(encoded: string, length: number): Uint8Array {
  const binary = atob(encoded);
  if (binary.length !== length) throw new Error('Reference data has an invalid byte length.');
  return Uint8Array.from(binary, value => value.charCodeAt(0));
}

function decodeBits(encoded: string, count: number, bits: number): Uint8Array {
  const bytes = decodeBytes(encoded, Math.ceil(count * bits / 8));
  const result = new Uint8Array(count);
  const mask = (1 << bits) - 1;
  for (let index = 0; index < count; index++) {
    result[index] = (bytes[Math.floor(index * bits / 8)] >> (index * bits % 8)) & mask;
  }
  return result;
}

export function referenceWorld(source: PackedWorld, relief?: PackedRelief): World {
  const size = source.width * source.height;
  const bytes = decodeBytes(source.heights, size * 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const heights = new Float32Array(size);
  for (let index = 0; index < size; index++) {
    const value = view.getFloat32(index * 4, true);
    if (!Number.isFinite(value)) throw new Error('Reference data contains a non-finite height.');
    heights[index] = value;
  }
  const world: World = {
    seed: source.seed, generatorVersion: relief?.generatorVersion ?? source.generatorVersion,
    width: source.width, height: source.height, tileSize: source.tileSize,
    seaLevel: source.seaLevel, provenance: 'captured-reference',
    heights, cells: decodeBits(source.cells, size, 1),
  };
  if (relief) {
    if (relief.seed !== source.seed) throw new Error('Relief does not match its reference terrain.');
    world.elevations = decodeBits(relief.elevations, size, 2);
    world.cliffCells = decodeBits(relief.cliffCells, size, 1);
    world.rampIds = new Int32Array(size).fill(-1);
    for (const entry of relief.rampIds) {
      const [index, id] = entry;
      if (entry.length !== 2 || !Number.isInteger(index) || index < 0 || index >= size
        || !Number.isInteger(id) || id < 0 || id >= relief.ramps.length) {
        throw new Error('Reference data contains an invalid ramp cell.');
      }
      world.rampIds[index] = id;
    }
    world.ramps = structuredClone(relief.ramps);
  }
  return world;
}
