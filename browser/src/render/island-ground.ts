import type { World } from '../core/contracts';
import { seededRandom } from '../core/random';
import { terrainAt } from '../core/world';
import { createIslandGroundField, type GroundInfluences, type GroundSample } from './island-ground-field';

type Surface = Pick<CanvasRenderingContext2D, 'fillStyle' | 'fillRect'>;
export const ISLAND_GRASS_COLORS = ['#85cc49', '#99cf63', '#b5d982'] as const;
const COLORS = ['#85cc49', '#a8cf65', '#72ad59', '#c4b878'].map(color => {
  const value = Number.parseInt(color.slice(1), 16);
  return [value >> 16, (value >> 8) & 255, value & 255];
});

export function drawIslandGround(context: Surface, world: World, influences: GroundInfluences = {}): void {
  const tile = world.tileSize;
  const { width, height } = world;
  const materials = new Uint8Array(width * height);
  const interiors = new Uint8Array(width * height);
  const levelAt = (i: number) => world.elevations?.[i] ?? 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (world.cliffCells?.[i] || (world.rampIds?.[i] ?? -1) >= 0) continue;
      const kind = terrainAt(world, { x, y });
      materials[i] = kind === 'grass' ? 1 : kind === 'sand' ? 2 : 0;
    }
  }
  // Grass patches leave a full cell clear around edges, elevation changes, cliffs and stairs.
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if ([i - 1, i + 1, i - width, i + width].every(n =>
        materials[n] === materials[i] && levelAt(n) === levelAt(i))) interiors[i] = materials[i];
    }
  }
  const field = createIslandGroundField(world, influences);
  const paint = (x: number, y: number, w: number, h: number, color: string) => {
    context.fillStyle = color;
    context.fillRect(x, y, w, h);
  };
  const clear = (x: number, y: number, w: number, h: number, material: number, level: number) => {
    if (material === 2) {
      x -= 2;
      y -= 2;
      w += 4;
      h += 4;
    }
    if (x < 0 || y < 0 || x + w > width * tile || y + h > height * tile) return false;
    for (let cy = Math.floor(y / tile); cy <= Math.floor((y + h - 1) / tile); cy++) {
      for (let cx = Math.floor(x / tile); cx <= Math.floor((x + w - 1) / tile); cx++) {
        const i = cy * width + cx;
        if ((material === 2 ? materials[i] : interiors[i]) !== material || levelAt(i) !== level) return false;
      }
    }
    return true;
  };
  const pixelWidth = width * tile;
  const pixelHeight = height * tile;
  const edgeStrength = (x: number, y: number) => {
    const cx = Math.floor(x / tile);
    const cy = Math.floor(y / tile);
    let distance = tile * 2;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || interiors[ny * width + nx] === 1) continue;
        const px = Math.max(nx * tile, Math.min((nx + 1) * tile, x + 0.5));
        const py = Math.max(ny * tile, Math.min((ny + 1) * tile, y + 0.5));
        distance = Math.min(distance, Math.hypot(x + 0.5 - px, y + 0.5 - py));
      }
    }
    const t = distance / (tile * 2);
    return t * t * (3 - 2 * t);
  };
  const colorAt = (cover: number, level: number, tone = 0) => {
    const turf = Number.parseInt(ISLAND_GRASS_COLORS[level].slice(1), 16);
    return `#${[0, 1, 2].map(channel => {
      const base = COLORS[cover][channel];
      const lifted = cover === 0 ? (turf >> (16 - channel * 8)) & 255
        : base + (255 - base) * level * 0.12;
      return Math.max(0, Math.min(255, Math.round(lifted + tone * 120)))
        .toString(16).padStart(2, '0');
    }).join('')}`;
  };
  // Habitat chooses discrete materials, never intermediate muddy colors.
  const fieldWidth = Math.ceil(pixelWidth / 2) + 1;
  const samples: GroundSample[] = [];
  for (let y = 0; y <= Math.ceil(pixelHeight / 2); y++) {
    for (let x = 0; x < fieldWidth; x++) samples.push(field.sample(x * 2, y * 2));
  }
  const sampleAt = (x: number, y: number): GroundSample => {
    const left = Math.floor(x / 2);
    const top = Math.floor(y / 2);
    const a = samples[top * fieldWidth + left];
    const b = samples[top * fieldWidth + left + 1];
    const c = samples[(top + 1) * fieldWidth + left];
    const d = samples[(top + 1) * fieldWidth + left + 1];
    const tx = x % 2 / 2;
    const ty = y % 2 / 2;
    const mix = (key: keyof GroundSample) => (a[key] * (1 - tx) + b[key] * tx) * (1 - ty)
      + (c[key] * (1 - tx) + d[key] * tx) * ty;
    return {
      turf: mix('turf'), meadow: mix('meadow'), moss: mix('moss'), earth: mix('earth'),
      moisture: mix('moisture'), shelter: mix('shelter'), coast: mix('coast'),
      detail: mix('detail'), grain: mix('grain'),
    };
  };
  let covers = new Uint8Array(pixelWidth * pixelHeight);
  for (let y = 0; y < pixelHeight; y++) {
    for (let x = 0; x < pixelWidth; x++) {
      const cell = Math.floor(y / tile) * width + Math.floor(x / tile);
      if (interiors[cell] !== 1) continue;
      const sample = sampleAt(x, y);
      // Round patches away from the tile guard before it can clip them into square steps.
      const clearance = edgeStrength(x, y);
      covers[y * pixelWidth + x] = sample.earth * clearance > 0.18 ? 3
        : sample.moss * clearance > 0.24 ? 2 : sample.meadow * clearance > 0.37 ? 1 : 0;
    }
  }
  // A local majority removes teeth and pinholes without blurring the palette.
  for (let pass = 0; pass < 2; pass++) {
    const cleaned = covers.slice();
    for (let y = 2; y < pixelHeight - 2; y++) {
      for (let x = 2; x < pixelWidth - 2; x++) {
        const cell = Math.floor(y / tile) * width + Math.floor(x / tile);
        if (interiors[cell] !== 1) continue;
        const counts = [0, 0, 0, 0];
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const neighbor = Math.floor((y + dy) / tile) * width + Math.floor((x + dx) / tile);
            const cover = interiors[neighbor] === 1 && levelAt(neighbor) === levelAt(cell)
              ? covers[(y + dy) * pixelWidth + x + dx] : 0;
            counts[cover]++;
          }
        }
        const majority = counts.findIndex(count => count >= 13);
        if (majority >= 0) cleaned[y * pixelWidth + x] = majority;
      }
    }
    covers = cleaned;
  }
  for (let y = 0; y < pixelHeight; y++) {
    let start = 0;
    let previous = '';
    for (let x = 0; x <= pixelWidth; x++) {
      let color = '';
      const cell = Math.floor(y / tile) * width + Math.floor(x / tile);
      if (x < pixelWidth && interiors[cell] === 1) {
        const level = levelAt(cell);
        color = colorAt(covers[y * pixelWidth + x], level);
      }
      if (color === previous) continue;
      if (previous) paint(start, y, x - start, 1, previous);
      previous = color;
      start = x;
    }
  }
  const grassRandom = seededRandom(world.seed ^ 0x1af74d39);
  for (let gy = 4; gy < pixelHeight - 8; gy += 7) {
    for (let gx = 4; gx < pixelWidth - 8; gx += 7) {
      const x = gx + Math.floor(grassRandom() * 5);
      const y = gy + Math.floor(grassRandom() * 5);
      const choice = grassRandom();
      const sample = sampleAt(x, y);
      const level = levelAt(Math.floor(y / tile) * width + Math.floor(x / tile));
      if (!clear(x, y, 4, 4, 1, level)
        || choice > 0.18 + sample.meadow * 0.18 + sample.moss * 0.12) continue;
      const cover = covers[y * pixelWidth + x];
      if ([0, 1, 2, 3].some(dy =>
        [0, 1, 2, 3].some(dx => covers[(y + dy) * pixelWidth + x + dx] !== cover))) continue;
      const dark = colorAt(cover, level, -0.07);
      const light = colorAt(cover, level, 0.12);
      if (cover === 3) {
        paint(x, y + 2, 3, 1, dark);
        paint(x + 1, y + 3, 2, 1, light);
      } else if (cover === 2) {
        paint(x, y + 2, 3, 1, dark);
        paint(x, y + 1, 2, 1, light);
        if (choice < 0.08) paint(x + 3, y + 1, 1, 1, light);
      } else {
        paint(x, y + 3, 3, 1, dark);
        paint(x + 1, y + 1, 1, 2, light);
        if (choice < 0.1) paint(x + 3, y, 1, 2, light);
      }
    }
  }
  const random = seededRandom(world.seed ^ 0x2d97c57b);
  for (let gy = 0; gy < height * tile; gy += 8) {
    for (let gx = 0; gx < width * tile; gx += 8) {
      const value = Math.floor(random() * 4294967296);
      const x = gx + value % 8;
      const y = gy + (value >>> 8) % 8;
      const i = Math.floor(y / tile) * width + Math.floor(x / tile);
      const material = materials[i];
      const level = levelAt(i);
      if (material === 2) {
        const sample = sampleAt(x, y);
        const density = 0.25 + sample.detail * 0.24 + (1 - sample.coast) * 0.12;
        if ((value >>> 16) / 65536 > density) continue;
        const long = sample.detail > -0.1 && sample.coast < 0.95;
        const run = long && clear(x, y, 8, 4, 2, level) ? 3 : clear(x, y, 5, 4, 2, level) ? 2 : 0;
        if (run) {
          paint(x, y + 2, run, 1, '#d4bb76');
          paint(x + run, y + 1, run, 1, '#d4bb76');
          paint(x + run * 2, y, run - 1, 1, '#d4bb76');
          paint(x + 1, y + 3, run - 1, 1, '#f0d99a');
          paint(x + run + 1, y + 2, run, 1, '#f0d99a');
        }
      }
    }
  }
}
