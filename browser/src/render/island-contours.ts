import type { World } from '../core/contracts';
import { terrainAt } from '../core/world';
import { islandContourField } from './island-contour-field';

type Surface = Pick<CanvasRenderingContext2D, 'fillStyle' | 'fillRect'>;

export function drawIslandContours(context: Surface, world: World, grasses: readonly string[]): void {
  if (!world.elevations?.some(level => level > 0)) return;
  const tile = world.tileSize;
  const width = world.width * tile;
  const height = world.height * tile;
  const count = width * height;
  const levels = islandContourField(world, world.elevations, 2);
  const depths = new Uint8Array(count);
  const affected = new Uint8Array(world.width * world.height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      for (let d = 1; d <= 4 * tile && d <= y; d++) {
        const upper = levels[i - d * width];
        if (upper <= levels[i] || d > 2 * tile * (upper - levels[i])) continue;
        depths[i] = d;
        affected[Math.floor(y / tile) * world.width + Math.floor(x / tile)] = 1;
        break;
      }
    }
  }
  const lips = ['#b2e279', '#c2e69a', '#d7edb4'];
  const at = (data: Uint8Array, x: number, y: number) =>
    x < 0 || y < 0 || x >= width || y >= height ? 0 : data[y * width + x];
  for (let cy = 0; cy < world.height; cy++) {
    for (let cx = 0; cx < world.width; cx++) {
      const cell = cy * world.width + cx;
      const terrain = terrainAt(world, { x: cx, y: cy });
      const rampId = world.rampIds?.[cell] ?? -1;
      if ((rampId >= 0 && world.ramps?.[rampId]?.surface !== 'sand')
        || (terrain !== 'grass' && terrain !== 'sand')) continue;
      const original = world.elevations?.[cell] ?? 0;
      const nearEdge = Boolean(world.cliffCells?.[cell] || affected[cell]) || [-1, 0, 1].some(dy =>
        [-1, 0, 1].some(dx => {
          const nx = cx + dx;
          const ny = cy + dy;
          return nx >= 0 && ny >= 0 && nx < world.width && ny < world.height
            && (world.elevations?.[ny * world.width + nx] ?? 0) !== original;
        }));
      if (!nearEdge) continue;
      for (let v = 0; v < tile; v++) {
        let start = 0;
        let previous = '';
        for (let u = 0; u <= tile; u++) {
          const x = cx * tile + u;
          const y = cy * tile + v;
          const i = y * width + x;
          const level = levels[i];
          let color = '';
          if (u < tile) {
            color = !level && terrain === 'sand' ? '#e7cf85' : grasses[level];
            if (depths[i]) {
              const upper = depths[i] <= tile;
              color = upper ? '#b28b60' : '#886743';
              const grain = (Math.imul(Math.floor(x / 12), 73856093) ^ world.seed) >>> 0;
              if ((x + grain % 5) % 13 < 6 && depths[i] % tile >= tile - 2) {
                color = upper ? '#d0ae7a' : '#aa8559';
              }
              if (grain % 3 === 0 && x % 12 === 3 + grain % 7) color = '#64513b';
              if (!at(depths, x - 1, y)) color = '#d0ae7a';
              if (!at(depths, x + 1, y)) color = '#715737';
              if (!at(depths, x, y + 2)) color = '#4f573a';
              if (depths[i] === 1) color = '#7b6344';
            } else if (level > 0) {
              if (at(levels, x, y + 1) < level) color = '#577337';
              else if (at(levels, x, y + 3) < level) color = lips[level];
              else if (at(levels, x, y - 1) < level) color = '#5f7c3d';
              else if (at(levels, x, y - 2) < level) color = lips[level];
              else if (at(levels, x - 1, y) < level) color = lips[level];
              else if (at(levels, x + 1, y) < level) color = '#52723b';
            }
          }
          if (color === previous) continue;
          if (previous) {
            context.fillStyle = previous;
            context.fillRect(cx * tile + start, y, u - start, 1);
          }
          previous = color;
          start = u;
        }
      }
    }
  }
}
