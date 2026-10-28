import type { World } from '../core/contracts';
import { BEACH_LEVEL } from '../core/world';
import { islandContourField } from './island-contour-field';

export function islandMaterials(world: World): Uint8Array {
  const tile = world.tileSize;
  const width = world.width * tile;
  const cells = Uint8Array.from(world.heights, height => height > world.seaLevel + BEACH_LEVEL ? 2
    : height > world.seaLevel ? 1 : 0);
  const materials = islandContourField(world, cells, 2);
  for (let cy = 0; cy < world.height; cy++) {
    for (let cx = 0; cx < world.width; cx++) {
      const cell = cy * world.width + cx;
      const protectedCell = cells[cell] && (world.cliffCells?.[cell] || world.elevations?.[cell]
        || (world.rampIds?.[cell] ?? -1) >= 0);
      const blends = !protectedCell && [-1, 0, 1].some(dy => [-1, 0, 1].some(dx => {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= world.width || y >= world.height) return false;
        const neighbor = y * world.width + x;
        return cells[neighbor] > 0 && cells[neighbor] !== cells[cell] && !world.cliffCells?.[neighbor]
          && (world.rampIds?.[neighbor] ?? -1) < 0
          && (world.elevations?.[neighbor] ?? 0) === (world.elevations?.[cell] ?? 0);
      }));
      for (let v = 0; v < tile; v++) {
        for (let u = 0; u < tile; u++) {
          const i = (cy * tile + v) * width + cx * tile + u;
          if (protectedCell) materials[i] = 1;
          else if (materials[i]) materials[i] = cells[cell] && !blends ? cells[cell] + 1 : materials[i] + 1;
        }
      }
    }
  }
  return materials;
}
