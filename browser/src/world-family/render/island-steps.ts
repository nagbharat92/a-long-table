import type { Ramp, World } from '../core/contracts';
import { ISLAND_GRASS_COLORS } from './island-ground';
import { ISLAND_STEP_PALETTES } from './island-step-palette';

type Surface = Pick<CanvasRenderingContext2D, 'fillStyle' | 'fillRect'>;

const APPROACH = '#c4b878';

function variation(world: World, ramp: Ramp, a: number, b: number): number {
  let value = world.seed ^ Math.imul(ramp.highCell.x, 374761393) ^ Math.imul(ramp.highCell.y, 668265263)
    ^ Math.imul(a + 17, 1274126177) ^ Math.imul(b + 31, 1597334677);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return (value ^ (value >>> 16)) >>> 0;
}

export function islandStepRecipe(world: World, ramp: Ramp) {
  const hash = (a: number, b: number) => variation(world, ramp, a, b);
  const length = (Math.abs(ramp.lowCell.x - ramp.highCell.x)
    + Math.abs(ramp.lowCell.y - ramp.highCell.y) + 1) * world.tileSize;
  const width = (ramp.direction.x ? ramp.rect.height : ramp.rect.width) * world.tileSize;
  const variant = hash(0, 0) % ISLAND_STEP_PALETTES.length;
  const upperLanding = 2 + hash(1, 0) % 2;
  const lowerLanding = 2 + hash(2, 0) % 2;
  const count = Math.max(2, Math.round((length - upperLanding - lowerLanding) / 4));
  const depths = Array<number>(count).fill(3);
  for (let remaining = length - upperLanding - lowerLanding - count * 3; remaining > 0; remaining--) {
    depths[hash(remaining, 1) % count]++;
  }
  let along = upperLanding;
  const treads = depths.map((depth, step) => {
    const from = along;
    along += depth;
    const shift = ramp.direction.x ? Math.round(step * 2 / Math.max(1, count - 1)) : 0;
    const start = ramp.direction.x ? ramp.direction.x > 0 ? 1 + shift : 3 - shift : 1;
    const breadth = width - (ramp.direction.x ? 4 : 2);
    const left = start + Number(hash(step, 2) % 3 === 0);
    const right = start + breadth - Number(hash(step, 3) % 3 === 0);
    return { from, to: along, left, right };
  });
  return { variant, length, width, upperLanding, lowerLanding, treads };
}

export function drawIslandSteps(context: Surface, world: World, ramp: Ramp): void {
  const recipe = islandStepRecipe(world, ramp);
  const { variant, length, width, treads } = recipe;
  const palette = ISLAND_STEP_PALETTES[variant];
  const { direction: d } = ramp;
  const across = { x: -d.y, y: d.x };
  const origin = {
    x: (ramp.highCell.x + 0.5) * world.tileSize - d.x * world.tileSize / 2 - across.x * width / 2,
    y: (ramp.highCell.y + 0.5) * world.tileSize - d.y * world.tileSize / 2 - across.y * width / 2,
  };
  const point = (a: number, s: number) => ({
    x: Math.floor(origin.x + d.x * (a + 0.5) + across.x * (s + 0.5)),
    y: Math.floor(origin.y + d.y * (a + 0.5) + across.y * (s + 0.5)),
  });
  const paint = (a: number, s: number, color: string) => {
    const p = point(a, s);
    context.fillStyle = color;
    context.fillRect(p.x, p.y, 1, 1);
  };
  const hash = (a: number, b: number) => variation(world, ramp, a, b);
  const clearGround = (a: number, s: number, level: number) => {
    const p = point(a, s);
    const x = Math.floor(p.x / world.tileSize), y = Math.floor(p.y / world.tileSize);
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return false;
    const i = y * world.width + x;
    return Boolean(world.cells[i]) && world.heights[i] > world.seaLevel && !world.cliffCells?.[i]
      && (world.rampIds?.[i] ?? -1) < 0 && world.elevations?.[i] === level;
  };

  // The contour pass supplies the actual turf and cliff strata beneath the cut.
  treads.forEach((tread, step) => {
    const { from, to, left, right } = tread;
    for (let a = from; a < to; a++) {
      if (d.x) {
        const bankStart = d.x > 0 ? right : 0;
        const bankEnd = d.x > 0 ? width : left;
        for (let s = bankStart; s < bankEnd; s++) {
          const southEdge = d.x > 0 ? s === width - 1 : s === 0;
          paint(a, s, southEdge ? '#715737' : (a + step) % 5 < 2 ? '#d0ae7a' : '#b28b60');
        }
      }
      for (let s = left; s < right; s++) {
        const edge = s === left || s === right - 1;
        const chipped = edge && (a === from || a === to - 1) && hash(step, s) % 3 === 0;
        if (chipped) {
          paint(a, s, palette.grain);
          continue;
        }
        let color: string = palette.top;
        const lipStart = left + 1 + hash(step, 4) % 3;
        const lipEnd = right - 1 - hash(step, 5) % 2;
        if (a === from && s >= lipStart && s < lipEnd) color = palette.light;
        if (a === to - 1 && s > left && s < right - 1) {
          color = d.y < 0 ? palette.grain : palette.seam;
          if (s === left + 2 + hash(step, 6) % Math.max(1, right - left - 3)) color = palette.grain;
        }
        if (a > from && a < to - 1 && s === left + 1 + hash(step, 7) % Math.max(1, right - left - 2)
          && a === from + 1) color = palette.grain;
        // Horizontal flights catch light on their screen-top edge, not every vertical seam.
        if (d.x && s === (d.x > 0 ? left : right - 1) && a < to - 1) color = palette.light;
        paint(a, s, color);
      }
    }
    // Grass encroaches from a real same-level shoulder, never from a cliff or the earthen bank.
    for (const side of [-1, 1]) {
      if (d.x && (d.x > 0 ? side === 1 : side === -1)) continue;
      const s = side < 0 ? left : right - 1;
      if (s >= width / 2 - 1 && s <= width / 2 + 1) continue;
      const a = from + 1 + hash(step, 8) % Math.max(1, to - from - 1);
      const level = world.elevations?.[Math.floor(point(a, side < 0 ? -1 : width).y / world.tileSize)
        * world.width + Math.floor(point(a, side < 0 ? -1 : width).x / world.tileSize)];
      if (level !== ramp.upperLevel && level !== ramp.lowerLevel) continue;
      if (!clearGround(a, side < 0 ? -1 : width, level)) continue;
      if (variant === 2 || hash(step, side) % 3 === 0) paint(a, s, ISLAND_GRASS_COLORS[level]);
      if (variant === 2 && to - from > 3) paint(a - 1, s, ISLAND_GRASS_COLORS[level]);
    }
  });

  for (const upper of [true, false]) {
    const tread = upper ? treads[0] : treads[treads.length - 1];
    const inside = upper ? recipe.upperLanding : recipe.lowerLanding;
    const level = upper ? ramp.upperLevel : ramp.lowerLevel;
    const reach = world.tileSize + hash(upper ? 1 : 2, 9) % 3;
    const bias = hash(upper ? 1 : 2, 10) % 2;
    for (let distance = -inside; distance < reach; distance++) {
      const a = upper ? -1 - distance : length + distance;
      const taper = Math.max(0, Math.floor((distance + 1) / 2));
      const left = tread.left + taper + (bias === 0 && distance > 0 ? 1 : 0);
      const right = tread.right - taper - (bias === 1 && distance > 1 ? 1 : 0);
      if (right - left < 3) break;
      for (let s = left; s < right; s++) {
        if (distance >= 0 && !clearGround(a, s, level)) continue;
        const edge = s === left || s === right - 1;
        if (distance >= 0 && edge && hash(Math.floor(distance / 2), s) % 3 === 0) continue;
        paint(a, s, distance >= 1 || edge ? APPROACH : palette.top);
      }
    }
  }
}
