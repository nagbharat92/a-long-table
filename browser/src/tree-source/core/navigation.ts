import EasyStar from 'easystarjs';
import type { NavigationApi, Point, World } from './contracts';
import { cellAt, cellCenter, CLIFF_DEPTH, inBounds, isCoastalCliff, terrainAt } from './world';

export const SHALLOW_SPEED = 0.45;
export const CLEARANCE = 0.75;
const SWEEP = CLEARANCE - 0.001;
const EPSILON = 1e-9;
type Direction = Parameters<EasyStar.js['setDirectionalCondition']>[2][number];
const DIRECTIONS: readonly { x: number; y: number; entry: Direction }[] = [
  { x: 0, y: -1, entry: EasyStar.TOP }, { x: 1, y: -1, entry: EasyStar.TOP_RIGHT },
  { x: 1, y: 0, entry: EasyStar.RIGHT }, { x: 1, y: 1, entry: EasyStar.BOTTOM_RIGHT },
  { x: 0, y: 1, entry: EasyStar.BOTTOM }, { x: -1, y: 1, entry: EasyStar.BOTTOM_LEFT },
  { x: -1, y: 0, entry: EasyStar.LEFT }, { x: -1, y: -1, entry: EasyStar.TOP_LEFT },
];
const finite = (point: Point) => Number.isFinite(point.x) && Number.isFinite(point.y);
const distanceSquared = (a: Point, b: Point) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const equal = (a: Point, b: Point) => distanceSquared(a, b) < EPSILON ** 2;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

export class Navigation implements NavigationApi {
  readonly speeds: Float32Array;
  private readonly components: Int32Array;
  private readonly finder = new EasyStar.js();

  constructor(readonly world: World) {
    validateWorld(world);
    const size = world.width * world.height;
    this.speeds = new Float32Array(size);
    this.components = new Int32Array(size).fill(-1);
    for (let i = 0; i < size; i++) {
      const terrain = terrainAt(world, this.cell(i));
      this.speeds[i] = terrain === 'deep' ? 0 : terrain === 'shallow' ? SHALLOW_SPEED : 1;
      if (world.cliffCells?.[i]) this.speeds[i] = 0;
    }
    for (let i = 0; i < size; i++) {
      const cell = this.cell(i);
      if (!isCoastalCliff(world, cell)) continue;
      for (let depth = 1; depth <= Math.ceil(CLIFF_DEPTH / world.tileSize); depth++) {
        const below = { x: cell.x, y: cell.y + depth };
        if (inBounds(world, below) && world.heights[this.id(below)] <= world.seaLevel) {
          this.speeds[this.id(below)] = 0;
        }
      }
    }
    this.finder.setGrid(Array.from({ length: world.height }, (_, y) =>
      Array.from({ length: world.width }, (_, x) => {
        const speed = this.speeds[y * world.width + x];
        return speed === 0 ? 0 : speed === 1 ? 1 : 2;
      })));
    this.finder.setAcceptableTiles([1, 2]);
    this.finder.setTileCost(1, 1);
    this.finder.setTileCost(2, 1 / Math.fround(SHALLOW_SPEED));
    this.finder.enableDiagonals();
    this.finder.disableCornerCutting();
    this.finder.enableSync();
    this.finder.setIterationsPerCalculation(size * 8);
    for (let i = 0; i < size; i++) {
      if (!this.speeds[i]) continue;
      const cell = this.cell(i);
      // EasyStar's directions name the incoming neighbor, not the direction of travel.
      this.finder.setDirectionalCondition(cell.x, cell.y, DIRECTIONS.filter(d =>
        this.canStep({ x: cell.x + d.x, y: cell.y + d.y }, cell)).map(d => d.entry));
    }
    this.labelComponents();
  }

  spawnPosition(): Point {
    const center = { x: this.world.width * this.world.tileSize / 2, y: this.world.height * this.world.tileSize / 2 };
    let best: Point | undefined, distance = Infinity;
    for (let i = 0; i < this.speeds.length; i++) {
      const cell = this.cell(i), point = cellCenter(this.world, cell);
      if (!this.speeds[i] || terrainAt(this.world, cell) !== 'grass' || !this.segmentClear(point, point)) continue;
      const next = distanceSquared(point, center);
      if (next < distance) { best = point; distance = next; }
    }
    if (!best) throw new Error('World has no safe, reachable grass spawn.');
    return best;
  }

  speedAt(point: Point): number {
    const cell = cellAt(this.world, point);
    return inBounds(this.world, cell) ? this.speeds[this.id(cell)] : 0;
  }

  canReach(from: Point, to: Point): boolean {
    const start = cellAt(this.world, from), end = cellAt(this.world, to);
    return this.open(start) && this.open(end)
      && this.components[this.id(start)] === this.components[this.id(end)]
      && this.segmentClear(from, from) && this.segmentClear(to, to);
  }

  canStep(from: Point, to: Point): boolean {
    if (!this.open(from) || !this.open(to)) return false;
    const dx = to.x - from.x, dy = to.y - from.y;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return false;
    if (dx && dy) {
      const horizontal = { x: from.x + dx, y: from.y };
      const vertical = { x: from.x, y: from.y + dy };
      return this.canStep(from, horizontal) && this.canStep(from, vertical)
        && this.canStep(horizontal, to) && this.canStep(vertical, to);
    }
    const fromTerrain = terrainAt(this.world, from), toTerrain = terrainAt(this.world, to);
    const fromLand = fromTerrain === 'grass' || fromTerrain === 'sand';
    const toLand = toTerrain === 'grass' || toTerrain === 'sand';
    if (fromLand !== toLand && (fromTerrain === 'grass' || toTerrain === 'grass')) return false;
    const levels = this.world.elevations;
    if (levels && levels[this.id(from)] !== levels[this.id(to)]) {
      const fromId = this.world.rampIds![this.id(from)], toId = this.world.rampIds![this.id(to)];
      return Math.abs(levels[this.id(from)] - levels[this.id(to)]) === 1 && fromId >= 0 && fromId === toId;
    }
    return true;
  }

  segmentClear(from: Point, to: Point, sameSpeed = false): boolean {
    if (!finite(from) || !finite(to) || !this.traceClear(from, to, sameSpeed)) return false;
    const start = cellAt(this.world, from), end = cellAt(this.world, to);
    for (const d of DIRECTIONS) {
      const offset = { x: d.x * SWEEP, y: d.y * SWEEP };
      const a = { x: from.x + offset.x, y: from.y + offset.y };
      const b = { x: to.x + offset.x, y: to.y + offset.y };
      if (!this.canStep(start, cellAt(this.world, a)) || !this.canStep(end, cellAt(this.world, b))
        || !this.traceClear(a, b)) return false;
    }
    return true;
  }

  route(from: Point, requested: Point): Point[] {
    if (!finite(from) || !finite(requested)) throw new RangeError('Navigation points must have finite coordinates.');
    const start = cellAt(this.world, from);
    if (!this.open(start) || !this.segmentClear(from, from)) {
      throw new Error('Cannot route from outside safe walkable terrain.');
    }
    const component = this.components[this.id(start)];
    let target = { ...requested }, end = cellAt(this.world, requested);
    if (!this.open(end) || this.components[this.id(end)] !== component || !this.segmentClear(target, target)) {
      let distance = Infinity;
      for (let i = 0; i < this.speeds.length; i++) {
        if (this.components[i] !== component) continue;
        const candidate = this.closestInCell(this.cell(i), requested);
        const next = distanceSquared(candidate, requested);
        if (next < distance) { distance = next; target = candidate; end = cellAt(this.world, target); }
      }
      if (!Number.isFinite(distance)) throw new Error('Navigation component has no safe continuous destination.');
    }
    let path: Point[] | null | undefined;
    this.finder.findPath(start.x, start.y, end.x, end.y, value => { path = value; });
    this.finder.calculate();
    if (path === undefined) throw new Error('EasyStar did not complete its synchronous bounded-grid search.');
    if (path === null) throw new Error('EasyStar could not connect cells in the same navigation component.');
    // EasyStar returns [] for a same-cell query; its center is still a safe bend
    // when two valid endpoints lie on opposite sides of an inset diagonal corner.
    const cells: Point[] = path.length ? path : [start];
    for (let i = 1; i < cells.length; i++) {
      if (!this.canStep(cells[i - 1], cells[i])) throw new Error('EasyStar returned a disallowed navigation edge.');
    }
    const points = [{ ...from }, ...cells.map(cell => cellCenter(this.world, cell)), target];
    const result: Point[] = [{ ...from }];
    let anchor = 0;
    while (anchor < points.length - 1) {
      let next = anchor + 1;
      for (let candidate = anchor + 2; candidate < points.length; candidate++) {
        if (!this.segmentClear(points[anchor], points[candidate], true)) break;
        next = candidate;
      }
      if (!this.segmentClear(points[anchor], points[next])) {
        throw new Error('Navigation path failed swept-clearance validation.');
      }
      if (!equal(result[result.length - 1], points[next])) result.push({ ...points[next] });
      anchor = next;
    }
    return result;
  }

  private traceClear(from: Point, to: Point, sameSpeed = false): boolean {
    let cell = cellAt(this.world, from);
    const end = cellAt(this.world, to);
    if (!this.open(cell) || !this.open(end)) return false;
    const speed = this.speeds[this.id(cell)], dx = to.x - from.x, dy = to.y - from.y;
    const sx = Math.sign(dx), sy = Math.sign(dy);
    const ix = sx ? this.world.tileSize / Math.abs(dx) : Infinity;
    const iy = sy ? this.world.tileSize / Math.abs(dy) : Infinity;
    let cx = sx ? ((cell.x + Number(sx > 0)) * this.world.tileSize - from.x) / dx : Infinity;
    let cy = sy ? ((cell.y + Number(sy > 0)) * this.world.tileSize - from.y) / dy : Infinity;
    let remaining = this.world.width + this.world.height + 2;
    // Exact grid traversal avoids missing thin forbidden corners between samples.
    while (cell.x !== end.x || cell.y !== end.y) {
      if (--remaining < 0) throw new Error('Navigation grid traversal exceeded its world bounds.');
      const next = { ...cell };
      if (Math.abs(cx - cy) <= EPSILON) {
        next.x += sx; next.y += sy; cx += ix; cy += iy;
      } else if (cx < cy) { next.x += sx; cx += ix; }
      else { next.y += sy; cy += iy; }
      if (!this.canStep(cell, next) || (sameSpeed && this.speeds[this.id(next)] !== speed)) return false;
      cell = next;
    }
    return true;
  }

  private closestInCell(cell: Point, requested: Point): Point {
    const size = this.world.tileSize;
    const min = { x: cell.x * size, y: cell.y * size };
    const max = { x: min.x + size, y: min.y + size };
    const low = {
      x: min.x + (this.canStep(cell, { x: cell.x - 1, y: cell.y }) ? 0 : CLEARANCE),
      y: min.y + (this.canStep(cell, { x: cell.x, y: cell.y - 1 }) ? 0 : CLEARANCE),
    };
    const high = {
      x: max.x - (this.canStep(cell, { x: cell.x + 1, y: cell.y }) ? 0 : CLEARANCE),
      y: max.y - (this.canStep(cell, { x: cell.x, y: cell.y + 1 }) ? 0 : CLEARANCE),
    };
    const candidate = { x: clamp(requested.x, low.x, high.x), y: clamp(requested.y, low.y, high.y) };
    if (this.segmentClear(candidate, candidate)) return candidate;
    const alternatives = [
      { x: clamp(requested.x, min.x + CLEARANCE, max.x - CLEARANCE),
        y: clamp(requested.y, min.y + CLEARANCE, max.y - CLEARANCE) },
      { x: min.x + CLEARANCE, y: candidate.y }, { x: max.x - CLEARANCE, y: candidate.y },
      { x: candidate.x, y: min.y + CLEARANCE }, { x: candidate.x, y: max.y - CLEARANCE },
    ].filter(point => this.segmentClear(point, point));
    if (!alternatives.length) throw new Error('Walkable cell has no point satisfying navigation clearance.');
    return alternatives.reduce((best, point) =>
      distanceSquared(point, requested) < distanceSquared(best, requested) ? point : best);
  }

  private labelComponents(): void {
    let component = 0;
    for (let i = 0; i < this.speeds.length; i++) {
      if (!this.speeds[i] || this.components[i] >= 0) continue;
      const queue = [i];
      this.components[i] = component;
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const cell = this.cell(queue[cursor]);
        for (const d of DIRECTIONS) {
          const next = { x: cell.x + d.x, y: cell.y + d.y };
          if (this.canStep(cell, next) && this.components[this.id(next)] < 0) {
            this.components[this.id(next)] = component;
            queue.push(this.id(next));
          }
        }
      }
      component++;
    }
  }

  private open(cell: Point): boolean {
    return inBounds(this.world, cell) && this.speeds[this.id(cell)] > 0;
  }

  private id(cell: Point): number { return cell.y * this.world.width + cell.x; }
  private cell(index: number): Point { return { x: index % this.world.width, y: Math.floor(index / this.world.width) }; }
}

function validateWorld(world: World): void {
  const size = world.width * world.height;
  if (!Number.isInteger(world.width) || !Number.isInteger(world.height)
    || world.width < 1 || world.height < 1 || size > 65536
    || !Number.isFinite(world.tileSize) || world.tileSize <= CLEARANCE * 2
    || !Number.isFinite(world.seaLevel) || world.heights.length !== size || world.cells.length !== size
    || world.heights.some(value => !Number.isFinite(value))) {
    throw new Error('Invalid navigation world dimensions, tile size, or height/cell data.');
  }
  const relief = [world.elevations, world.cliffCells, world.rampIds, world.ramps];
  if (relief.every(value => value === undefined)) return;
  if (!world.elevations || !world.cliffCells || !world.rampIds || !world.ramps
    || world.elevations.length !== size || world.cliffCells.length !== size || world.rampIds.length !== size) {
    throw new Error('Relief navigation requires complete elevation, cliff, ramp ID, and ramp data.');
  }
  for (let i = 0; i < size; i++) {
    const id = world.rampIds[i];
    if (id < -1 || id >= world.ramps.length) throw new Error(`Invalid relief ramp ID at cell ${i}.`);
    if (id < 0) continue;
    const ramp = world.ramps[id], cell = { x: i % world.width, y: Math.floor(i / world.width) };
    if (cell.x < ramp.rect.x || cell.x >= ramp.rect.x + ramp.rect.width
      || cell.y < ramp.rect.y || cell.y >= ramp.rect.y + ramp.rect.height
      || (world.elevations[i] !== ramp.upperLevel && world.elevations[i] !== ramp.lowerLevel)) {
      throw new Error(`Relief ramp ${id} does not match its cell geometry or elevation.`);
    }
  }
}
