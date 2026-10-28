import FastNoiseLite from 'fastnoise-lite';
import type { Point, Ramp, Rectangle, TerrainKind, World } from './contracts';
import { seededRandom } from './random';
import { referenceWorld, type PackedWorld, type PackedRelief } from './reference-worlds';
import references from '../fixtures/packed-worlds.json';

export const WIDTH = 128;
export const HEIGHT = 96;
export const TILE_SIZE = 4;
export const SEA_LEVEL = 0;
export const BEACH_LEVEL = 0.12;
export const SHALLOW_LEVEL = -0.20;
export const CLIFF_DEPTH = 5;
export const GENERATOR_VERSION = 'browser-opensimplex2s-mulberry32-coast-v1';
export const ISLAND_GENERATOR_VERSION = 'browser-seeded-highlands-v2';
const BORDER = 6;
const SIZE = WIDTH * HEIGHT;
const CARDINAL: readonly Point[] = [
  { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 },
];
const NEIGHBORS: readonly Point[] = [
  ...CARDINAL, { x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: 1, y: 1 },
];

const BASELINES = new Map<number, PackedWorld>(references.base.map(source => [source.seed, source]));
const RELIEF = new Map<number, PackedRelief>(references.relief.map(source => [source.seed, source]));

export function generateWorld(seed: number, options: { relief?: boolean } = {}): World {
  if (!Number.isInteger(seed) || seed < 0 || seed > 999999) {
    throw new RangeError('World seed must be an integer from 0 through 999999.');
  }
  const baseline = BASELINES.get(seed);
  const relief = options.relief ? RELIEF.get(seed) : undefined;
  if (baseline && (!options.relief || relief)) return referenceWorld(baseline, relief);
  // Seed 43 retains its exact baseline even when adding browser-generated relief.
  const world = baseline ? referenceWorld(baseline) : generateTerrain(seed);
  if (options.relief) {
    addRelief(world);
    world.generatorVersion = `${GENERATOR_VERSION}-relief-v1${baseline ? '-reference-terrain' : ''}`;
    world.provenance = 'browser-generated';
  }
  return world;
}

export function generateIslandWorld(seed: number): World {
  const world = generateWorld(seed);
  const shore = coastDistance(world.cells);
  for (let variation = 0; variation < 24; variation++) {
    const levels = islandReliefLevels(world, shore, variation);
    if (!connectRelief(world, levels, variation)) continue;
    world.generatorVersion = `${ISLAND_GENERATOR_VERSION}${BASELINES.has(seed) ? '-reference-coast' : ''}`;
    world.provenance = 'browser-generated';
    return world;
  }
  throw new Error(`Seeded highlands could not connect island elevations for seed ${seed} after 24 variations.`);
}

export function inBounds(world: World, cell: Point): boolean {
  return Number.isInteger(cell.x) && Number.isInteger(cell.y)
    && cell.x >= 0 && cell.y >= 0 && cell.x < world.width && cell.y < world.height;
}

export function terrainAt(world: World, cell: Point): TerrainKind {
  if (!inBounds(world, cell)) return 'deep';
  const height = world.heights[cell.y * world.width + cell.x] - world.seaLevel;
  return height > BEACH_LEVEL ? 'grass' : height > 0 ? 'sand'
    : height > SHALLOW_LEVEL ? 'shallow' : 'deep';
}

export function cellAt(world: World, point: Point): Point {
  return { x: Math.floor(point.x / world.tileSize), y: Math.floor(point.y / world.tileSize) };
}

export function cellCenter(world: World, cell: Point): Point {
  return { x: (cell.x + 0.5) * world.tileSize, y: (cell.y + 0.5) * world.tileSize };
}

export function isCoastalCliff(world: World, cell: Point): boolean {
  if (terrainAt(world, cell) !== 'grass') return false;
  const below = { x: cell.x, y: cell.y + 1 };
  return !inBounds(world, below)
    || world.heights[below.y * world.width + below.x] <= world.seaLevel;
}

export function getWorldBounds(world: World): Rectangle {
  return { x: 0, y: 0, width: world.width * world.tileSize, height: world.height * world.tileSize };
}

export function makeNavigationFixture(): World {
  const width = 32, height = 24;
  const heights = new Float32Array(width * height).fill(-0.7);
  for (let y = 2; y <= 21; y++) {
    for (let x = 2; x <= 29; x++) {
      heights[y * width + x] = x <= 3 || x >= 28 || y <= 3 || y >= 20 ? 0.06 : 0.35;
    }
  }
  // Authored deep barrier, shallow crossing, and a dry detour around its north end.
  for (let y = 7; y <= 19; y++) heights[y * width + 16] = -0.7;
  for (let y = 11; y <= 14; y++) {
    for (let x = 12; x <= 20; x++) heights[y * width + x] = -0.1;
    heights[y * width + 11] = 0.06;
    heights[y * width + 21] = 0.06;
  }
  for (let y = 17; y <= 19; y++) {
    for (let x = 24; x <= 26; x++) heights[y * width + x] = -0.7;
  }
  return {
    seed: 0, generatorVersion: 'authored-navigation-v1', provenance: 'test-fixture',
    width, height, tileSize: TILE_SIZE, seaLevel: SEA_LEVEL, heights,
    cells: Uint8Array.from(heights, value => Number(value > SEA_LEVEL)),
  };
}

function noise(seed: number, frequency: number): FastNoiseLite {
  const result = new FastNoiseLite(seed & 0x7fffffff);
  result.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2S);
  result.SetFractalType(FastNoiseLite.FractalType.None);
  result.SetFrequency(frequency);
  return result;
}

function generateTerrain(seed: number): World {
  for (let attempt = 0; attempt < 32; attempt++) {
    let heights = candidate(seed, attempt);
    heights = smooth(smooth(heights));
    const cells = largestRegion(Uint8Array.from(heights, value => Number(value > 0)));
    fillLakes(cells);
    const count = cells.reduce((sum, value) => sum + value, 0);
    if (count < 1800 || count > 7600) continue;
    for (let i = 0; i < SIZE; i++) {
      if (cells[i] && heights[i] <= 0) heights[i] = 0.02;
      else if (!cells[i] && heights[i] > 0) heights[i] = -0.22;
    }
    conditionCoast(heights, cells, seed);
    return {
      seed, generatorVersion: GENERATOR_VERSION, provenance: 'browser-generated',
      width: WIDTH, height: HEIGHT, tileSize: TILE_SIZE, seaLevel: SEA_LEVEL, heights, cells,
    };
  }
  throw new Error(`Island generation exhausted 32 attempts for seed ${seed}.`);
}

function candidate(seed: number, attempt: number): Float32Array {
  const terrainSeed = (seed ^ (attempt * 104729)) & 0x7fffffff;
  const rng = seededRandom(terrainSeed);
  const range = (low: number, high: number) => low + rng() * (high - low);
  const broad = noise(terrainSeed, 0.011);
  const landforms = noise(terrainSeed ^ 0x68bc21eb, 0.0225);
  const detail = noise(terrainSeed ^ 0x02e5be93, 0.055);
  const offset = { x: range(100, 1000) * 2, y: range(100, 1000) * 2 };
  const center = { x: (WIDTH - 1) * 0.5 + range(-10, 10), y: (HEIGHT - 1) * 0.5 + range(-6, 6) };
  const radius = { x: WIDTH * range(0.30, 0.47), y: HEIGHT * range(0.28, 0.50) };
  const angle = range(-0.85, 0.85), bias = range(-0.08, 0.08);
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  const heights = new Float32Array(SIZE);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const dx = x - center.x, dy = y - center.y;
      const rx = (dx * cosine - dy * sine) / radius.x;
      const ry = (dx * sine + dy * cosine) / radius.y;
      const px = x + offset.x, py = y + offset.y;
      heights[y * WIDTH + x] = rim(x, y) ? -0.7 : (1 - rx * rx - ry * ry) * 0.9
        + broad.GetNoise(px, py) * 1.30 + landforms.GetNoise(px, py) * 0.62
        + detail.GetNoise(px, py) * 0.10 - 0.32 + bias;
    }
  }
  let highest = -Infinity;
  for (let x = BORDER; x < WIDTH - BORDER; x++) {
    highest = Math.max(highest, heights[BORDER * WIDTH + x], heights[(HEIGHT - BORDER - 1) * WIDTH + x]);
  }
  for (let y = BORDER; y < HEIGHT - BORDER; y++) {
    highest = Math.max(highest, heights[y * WIDTH + BORDER], heights[y * WIDTH + WIDTH - BORDER - 1]);
  }
  const shift = Math.max(0, highest + 0.08);
  for (let i = 0; i < SIZE; i++) heights[i] -= shift;
  return heights;
}

function smooth(source: Float32Array): Float32Array {
  const result = source.slice();
  for (let y = BORDER; y < HEIGHT - BORDER; y++) {
    for (let x = BORDER; x < WIDTH - BORDER; x++) {
      const i = y * WIDTH + x;
      let count = 0;
      for (const d of NEIGHBORS) count += Number(source[i + d.y * WIDTH + d.x] > 0);
      if (source[i] > 0 && count < 3) result[i] = -0.02;
      else if (source[i] <= 0 && count >= 5) result[i] = 0.02;
    }
  }
  return result;
}

function adjacent(index: number, directions: readonly Point[]): number[] {
  const x = index % WIDTH, y = Math.floor(index / WIDTH);
  return directions.filter(d => x + d.x >= 0 && x + d.x < WIDTH && y + d.y >= 0 && y + d.y < HEIGHT)
    .map(d => index + d.y * WIDTH + d.x);
}

function regions(mask: Uint8Array, accept?: (from: number, to: number) => boolean): number[][] {
  const visited = new Uint8Array(SIZE);
  const result: number[][] = [];
  for (let i = 0; i < SIZE; i++) {
    if (!mask[i] || visited[i]) continue;
    const queue = [i];
    visited[i] = 1;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      for (const next of adjacent(queue[cursor], CARDINAL)) {
        if (mask[next] && !visited[next] && (!accept || accept(queue[cursor], next))) {
          visited[next] = 1;
          queue.push(next);
        }
      }
    }
    result.push(queue);
  }
  return result;
}

function largestRegion(mask: Uint8Array): Uint8Array {
  const largest = regions(mask).reduce<number[]>((best, region) => region.length > best.length ? region : best, []);
  const result = new Uint8Array(SIZE);
  for (const index of largest) result[index] = 1;
  return result;
}

function fillLakes(mask: Uint8Array): void {
  const ocean = new Uint8Array(SIZE);
  const queue = [0];
  ocean[0] = 1;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    for (const next of adjacent(queue[cursor], NEIGHBORS)) {
      if (!mask[next] && !ocean[next]) { ocean[next] = 1; queue.push(next); }
    }
  }
  for (let i = 0; i < SIZE; i++) if (!ocean[i]) mask[i] = 1;
}

function coastDistance(mask: Uint8Array): Int32Array {
  const distance = new Int32Array(SIZE).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < SIZE; i++) {
    if (adjacent(i, NEIGHBORS).some(next => mask[next] !== mask[i])) {
      distance[i] = 1;
      queue.push(i);
    }
  }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const i = queue[cursor];
    for (const next of adjacent(i, NEIGHBORS)) {
      if (distance[next] < 0 && mask[next] === mask[i]) {
        distance[next] = distance[i] + 1;
        queue.push(next);
      }
    }
  }
  return distance;
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const lerp = (from: number, to: number, weight: number) => from + (to - from) * weight;
function smoothstep(low: number, high: number, value: number): number {
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
}
function rim(x: number, y: number): boolean {
  return x < BORDER || x >= WIDTH - BORDER || y < BORDER || y >= HEIGHT - BORDER;
}

function waterFraction(mask: Uint8Array, x: number, y: number): number {
  let water = 0, total = 0;
  for (let dy = -12; dy <= 12; dy++) {
    for (let dx = -12; dx <= 12; dx++) {
      if (dx * dx + dy * dy > 144) continue;
      total++;
      if (x + dx < 0 || x + dx >= WIDTH || y + dy < 0 || y + dy >= HEIGHT
        || !mask[(y + dy) * WIDTH + x + dx]) water++;
    }
  }
  return water / total;
}

function conditionCoast(heights: Float32Array, cells: Uint8Array, seed: number): void {
  const distance = coastDistance(cells), rhythm = noise(seed ^ 0x5bd1e995, 0.025);
  const steepness = new Float32Array(SIZE);
  for (let ring = 1; ring <= 12; ring++) {
    for (let i = 0; i < SIZE; i++) {
      if (!cells[i] || distance[i] !== ring) continue;
      const x = i % WIDTH, y = Math.floor(i / WIDTH);
      if (ring === 1) {
        steepness[i] = clamp(smoothstep(0.36, 0.58, waterFraction(cells, x, y))
          + rhythm.GetNoise(x, y) * 0.55, 0, 1);
      } else {
        const previous = adjacent(i, NEIGHBORS).filter(next => cells[next] && distance[next] === ring - 1);
        steepness[i] = previous.reduce((sum, next) => sum + steepness[next], 0) / Math.max(previous.length, 1);
      }
    }
    if (ring !== 1) continue;
    const source = steepness.slice();
    for (let i = 0; i < SIZE; i++) {
      if (!cells[i] || distance[i] !== 1) continue;
      const x = i % WIDTH, y = Math.floor(i / WIDTH);
      let total = 0, count = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const next = (y + dy) * WIDTH + x + dx;
          if (x + dx >= 0 && x + dx < WIDTH && y + dy >= 0 && y + dy < HEIGHT
            && cells[next] && distance[next] === 1) { total += source[next]; count++; }
        }
      }
      steepness[i] = total / count;
    }
  }
  for (let i = 0; i < SIZE; i++) {
    const d = distance[i], x = i % WIDTH, y = Math.floor(i / WIDTH);
    if (cells[i]) {
      heights[i] = d > 12 ? Math.max(heights[i], 0.16)
        : lerp(Math.max(0.02, (d + 1) * lerp(0.016, 0.10, steepness[i])),
          Math.max(heights[i], 0.16), smoothstep(6, 12, d));
    } else if (rim(x, y) || d > 6) heights[i] = Math.min(heights[i], -0.22);
    else heights[i] = -d * lerp(0.11, 0.06, 1 - smoothstep(0.55, 0.80, waterFraction(cells, x, y))) / 2;
  }
}

function cleanMask(mask: Uint8Array, minimum: number): Uint8Array {
  for (let pass = 0; pass < 3; pass++) {
    const source = mask.slice();
    for (let y = 1; y < HEIGHT - 1; y++) {
      for (let x = 1; x < WIDTH - 1; x++) {
        const i = y * WIDTH + x;
        if (source[i] + adjacent(i, NEIGHBORS).reduce((sum, next) => sum + source[next], 0) < 5) mask[i] = 0;
      }
    }
  }
  for (const region of regions(mask)) if (region.length < minimum) for (const i of region) mask[i] = 0;
  return mask;
}

function reliefLevels(world: World, shore: Int32Array, variation: number): Uint8Array {
  const seed = (world.seed ^ (variation * 104729) ^ 0x631bfa) & 0x7fffffff;
  const broad = noise(seed, 0.027), detail = noise(seed ^ 0x39f12, 0.061);
  const field = Float32Array.from({ length: SIZE }, (_, i) =>
    broad.GetNoise(i % WIDTH, Math.floor(i / WIDTH)) + detail.GetNoise(i % WIDTH, Math.floor(i / WIDTH)) * 0.22);
  const samples = Array.from(field).filter((_, i) => world.cells[i] && shore[i] >= 5).sort((a, b) => a - b);
  if (!samples.length) return new Uint8Array(SIZE);
  const middleThreshold = samples[Math.floor(samples.length * 0.36)];
  const highThreshold = samples[Math.floor(samples.length * 0.73)];
  const middle = cleanMask(Uint8Array.from(field, (value, i) =>
    Number(world.heights[i] > 0.12 && shore[i] >= 5 && value >= middleThreshold)), 100);
  const interior = new Int32Array(SIZE).fill(-1), queue: number[] = [];
  for (let i = 0; i < SIZE; i++) if (!middle[i]) { interior[i] = 0; queue.push(i); }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    for (const next of adjacent(queue[cursor], NEIGHBORS)) {
      if (interior[next] < 0) { interior[next] = interior[queue[cursor]] + 1; queue.push(next); }
    }
  }
  const high = cleanMask(Uint8Array.from(field, (value, i) =>
    Number(middle[i] && interior[i] >= 6 && value >= highThreshold)), 40);
  return Uint8Array.from(middle, (value, i) => high[i] ? 2 : value);
}

function islandReliefLevels(world: World, shore: Int32Array, variation: number): Uint8Array {
  // Large-scale choices stay fixed across connectivity retries; only edge detail changes.
  const rng = seededRandom(world.seed ^ 0x714a3f29);
  const extent = rng();
  const coverage = extent < 0.12 ? 0 : lerp(0.10, 0.62, (extent - 0.12) / 0.88);
  if (!coverage) return new Uint8Array(SIZE);
  const summit = rng();
  const highShare = summit < 0.30 ? 0 : lerp(0.15, 0.50, (summit - 0.30) / 0.70);
  const eligible: number[] = [];
  for (let i = 0; i < SIZE; i++) {
    if (world.heights[i] > BEACH_LEVEL && shore[i] >= 5) eligible.push(i);
  }
  if (!eligible.length) throw new Error(`Seed ${world.seed} has no interior for its highlands.`);
  const xs = eligible.map(i => i % WIDTH), ys = eligible.map(i => Math.floor(i / WIDTH));
  const spanX = Math.max(...xs) - Math.min(...xs) + 1;
  const spanY = Math.max(...ys) - Math.min(...ys) + 1;
  const masses = Array.from({ length: 1 + Math.floor(rng() * 3) }, () => {
    const anchor = eligible[Math.floor(rng() * eligible.length)];
    const angle = rng() * Math.PI * 2;
    return {
      x: anchor % WIDTH, y: Math.floor(anchor / WIDTH),
      cosine: Math.cos(angle), sine: Math.sin(angle),
      major: Math.max(spanX, spanY) * lerp(0.22, 0.65, rng()),
      minor: Math.min(spanX, spanY) * lerp(0.16, 0.40, rng()),
      height: lerp(0.85, 1.15, rng()),
    };
  });
  const seed = (world.seed ^ (variation * 104729) ^ 0x25b7e1) & 0x7fffffff;
  const broad = noise(seed, 0.035), detail = noise(seed ^ 0x39f12, 0.075);
  const field = Float32Array.from({ length: SIZE }, (_, i) => {
    const x = i % WIDTH, y = Math.floor(i / WIDTH);
    let height = -Infinity;
    for (const mass of masses) {
      const dx = x - mass.x, dy = y - mass.y;
      const along = (dx * mass.cosine + dy * mass.sine) / mass.major;
      const across = (-dx * mass.sine + dy * mass.cosine) / mass.minor;
      height = Math.max(height, mass.height - along * along - across * across);
    }
    return height + broad.GetNoise(x, y) * 0.20 + detail.GetNoise(x, y) * 0.04;
  });
  if (!field.every(Number.isFinite)) throw new Error(`Seed ${world.seed} produced invalid highland heights.`);
  const samples = eligible.map(i => field[i]).sort((a, b) => a - b);
  const middleThreshold = samples[Math.floor(samples.length * (1 - coverage))];
  const middle = cleanMask(Uint8Array.from(field, (value, i) =>
    Number(world.heights[i] > BEACH_LEVEL && shore[i] >= 5 && value >= middleThreshold)), 100);
  const interior = coastDistance(middle);
  const highThreshold = highShare ? samples[Math.floor(samples.length * (1 - coverage * highShare))] : Infinity;
  const high = cleanMask(Uint8Array.from(field, (value, i) =>
    Number(middle[i] && interior[i] >= 5 && value >= highThreshold)), 40);
  return Uint8Array.from(middle, (value, i) => high[i] ? 2 : value);
}

function addRelief(world: World): void {
  const shore = coastDistance(world.cells);
  for (let variation = 0; variation < 12; variation++) {
    const levels = reliefLevels(world, shore, variation);
    if (levels.filter(level => level === 1).length < 100 || levels.filter(level => level === 2).length < 40) continue;
    if (connectRelief(world, levels, variation)) return;
  }
  throw new Error(`Relief generation could not connect island elevations for seed ${world.seed} after 12 variations.`);
}

function connectRelief(world: World, levels: Uint8Array, variation: number): boolean {
  const walls = new Uint8Array(SIZE);
  for (let i = 0; i < SIZE - WIDTH; i++) {
    const depth = 2 * (levels[i] - levels[i + WIDTH]);
    for (let d = 1; d <= depth && i + d * WIDTH < SIZE; d++) {
      const next = i + d * WIDTH;
      if (world.cells[next] && levels[next] < levels[i]) walls[next] = 1;
    }
  }
  const areas = regions(Uint8Array.from(world.cells, (land, i) => Number(land && !walls[i])),
    (from, to) => levels[from] === levels[to]);
  const ids = new Int32Array(SIZE).fill(-1);
  areas.forEach((area, id) => { for (const i of area) ids[i] = id; });
  const candidates = rampCandidates(world, levels);
  const rng = seededRandom(world.seed ^ (variation * 7919) ^ 0x137a49);
  const ranked = candidates.map(ramp => ({
    ramp, score: rng() + Number(ramp.direction.y === 1) + ramp.rect.width * ramp.rect.height * 0.02,
  })).sort((a, b) => b.score - a.score);
  const parents = areas.map((_, i) => i);
  const root = (id: number): number => { while (parents[id] !== id) id = parents[id]; return id; };
  const rampIds = new Int32Array(SIZE).fill(-1), ramps: Ramp[] = [];
  let joins = 0;
  for (const { ramp } of ranked) {
    const upper = ids[ramp.highCell.y * WIDTH + ramp.highCell.x];
    const lower = ids[ramp.lowCell.y * WIDTH + ramp.lowCell.x];
    if (upper < 0 || lower < 0 || root(upper) === root(lower)) continue;
    if (ramps.some(other => rectanglesOverlap(ramp.rect, other.rect, 1))) continue;
    for (let y = ramp.rect.y; y < ramp.rect.y + ramp.rect.height; y++) {
      for (let x = ramp.rect.x; x < ramp.rect.x + ramp.rect.width; x++) {
        const i = y * WIDTH + x, area = ids[i];
        rampIds[i] = ramps.length;
        walls[i] = 0;
        if (area >= 0 && root(upper) !== root(area)) { parents[root(area)] = root(upper); joins++; }
      }
    }
    ramps.push(ramp);
  }
  if (joins !== areas.length - 1) return false;
  world.elevations = levels;
  world.cliffCells = walls;
  world.rampIds = rampIds;
  world.ramps = ramps;
  return true;
}

function rectanglesOverlap(a: Rectangle, b: Rectangle, grow: number): boolean {
  return a.x - grow < b.x + b.width && a.x + a.width + grow > b.x
    && a.y - grow < b.y + b.height && a.y + a.height + grow > b.y;
}

function rampCandidates(world: World, levels: Uint8Array): Ramp[] {
  const result: Ramp[] = [];
  const directions = [{ x: 0, y: 1 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
  for (let i = 0; i < SIZE; i++) {
    if (!levels[i]) continue;
    const cell = { x: i % WIDTH, y: Math.floor(i / WIDTH) };
    for (const direction of directions) {
      const next = { x: cell.x + direction.x, y: cell.y + direction.y };
      if (!inBounds(world, next) || levels[next.y * WIDTH + next.x] !== levels[i] - 1) continue;
      const side = { x: -direction.y, y: direction.x };
      for (const radius of [2, 1]) {
        let valid = true;
        for (let along = -2; along <= 4 && valid; along++) {
          for (let across = -radius; across <= radius; across++) {
            const p = { x: cell.x + direction.x * along + side.x * across,
              y: cell.y + direction.y * along + side.y * across };
            if (!inBounds(world, p) || world.heights[p.y * WIDTH + p.x] <= 0.12
              || levels[p.y * WIDTH + p.x] !== levels[i] - Number(along > 0)) { valid = false; break; }
          }
        }
        if (!valid) continue;
        const first = { x: cell.x - direction.x * 2 - side.x * radius, y: cell.y - direction.y * 2 - side.y * radius };
        const last = { x: cell.x + direction.x * 4 + side.x * radius, y: cell.y + direction.y * 4 + side.y * radius };
        result.push({
          rect: { x: Math.min(first.x, last.x), y: Math.min(first.y, last.y),
            width: Math.abs(last.x - first.x) + 1, height: Math.abs(last.y - first.y) + 1 },
          upperLevel: levels[i], lowerLevel: levels[i] - 1, direction,
          highCell: { x: cell.x - direction.x * 2, y: cell.y - direction.y * 2 },
          lowCell: { x: cell.x + direction.x * 4, y: cell.y + direction.y * 4 },
        });
        break;
      }
    }
  }
  return result;
}
