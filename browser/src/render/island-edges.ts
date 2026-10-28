import type { World } from '../core/contracts';
import { BEACH_LEVEL } from '../core/world';
import { drawIslandContours } from './island-contours';
import { islandMaterials } from './island-materials';

type Surface = Pick<CanvasRenderingContext2D, 'fillStyle' | 'fillRect'>;

export function drawIslandEdges(
  context: Surface, world: World, grasses: readonly string[], materials = islandMaterials(world),
): void {
  const tile = world.tileSize;
  const width = world.width * tile;
  const height = world.height * tile;
  const neighbor = (x: number, y: number, material: number, level: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height || materials[y * width + x] !== material) return false;
    return (world.elevations?.[Math.floor(y / tile) * world.width + Math.floor(x / tile)] ?? 0) === level;
  };

  drawIslandContours(context, world, grasses);

  for (let y = 0; y < height; y++) {
    let start = 0;
    let previous = '';
    for (let x = 0; x <= width; x++) {
      let color = '';
      const material = materials[y * width + x];
      if (x < width && (material === 2 || material === 3)) {
        const cell = Math.floor(y / tile) * world.width + Math.floor(x / tile);
        const level = world.elevations?.[cell] ?? 0;
        const original = world.heights[cell] > world.seaLevel + BEACH_LEVEL ? 3
          : world.heights[cell] > world.seaLevel ? 2 : 0;
        if (original && original !== material) color = material === 3 ? grasses[level] : '#e7cf85';
        if (material === 2) {
          if (neighbor(x, y - 1, 3, level) || neighbor(x - 1, y, 3, level)) color = '#c7b173';
          else if (neighbor(x, y + 1, 3, level) || neighbor(x + 1, y, 3, level)) color = '#ecd793';
        }
      }
      if (color === previous) continue;
      if (previous) {
        context.fillStyle = previous;
        context.fillRect(start, y, x - start, 1);
      }
      previous = color;
      start = x;
    }
  }
}
