import { describe, expect, it } from 'vitest';
import { buildIslandLandform, generateIslandLandform, islandSurfaceHeight, ISLAND_LEVEL_HEIGHTS } from './core/island-landform';
import { generateIslandWorld, generateWorld } from './core/world';
import { projectLandVertex, type LandTriangle, type LandVertex } from './core/landform-study';
import { rasterLandform, type LandPalette } from './render/landform-study';

const palette: LandPalette = {
  water: [0, 0, 0], top: [100, 200, 100], light: [200, 200, 150],
  middle: [150, 150, 100], dark: [100, 100, 50],
  levels: Array.from({ length: 7 }, (_, level) => [200 - level * 20, 200 - level * 20, 200 - level * 20]),
};

function heightOnTriangle(point: LandVertex, vertices: readonly LandVertex[]): number | undefined {
  const [a, b, c] = vertices;
  const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (Math.abs(area) < 1e-8) return undefined;
  const u = ((b.x - point.x) * (c.y - point.y) - (b.y - point.y) * (c.x - point.x)) / area;
  const v = ((c.x - point.x) * (a.y - point.y) - (c.y - point.y) * (a.x - point.x)) / area;
  const w = 1 - u - v;
  return Math.min(u, v, w) >= -1e-8 ? u * a.z + v * b.z + w * c.z : undefined;
}

describe('full island geometry from existing rules', () => {
  it.each([0, 1, 12, 42, 43, 902479, 999999])('preserves the complete source layout for seed %i', seed => {
    const source = generateIslandWorld(seed);
    const before = structuredClone(source);
    const island = buildIslandLandform(source);
    expect(source).toEqual(before);
    expect(island.world).toBe(source);
    expect(source.cells).toEqual(generateWorld(seed).cells);
    const tops = island.triangles.filter(t => t.plane === 'top');
    expect(island.triangles.length).toBeLessThan(island.sourceTriangleCount * 0.3);
    const candidates: LandTriangle[][] = Array.from({ length: source.cells.length }, () => []);
    for (const triangle of tops) {
      const minX = Math.max(0, Math.floor(Math.min(...triangle.vertices.map(v => v.x)) / source.tileSize));
      const maxX = Math.min(source.width, Math.ceil(Math.max(...triangle.vertices.map(v => v.x)) / source.tileSize));
      const minY = Math.max(0, Math.floor(Math.min(...triangle.vertices.map(v => v.y)) / source.tileSize));
      const maxY = Math.min(source.height, Math.ceil(Math.max(...triangle.vertices.map(v => v.y)) / source.tileSize));
      for (let y = minY; y < maxY; y++) for (let x = minX; x < maxX; x++) candidates[y * source.width + x].push(triangle);
    }
    for (let y = 0; y < source.height; y++) {
      for (let x = 0; x < source.width; x++) {
        if (!source.cells[y * source.width + x]) continue;
        const pair = candidates[y * source.width + x];
        for (const [dx, dy] of [[0.271828, 0.314159], [0.618034, 0.414214], [0.732051, 0.707107]]) {
          const point = { x: (x + dx) * source.tileSize, y: (y + dy) * source.tileSize, z: 0 };
          const heights = pair.map(t => heightOnTriangle(point, t.vertices)).filter(value => value !== undefined);
          expect(heights.length).toBeGreaterThan(0);
          for (const height of heights) expect(height).toBeCloseTo(islandSurfaceHeight(source, { x, y }, point, island.ascents, island.edges, island.beach, island.shoulders), 8);
        }
      }
    }
    for (const triangle of island.triangles) {
      expect(triangle.vertices.every(v => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z))).toBe(true);
    }
    for (const ascent of island.ascents) {
      for (const [along, level] of [[0, ascent.upperLevel], [ascent.length, ascent.lowerLevel]] as const) {
        const point = {
          x: ascent.origin.x + ascent.direction.x * along,
          y: ascent.origin.y + ascent.direction.y * along,
        };
        const cell = { x: Math.floor(point.x / source.tileSize), y: Math.floor(point.y / source.tileSize) };
        expect(islandSurfaceHeight(source, cell, point, island.ascents, island.edges, island.beach, island.shoulders)).toBe(ISLAND_LEVEL_HEIGHTS[level]);
      }
    }
  });

  it('is deterministic and retains full land area rather than stretching the reference', () => {
    const first = generateIslandLandform(902479), second = generateIslandLandform(902479);
    expect(first.triangles).toEqual(second.triangles);
    const xs = first.triangles.flatMap(t => t.vertices.map(v => v.x));
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(200);
    expect(first.ascents.length).toBe(first.world.ramps!.length);
  });

  it('covers every source land cell in the full-size plan raster without clipping', () => {
    const island = generateIslandLandform(902479);
    const width = island.world.width * island.world.tileSize + 48;
    const height = island.world.height * island.world.tileSize + 48;
    const raster = rasterLandform('plan', palette, [], {
      triangles: island.triangles, viewport: { width, height, origin: { x: 24, y: 24 } },
    });
    expect(raster.width).toBe(width);
    expect(raster.height).toBe(height);
    for (let y = 0; y < island.world.height; y++) {
      for (let x = 0; x < island.world.width; x++) {
        const px = (x + 0.5) * island.world.tileSize + 24;
        const py = (y + 0.5) * island.world.tileSize + 24;
        const level = raster.levels[py * width + px];
        expect(level >= 0).toBe(Boolean(island.world.cells[y * island.world.width + x]));
      }
    }
    for (const projection of ['oblique', 'current'] as const) {
      const points = island.triangles.flatMap(t => t.vertices.map(p => projectLandVertex(p, projection)));
      expect(points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    }
  });

  it('rejects missing source elevations rather than silently making a flat island', () => {
    expect(() => buildIslandLandform(generateWorld(42))).toThrow('existing connected island generator');
    expect(() => generateIslandLandform(-1)).toThrow('integer');
  });

  it.each([
    [902479, 'oblique'], [902479, 'current'], [12, 'oblique'], [12, 'current'],
  ] as const)('seed %i has no water pixels through solid island terrain in %s', (seed, projection) => {
    const { world, triangles, ascents, edges, beach, shoulders } = generateIslandLandform(seed);
    const viewport = { width: 820, height: 600, origin: { x: 350, y: 120 } };
    const raster = rasterLandform(projection, palette, [], { triangles, viewport });
    const holes: string[] = [];
    for (let py = 0; py < viewport.height; py++) {
      for (let px = 0; px < viewport.width; px++) {
        if (raster.levels[py * viewport.width + px] >= 0) continue;
        const sx = px + 0.5 - viewport.origin.x, sy = py + 0.5 - viewport.origin.y;
        for (let z = -3.75; z < 48; z += 1) {
          const sum = (sy + z) / 0.425, difference = sx / 0.85;
          const point = projection === 'oblique'
            ? { x: (sum + difference) / 2, y: (sum - difference) / 2 }
            : { x: sx, y: sy + z };
          const cell = { x: Math.floor(point.x / world.tileSize), y: Math.floor(point.y / world.tileSize) };
          if (cell.x < 0 || cell.y < 0 || cell.x >= world.width || cell.y >= world.height
            || !world.cells[cell.y * world.width + cell.x]) continue;
          if (z < islandSurfaceHeight(world, cell, point, ascents, edges, beach, shoulders) - 0.01) {
            holes.push(`${px},${py}`);
            break;
          }
        }
      }
    }
    expect(holes).toEqual([]);
  });
});
