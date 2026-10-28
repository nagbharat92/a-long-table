import type { Ramp, World } from '../core/contracts';

type Surface = Pick<CanvasRenderingContext2D, 'fillStyle' | 'fillRect'>;

export function drawSandySteps(context: Surface, world: World, ramp: Ramp): void {
  const tile = world.tileSize;
  const { direction, highCell, lowCell } = ramp;
  const length = (Math.abs(lowCell.x - highCell.x) + Math.abs(lowCell.y - highCell.y) + 1) * tile;
  const width = (direction.x === 0 ? ramp.rect.width : ramp.rect.height) * tile;
  const landing = Math.max(1, Math.floor(tile / 2));
  const count = Math.max(2, Math.round((length - landing * 2) / 4));
  const rise = Math.min(count, Math.floor(width / 4));
  const across = { x: -direction.y, y: direction.x };
  const origin = {
    x: (highCell.x + 0.5) * tile - direction.x * tile / 2 - across.x * width / 2,
    y: (highCell.y + 0.5) * tile - direction.y * tile / 2 - across.y * width / 2,
  };
  const bounds = (along: number, side: number, depth: number, breadth: number) => {
    const x = origin.x + direction.x * along + across.x * side;
    const y = origin.y + direction.y * along + across.y * side;
    return {
      x: x + Math.min(0, direction.x * depth) + Math.min(0, across.x * breadth),
      y: y + Math.min(0, direction.y * depth) + Math.min(0, across.y * breadth),
      width: Math.abs(direction.x * depth) + Math.abs(across.x * breadth),
      height: Math.abs(direction.y * depth) + Math.abs(across.y * breadth),
    };
  };
  const paint = (along: number, side: number, depth: number, breadth: number, color: string) => {
    const box = bounds(along, side, depth, breadth);
    context.fillStyle = color;
    context.fillRect(box.x, box.y, box.width, box.height);
  };
  const detail = (along: number, side: number) => {
    let value = world.seed ^ Math.imul(highCell.x + along, 374761393) ^ Math.imul(highCell.y + side, 668265263);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return (value ^ (value >>> 16)) >>> 0;
  };
  const ground = (along: number, side: number) => {
    const x = Math.floor((origin.x + direction.x * (along + 0.5) + across.x * (side + 0.5)) / tile);
    const y = Math.floor((origin.y + direction.y * (along + 0.5) + across.y * (side + 0.5)) / tile);
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return -1;
    const index = y * world.width + x;
    return world.cells[index] && world.heights[index] > world.seaLevel
      && !world.cliffCells?.[index] && (world.rampIds?.[index] ?? -1) < 0 ? index : -1;
  };
  const turf = (index: number) => {
    const level = index < 0 ? undefined : world.elevations?.[index];
    if (level !== ramp.upperLevel && level !== ramp.lowerLevel) return '#e7cf85';
    return level === 0 ? '#b6ce67' : level === 1 ? '#c1cf74' : '#ced483';
  };
  // Feather only onto clear, same-level land, never into a cliff or another crossing.
  for (const [end, level] of [[0, ramp.upperLevel], [length, ramp.lowerLevel]]) {
    const start = direction.x === 0 ? 1 : (direction.x > 0) === (end === 0) ? 0 : rise;
    const breadth = direction.x === 0 ? width - 2 : width - rise;
    const reach = Math.max(2, Math.ceil(tile / 2));
    const wornSide = detail(end, 4) % 2;
    for (let side = start + 1; side < start + breadth - 1; side++) {
      for (let distance = 0; distance < reach; distance++) {
        const along = end === 0 ? -1 - distance : end + distance;
        const corner = distance === reach - 1 ? 1 : 0;
        if (side < start + 1 + (wornSide === 0 ? corner : 0)
          || side >= start + breadth - 1 - (wornSide === 1 ? corner : 0)) break;
        const index = ground(along, side);
        if (index < 0 || world.elevations?.[index] !== level) break;
        const fringe = distance === reach - 1 || side === start + 1 || side === start + breadth - 2;
        const worn = (Math.floor((side - start - 1) / 2) + detail(end, 5)) % 2 === 0;
        paint(along, side, 1, 1, fringe && worn ? turf(index) : '#e7cf85');
      }
    }
  }

  for (let step = -1; step <= count; step++) {
    const along = step < 0 ? 0 : landing + Math.floor(step * (length - landing * 2) / count);
    const next = step === count ? length : landing + Math.floor((step + 1) * (length - landing * 2) / count);
    const isLanding = step < 0 || step === count;
    const drop = Math.ceil(Math.max(0, Math.min(count, step + 1)) * rise / count);
    const start = direction.x === 0 ? 1 : direction.x > 0 ? drop : rise - drop;
    const breadth = direction.x === 0 ? width - 2 : width - rise;
    for (let a = along; a < next; a++) {
      // Round only the crossing ends; broad shoulders vary independently of tread seams.
      const corner = a === 0 || a === length - 1;
      const shoulder = detail(Math.floor(a / 5), 3) % 5;
      const left = corner || shoulder === 0 ? 1 : 0;
      const right = corner || shoulder === 1 ? 1 : 0;
      if (direction.x && rise > drop) {
        const box = bounds(a, 0, 1, width);
        const y = ramp.rect.y * tile;
        // The shared shallow bank meets the worn tread edge; its foot stays connected.
        context.fillStyle = '#b79e6b';
        const worn = direction.x > 0 ? right : left;
        context.fillRect(box.x, y + drop + breadth - worn, 1, rise - drop + worn);
        context.fillStyle = detail(Math.floor(a / 3), 2) % 4 === 0 ? '#b79e6b' : '#9e895f';
        context.fillRect(box.x, y + width - 1, 1, 1);
      }
      paint(a, start + left, 1, breadth - left - right, isLanding ? '#e7cf85' : '#e8d29a');
      for (let side = left; side < breadth - right; side++) {
        const edge = side === left || side === breadth - right - 1;
        if (edge) {
          const isLeft = side === left;
          // Blend only the exposed turf shoulder, never the east/west earthen bank.
          const exposed = !direction.x || (direction.x > 0) === isLeft;
          const run = (a + detail(0, isLeft ? 6 : 7) % 6) % 6 < 3;
          const index = exposed && run ? ground(a, isLeft ? -1 : width) : -1;
          paint(a, start + side, 1, 1, turf(index));
        } else if (!isLanding && (a === along || a === next - 1)) {
          // Short softened breaks in each lip avoid full-width barcode stripes.
          const worn = side < 2 || side >= breadth - 2
            || (Math.abs(side - (breadth - 1) / 2) > 1 && detail(step, Math.floor(side / 2)) % 3 === 0);
          if (!worn) paint(a, start + side, 1, 1,
            a === along ? '#f2dfa7' : direction.y > 0 ? '#b79e6b' : '#c3ad79');
        } else if (!isLanding && side + 1 < breadth - right - 1 && detail(a, side) % 29 === 0) {
          paint(a, start + side, 1, 2, '#e7cf85');
          side++;
        }
      }
    }
  }
}
