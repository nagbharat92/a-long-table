import { describe, expect, it } from 'vitest';
import type { Point, World } from './core/contracts';
import {
  ascentHeightAt, ascentSectionPolygon, createIslandAscents, ISLAND_STAIR_MAX_RISER, ISLAND_STAIR_MIN_TREAD,
  type IslandAscent,
} from './core/island-ascents';
import { ISLAND_LEVEL_HEIGHTS } from './core/island-heights';
import { BEACH_LEVEL, generateIslandWorld } from './core/world';

const representatives = [12, 41, 71, 902479];
const pointAt = (ascent: IslandAscent, along: number, across = 0): Point => ({
  x: ascent.origin.x + ascent.direction.x * along - ascent.direction.y * across,
  y: ascent.origin.y + ascent.direction.y * along + ascent.direction.x * across,
});
const area = (polygon: Point[]) => polygon.reduce((sum, p, i) => {
  const q = polygon[(i + 1) % polygon.length];
  return sum + p.x * q.y - q.x * p.y;
}, 0) / 2;

function clippedArea(polygon: Point[], x: number, y: number, size: number): number {
  let points = polygon;
  for (const [axis, edge, sign] of [
    ['x', x, 1], ['x', x + size, -1], ['y', y, 1], ['y', y + size, -1],
  ] as const) {
    const output: Point[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const insideA = (a[axis] - edge) * sign >= 0;
      const insideB = (b[axis] - edge) * sign >= 0;
      if (insideA) output.push(a);
      if (insideA !== insideB) {
        const t = (edge - a[axis]) / (b[axis] - a[axis]);
        output.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    points = output;
  }
  return Math.abs(area(points));
}

function checkGeometry(ascent: IslandAscent): void {
  expect(ascentHeightAt(ascent, pointAt(ascent, 0))).toBe(ascent.upperHeight);
  expect(ascentHeightAt(ascent, pointAt(ascent, ascent.length))).toBe(ascent.lowerHeight);
  expect(ascent.upperHeight).toBe(ISLAND_LEVEL_HEIGHTS[ascent.upperLevel]);
  expect(ascent.lowerHeight).toBe(ISLAND_LEVEL_HEIGHTS[ascent.lowerLevel]);
  expect(ascent.sections[0].from).toBeLessThan(0);
  expect(ascent.sections[0].to).toBe(0);
  expect(ascent.sections.at(-1)!.from).toBe(ascent.length);
  expect(ascent.sections.at(-1)!.to).toBeGreaterThan(ascent.length);
  let discontinuities = 0, drop = 0;
  for (const [index, section] of ascent.sections.entries()) {
    expect(Object.values(section).filter(value => typeof value === 'number').every(Number.isFinite)).toBe(true);
    expect(section.to).toBeGreaterThan(section.from);
    expect(section.fromWidth).toBeGreaterThanOrEqual(8);
    expect(section.toWidth).toBeLessThanOrEqual(20);
    expect(section.fromWidth).toBe(section.toWidth);
    expect(section.fromWidth % 2).toBe(0);
    expect(section.fromHeight).toBeGreaterThanOrEqual(section.toHeight);
    expect(section.fromHeight).toBe(section.toHeight);
    if (section.role === 'tread') expect(section.to - section.from).toBeGreaterThanOrEqual(ISLAND_STAIR_MIN_TREAD - 1e-8);
    const previous = ascent.sections[index - 1];
    if (previous) {
      expect(section.from).toBe(previous.to);
      if (section.fromWidth !== previous.toWidth) {
        expect(ascent.kind).toBe('terraced');
        expect(section.role === 'landing' || previous.role === 'landing').toBe(true);
        const shared = Math.min(previous.toWidth, section.fromWidth) / 2;
        const outer = Math.max(previous.toWidth, section.fromWidth) / 2;
        for (const sign of [-1, 1]) {
          expect(ascentHeightAt(ascent, pointAt(ascent, section.from, sign * shared))).toBeCloseTo(section.fromHeight);
          const shoulder = pointAt(ascent, section.from, sign * (shared + outer) / 2);
          expect(ascentHeightAt(ascent, shoulder)).toBeCloseTo(
            previous.toWidth > section.fromWidth ? previous.toHeight : section.fromHeight);
          expect(ascentHeightAt(ascent, pointAt(ascent, section.from, sign * (outer + 0.01)))).toBeUndefined();
        }
      }
      expect(previous.toHeight).toBeGreaterThanOrEqual(section.fromHeight);
      const riser = previous.toHeight - section.fromHeight;
      expect(riser).toBeLessThanOrEqual(ISLAND_STAIR_MAX_RISER + 1e-8);
      if (riser > 1e-8) {
        discontinuities++;
        expect(ascentHeightAt(ascent, pointAt(ascent, section.from))).toBeCloseTo(section.fromHeight);
      }
      drop += riser;
    }
    drop += section.fromHeight - section.toHeight;
    const polygon = ascentSectionPolygon(ascent, section);
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      expect(Math.abs(a.x - b.x) < 1e-8 || Math.abs(a.y - b.y) < 1e-8).toBe(true);
    }
    expect(area(polygon)).toBeCloseTo((section.to - section.from)
      * (section.fromWidth + section.toWidth) / 2);
    expect(area(polygon)).toBeGreaterThan(0);
    for (const p of polygon) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      expect(p.x).toBeGreaterThanOrEqual(ascent.bounds.x - 1e-8);
      expect(p.y).toBeGreaterThanOrEqual(ascent.bounds.y - 1e-8);
      expect(p.x).toBeLessThanOrEqual(ascent.bounds.x + ascent.bounds.width + 1e-8);
      expect(p.y).toBeLessThanOrEqual(ascent.bounds.y + ascent.bounds.height + 1e-8);
    }
    const mid = (section.from + section.to) / 2;
    expect(ascentHeightAt(ascent, pointAt(ascent, mid,
      (section.fromWidth + section.toWidth) / 4 + 0.01))).toBeUndefined();
  }
  expect(drop).toBeCloseTo(ascent.upperHeight - ascent.lowerHeight);
  expect(discontinuities).toBe(ascent.stepCount);
  expect(ascent.topWidth).toBe(ascent.sections[0].fromWidth);
  expect(ascent.bottomWidth).toBe(ascent.sections.at(-1)!.toWidth);
  if (ascent.kind === 'stairs') {
    expect(new Set(ascent.sections.map(section => section.fromWidth)).size).toBe(1);
  }
  expect(['stairs', 'terraced']).toContain(ascent.kind);
  expect(ascent.stepCount).toBeGreaterThanOrEqual(4);
  let previousHeight = ascent.upperHeight;
  for (let i = 0; i <= 160; i++) {
    const height = ascentHeightAt(ascent, pointAt(ascent, ascent.length * i / 160))!;
    expect(height).toBeLessThanOrEqual(previousHeight + 1e-8);
    previousHeight = height;
  }
}

function checkSupport(world: World, ascents: IslandAscent[]): void {
  const reserved = new Map<number, number>();
  const size = world.tileSize;
  for (const ascent of ascents) {
    for (const section of ascent.sections) {
      const polygon = ascentSectionPolygon(ascent, section);
      for (const [id, ramp] of world.ramps!.entries()) {
        if (id === ascent.id) continue;
        // Clip using unit coordinates to handle rectangular original ramp reservations.
        const normalized = polygon.map(p => ({
          x: (p.x / size - ramp.rect.x) / ramp.rect.width,
          y: (p.y / size - ramp.rect.y) / ramp.rect.height,
        }));
        expect(clippedArea(normalized, 0, 0, 1)).toBeLessThan(1e-8);
      }
      for (let y = Math.floor(ascent.bounds.y / size); y < Math.ceil((ascent.bounds.y + ascent.bounds.height) / size); y++) {
        for (let x = Math.floor(ascent.bounds.x / size); x < Math.ceil((ascent.bounds.x + ascent.bounds.width) / size); x++) {
          if (clippedArea(polygon, x * size, y * size, size) <= 1e-8) continue;
          const index = y * world.width + x;
          expect(reserved.get(index) ?? ascent.id).toBe(ascent.id);
          reserved.set(index, ascent.id);
          expect(world.cells[index]).toBe(1);
          expect(world.heights[index] - world.seaLevel).toBeGreaterThan(BEACH_LEVEL);
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              expect(x + dx).toBeGreaterThanOrEqual(0);
              expect(y + dy).toBeGreaterThanOrEqual(0);
              expect(x + dx).toBeLessThan(world.width);
              expect(y + dy).toBeLessThan(world.height);
              expect(world.cells[(y + dy) * world.width + x + dx]).toBe(1);
            }
          }
          const along = ((x + 0.5) * size - ascent.origin.x) * ascent.direction.x
            + ((y + 0.5) * size - ascent.origin.y) * ascent.direction.y;
          const center = pointAt(ascent, along);
          expect(world.elevations![index]).toBe(world.elevations![
            Math.floor(center.y / size) * world.width + Math.floor(center.x / size)]);
          if (section.to <= 0 || section.from >= ascent.length) {
            expect(world.elevations![index]).toBe(section.to <= 0 ? ascent.upperLevel : ascent.lowerLevel);
            expect(world.cliffCells?.[index] ?? 0).toBe(0);
          }
        }
      }
    }
  }
}

function fixture(direction: Point): World {
  const width = 40, height = 40, tileSize = 4;
  const highCell = { x: 20, y: 20 };
  const lowCell = { x: highCell.x + direction.x * 3, y: highCell.y + direction.y * 3 };
  const elevations = Uint8Array.from({ length: width * height }, (_, i) =>
    ((i % width - highCell.x) * direction.x + (Math.floor(i / width) - highCell.y) * direction.y) <= 1 ? 2 : 1);
  return {
    seed: 12, width, height, tileSize, seaLevel: 0,
    heights: new Float32Array(width * height).fill(0.5),
    cells: new Uint8Array(width * height).fill(1), elevations,
    cliffCells: new Uint8Array(width * height),
    provenance: 'test-fixture', generatorVersion: 'ascent-test',
    ramps: [{
      highCell, lowCell, direction, upperLevel: 2, lowerLevel: 1,
      rect: { x: Math.min(highCell.x, lowCell.x) - Math.abs(direction.y),
        y: Math.min(highCell.y, lowCell.y) - Math.abs(direction.x),
        width: Math.abs(direction.x) * 3 + Math.abs(direction.y) * 2 + 1,
        height: Math.abs(direction.y) * 3 + Math.abs(direction.x) * 2 + 1 },
    }],
  };
}

describe('deterministic V2 ascent recipes', () => {
  it.each(representatives)('preserves source world and recipes for seed %i', seed => {
    const world = generateIslandWorld(seed), before = structuredClone(world);
    const ascents = createIslandAscents(world);
    expect(ascents).toEqual(createIslandAscents(world));
    expect(world).toEqual(before);
    expect(ascents).toHaveLength(world.ramps!.length);
    ascents.forEach(checkGeometry);
    checkSupport(world, ascents);
    if (ascents.length >= 2) expect(new Set(ascents.map(ascent =>
      [ascent.kind, ascent.length, ascent.topWidth, ascent.bottomWidth, ascent.stepCount].join(':'))).size).toBeGreaterThan(1);
    ascents[0].origin.x++;
    expect(world).toEqual(before);
    expect(createIslandAscents(world)).not.toEqual(ascents);
  });

  it('reserves supported footprints across seeds 0..127 with meaningful coherent variety', () => {
    const kinds = new Set<string>(), lengths = new Set<number>(), counts = new Set<number>();
    let straight = false, steppedWidth = false, broadMiddle = false, extensions = 0;
    for (let seed = 0; seed < 128; seed++) {
      const world = generateIslandWorld(seed), ascents = createIslandAscents(world);
      expect(ascents).toHaveLength(world.ramps!.length);
      checkSupport(world, ascents);
      for (const ascent of ascents) {
        checkGeometry(ascent);
        kinds.add(ascent.kind);
        lengths.add(ascent.length);
        if (ascent.stepCount) counts.add(ascent.stepCount);
        straight ||= ascent.kind === 'stairs' && ascent.topWidth === ascent.bottomWidth;
        steppedWidth ||= ascent.kind === 'terraced' && ascent.topWidth !== ascent.bottomWidth;
        broadMiddle ||= ascent.sections.some(section => section.role === 'landing'
          && section.from > 0 && section.to < ascent.length
          && Math.max(section.fromWidth, section.toWidth) > Math.max(ascent.topWidth, ascent.bottomWidth) + 1);
        const ramp = world.ramps![ascent.id];
        const originalLength = (Math.abs(ramp.highCell.x - ramp.lowCell.x)
          + Math.abs(ramp.highCell.y - ramp.lowCell.y)) * world.tileSize;
        if (ascent.length > originalLength) extensions++;
      }
    }
    expect([...kinds].sort()).toEqual(['stairs', 'terraced']);
    expect(lengths.size).toBeGreaterThanOrEqual(4);
    expect(counts.size).toBeGreaterThanOrEqual(5);
    expect(straight && steppedWidth && broadMiddle).toBe(true);
    expect(extensions).toBeGreaterThan(100);
  }, 60000);

  it.each([{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }])(
    'supports cardinal direction %j', direction => {
      const world = fixture(direction), ascents = createIslandAscents(world);
      checkGeometry(ascents[0]);
      checkSupport(world, ascents);
      const ascent = ascents[0], first = ascent.sections[0], last = ascent.sections.at(-1)!;
      expect(ascentHeightAt(ascent, pointAt(ascent, first.from - 0.01))).toBeUndefined();
      expect(ascentHeightAt(ascent, pointAt(ascent, last.to + 0.01))).toBeUndefined();
      expect(ascentHeightAt(ascent, pointAt(ascent, last.to))).toBe(ascent.lowerHeight);
    },
  );

  it('lengthens the flight within a confined supported corridor instead of enlarging risers', () => {
    const world = fixture({ x: 1, y: 0 }), high = world.ramps![0].highCell;
    world.elevationHeights = [0, 8, 16];
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        if (Math.abs(y - high.y) > 1 || x < high.x || x > high.x + 6) {
          world.heights[y * world.width + x] = 0.06;
        }
      }
    }
    const ascents = createIslandAscents(world);
    expect(ascents).toEqual(createIslandAscents(world));
    expect(ascents[0].length).toBeGreaterThan(12);
    expect(ascents[0].length).toBeLessThanOrEqual(24);
    expect(Math.max(ascents[0].topWidth, ascents[0].bottomWidth)).toBeLessThanOrEqual(12);
    checkSupport(world, ascents);
  });

  it('reroutes around an unsupported source corridor while preserving its connection', () => {
    const world = fixture({ x: 1, y: 0 });
    for (let x = 21; x <= 22; x++) world.heights[20 * world.width + x] = 0;
    const before = structuredClone(world), ascents = createIslandAscents(world);
    expect(ascents).toHaveLength(1);
    expect(ascents[0].origin).not.toEqual({ x: 82, y: 82 });
    checkSupport(world, ascents);
    checkGeometry(ascents[0]);
    expect(world).toEqual(before);
  });

  it('rejects a genuinely too-short isolated corridor after trying coherent alternatives', () => {
    const world = fixture({ x: 1, y: 0 }), high = world.ramps![0].highCell;
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        if (Math.abs(y - high.y) > 1 || x < high.x || x > high.x + 3) {
          world.heights[y * world.width + x] = 0.06;
        }
      }
    }
    const before = structuredClone(world);
    expect(() => createIslandAscents(world)).toThrow(/source ramp 0/);
    expect(world).toEqual(before);
  });

  it('rejects malformed, unsupported, or colliding source connections explicitly', () => {
    const world = fixture({ x: 1, y: 0 });
    expect(() => createIslandAscents({ ...world, elevations: undefined })).toThrow(/require/);
    const diagonal = structuredClone(world);
    diagonal.ramps![0].direction = { x: 1, y: 1 };
    expect(() => createIslandAscents(diagonal)).toThrow(/source ramp 0/);
    const water = structuredClone(world);
    water.cells[20 * water.width + 20] = 0;
    expect(() => createIslandAscents(water)).toThrow(/source ramp 0/);
    const wrongLevel = structuredClone(world);
    wrongLevel.elevations![20 * world.width + 23] = 2;
    expect(() => createIslandAscents(wrongLevel)).toThrow(/source ramp 0/);
    const collision = structuredClone(world);
    collision.ramps!.push(structuredClone(collision.ramps![0]));
    expect(() => createIslandAscents(collision)).toThrow(/source ramp 0/);
    const unsupportedInterior = structuredClone(world);
    unsupportedInterior.heights.fill(0);
    expect(() => createIslandAscents(unsupportedInterior)).toThrow(/source ramp 0/);
  });
});
