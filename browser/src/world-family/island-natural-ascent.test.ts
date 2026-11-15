import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Point } from './core/contracts';
import {
  ascentHeightAt, ascentSectionHeightAt, ascentSectionPolygon, ascentSectionPosition, ascentSurfaceSections,
} from './core/island-ascents';
import { intersectIslandPolygon } from './core/island-columns';
import { islandHeightAtLevel } from './core/island-heights';
import {
  buildIslandLandform, generateIslandLandform, islandAscentAt, islandSurfaceHeight, type IslandLandform,
} from './core/island-landform';
import { generateTerracedIslandWorld } from './core/island-terraces';
import { activeIslandLandTriangles, classifyTriangleLayer, islandMeshLayers } from './core/island-layers';
import { createIslandNaturalAscent, NATURAL_ASCENT_MAX_GRADE } from './core/island-natural-ascent';
import { cleanNaturalAscentRemnants, cleanNaturalBankFragments } from './core/island-natural-remnants';
import { openMeshEdges } from './core/mesh-boundaries';

const seeds = [153025, 12, 77, 91, 902479, 71];
const baselines = new Map<number, IslandLandform>(), studies = new Map<number, IslandLandform>();
beforeAll(() => {
  for (const seed of seeds) {
    baselines.set(seed, generateIslandLandform(seed, { naturalAscent: false }));
    studies.set(seed, generateIslandLandform(seed));
  }
}, 40000);

function surface(island: IslandLandform, point: Point): number {
  const { world, ascents, edges, beach, shoulders } = island;
  return islandSurfaceHeight(world, {
    x: Math.floor(point.x / world.tileSize), y: Math.floor(point.y / world.tileSize),
  }, point, ascents, edges, beach, shoulders);
}

function topArea(triangles: IslandLandform['triangles']): number {
  return triangles.reduce((sum, triangle) => {
    const [a, b, c] = triangle.vertices;
    return sum + (triangle.plane === 'top'
      ? ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2 : 0);
  }, 0);
}

describe('one restrained, open-sided flank ascent', () => {
  it.each([
    [12, '148208c183c0a54d1f7173185470533f20a9dc4e6721efacda276efce319ddb8'],
    [71, '8af645aedb74bf8dcc4d3d83ab3c3d908efb569f3fc20088366e5add7f15140c'],
    [77, 'c20bd672f89fa1615dcb4637e115308286cddec6b64a8a62c897003f6f5b4823'],
    [91, 'e54014fde90d8b12a5626e99ca581d62229408e184af8eb8bd81cb03189a0bf8'],
    [153025, '14b2c689c4c06bd4e2480168f8ac945ea5cf6465696f7fb23b805d7c22fc8888'],
    [902479, 'a08478834a1356917472ea60f00c861fb56fa6f47c29276630e56b3881f7dbef'],
  ] as const)('retains the exact approved final mesh for seed %i', (seed, hash) => {
    expect(createHash('sha256').update(JSON.stringify(studies.get(seed)!.triangles)).digest('hex')).toBe(hash);
  });

  it.each(seeds)('preserves the source, other ascents and coastal geometry on seed %i', seed => {
    const baseline = baselines.get(seed)!, study = studies.get(seed)!;
    expect(study.naturalAscent?.status).toBe('placed');
    expect(study.ascents.filter(ascent => ascent.kind === 'gully')).toHaveLength(1);
    const id = study.naturalAscent!.ascentId!;
    expect(study.world).toEqual(baseline.world);
    expect(study.beach).toEqual(baseline.beach);
    expect(study.shoulders).toEqual(baseline.shoulders);
    expect(study.ascents.filter(ascent => ascent.id !== id)).toEqual(baseline.ascents.filter(ascent => ascent.id !== id));
    const preserved = (island: IslandLandform) => island.triangles.filter(triangle =>
      classifyTriangleLayer(triangle) === 'beaches'
      || (triangle.ascentId !== undefined && triangle.ascentId !== id)).map(triangle => JSON.stringify(triangle)).sort();
    expect(preserved(study)).toEqual(preserved(baseline));
    const natural = study.ascents.find(ascent => ascent.id === id)!;
    expect(createIslandNaturalAscent(baseline.world, baseline.ascents, baseline.beach, baseline.shoulders)).toEqual(natural);
    for (let y = 0; y < study.world.height; y++) for (let x = 0; x < study.world.width; x++) {
      if (!study.world.cells[y * study.world.width + x]) continue;
      const point = { x: (x + 0.5) * study.world.tileSize, y: (y + 0.5) * study.world.tileSize };
      if (islandAscentAt([natural, baseline.ascents[id]], point)) continue;
      expect(surface(study, point)).toBe(surface(baseline, point));
    }
  });

  it.each(seeds)('limits every sloping leg and opens the traverses downhill on seed %i', seed => {
    const island = studies.get(seed)!, { world } = island;
    const ascent = island.ascents.find(value => value.kind === 'gully')!;
    const traverses = ascent.sections.filter(section => section.role === 'slope' && section.axis
      && Math.abs(section.axis.direction.x * ascent.direction.x + section.axis.direction.y * ascent.direction.y) < 1e-8);
    expect(ascent.banks!.length).toBeGreaterThan(0);
    expect(ascent.sections[1].to - ascent.sections[1].from).toBe(world.tileSize * 2);
    expect(traverses.length).toBeGreaterThan(0);
    expect(traverses.every(section => section.to - section.from >= world.tileSize * 4)).toBe(true);
    expect(ascent.length).toBeGreaterThan(baselines.get(seed)!.ascents[ascent.id].length);
    expect(ascent.stepCount).toBe(0);
    for (const section of ascent.sections) {
      expect((section.fromHeight - section.toHeight) / (section.to - section.from))
        .toBeLessThanOrEqual(NATURAL_ASCENT_MAX_GRADE + 1e-8);
      if (section.role === 'pocket') expect(section.fromHeight).toBe(section.toHeight);
      for (const t of [0.1, 0.5, 0.9]) {
        const along = section.from + (section.to - section.from) * t;
        const point = ascentSectionPosition(ascent, section, along);
        expect(surface(island, point)).toBeCloseTo(ascentSectionHeightAt(ascent, section, point), 8);
      }
    }
    for (const section of traverses) {
      const outward = ascent.direction, half = section.fromWidth / 2;
      for (let step = 1; step < 20; step++) {
        const point = ascentSectionPosition(ascent, section, section.from + (section.to - section.from) * step / 20);
        const height = ascentHeightAt(ascent, point)!;
        let reachedRim = false;
        for (let out = half + 0.1; out <= half + world.tileSize * 18; out += 0.5) {
          const sample = { x: point.x + outward.x * out, y: point.y + outward.y * out };
          const index = Math.floor(sample.y / world.tileSize) * world.width + Math.floor(sample.x / world.tileSize);
          if (world.elevations![index] === ascent.lowerLevel) {
            expect(surface(island, sample)).toBeLessThanOrEqual(height);
            reachedRim = true;
            break;
          }
          expect(surface(island, sample)).toBeLessThanOrEqual(height + 1e-8);
          expect(surface(island, sample)).toBeLessThan(ascent.upperHeight);
        }
        expect(reachedRim).toBe(true);
      }
    }
    const sections = ascentSurfaceSections(ascent);
    for (const [i, section] of sections.entries()) {
      const polygon = ascentSectionPolygon(ascent, section);
      for (const point of polygon) {
        const cell = {
          x: Math.floor((point.x + polygon[0].x + polygon[2].x) / 3 / world.tileSize),
          y: Math.floor((point.y + polygon[0].y + polygon[2].y) / 3 / world.tileSize),
        };
        const index = cell.y * world.width + cell.x;
        expect(world.cells[index]).toBe(1);
        expect(island.beach.landSurfaces.has(index)).toBe(false);
        expect(island.shoulders.byCell.has(index)).toBe(false);
        expect(ascentSectionHeightAt(ascent, section, point)).toBeLessThanOrEqual(
          islandHeightAtLevel(world, world.elevations![index]) + 1e-8);
        expect(point.x).toBeGreaterThanOrEqual(ascent.bounds.x);
        expect(point.x).toBeLessThanOrEqual(ascent.bounds.x + ascent.bounds.width);
        expect(point.y).toBeGreaterThanOrEqual(ascent.bounds.y);
        expect(point.y).toBeLessThanOrEqual(ascent.bounds.y + ascent.bounds.height);
      }
      for (const other of sections.slice(i + 1)) {
        expect(intersectIslandPolygon(polygon, ascentSectionPolygon(ascent, other))).toEqual([]);
      }
    }
  });

  it('adds a return traverse instead of retaining a 50-percent ramp on the tall example', () => {
    const world = generateTerracedIslandWorld(12);
    world.elevationHeights = [0, 24];
    const island = buildIslandLandform(world, { naturalAscent: true });
    const ascent = island.ascents.find(ascent => ascent.kind === 'gully')!;
    const traverses = ascent.sections.filter(section => section.role === 'slope' && section.axis
      && Math.abs(section.axis.direction.x * ascent.direction.x + section.axis.direction.y * ascent.direction.y) < 1e-8);
    expect(ascent.upperHeight - ascent.lowerHeight).toBe(24);
    expect(traverses.length).toBeGreaterThanOrEqual(2);
    expect(traverses[0].axis!.direction.x * traverses[1].axis!.direction.x
      + traverses[0].axis!.direction.y * traverses[1].axis!.direction.y).toBe(-1);
    const slopes = ascent.sections.filter(section => section.role === 'slope');
    expect(slopes.reduce((sum, section) => sum + section.to - section.from, 0)).toBeGreaterThanOrEqual(72);
  });

  it.each(seeds)('leaves no cut-created detached summit pieces or further narrow remnants on seed %i', seed => {
    const island = studies.get(seed)!, ascent = island.ascents.find(value => value.kind === 'gully')!;
    const { world } = island, size = world.tileSize / 2, width = world.width * 2;
    const before = new Uint8Array(world.cells.length * 4), after = new Uint8Array(before.length);
    for (let y = 0; y < world.height * 2; y++) for (let x = 0; x < width; x++) {
      const cell = Math.floor(y / 2) * world.width + Math.floor(x / 2), i = y * width + x;
      if (!world.cells[cell] || world.elevations![cell] < ascent.upperLevel) continue;
      before[i] = 1;
      const point = { x: (x + 0.5) * size, y: (y + 0.5) * size };
      after[i] = Number((ascentHeightAt(ascent, point) ?? ascent.upperHeight) >= ascent.upperHeight - 1e-8);
    }
    const groups = (mask: Uint8Array) => {
      const ids = new Int32Array(mask.length).fill(-1), starts: number[] = [];
      for (let i = 0; i < mask.length; i++) {
        if (!mask[i] || ids[i] >= 0) continue;
        const queue = [i], id = starts.length;
        starts.push(i);
        ids[i] = id;
        for (let cursor = 0; cursor < queue.length; cursor++) {
          const index = queue[cursor], x = index % width;
          for (const next of [x ? index - 1 : -1, x < width - 1 ? index + 1 : -1, index - width, index + width]) {
            if (next < 0 || next >= mask.length || !mask[next] || ids[next] >= 0) continue;
            ids[next] = id;
            queue.push(next);
          }
        }
      }
      return { ids, starts };
    };
    const original = groups(before), result = groups(after);
    const parents = result.starts.map(index => original.ids[index]);
    expect(new Set(parents).size).toBe(parents.length);
    const copy = structuredClone(ascent);
    expect(cleanNaturalAscentRemnants(world, copy)).toBe(true);
    expect(copy).toEqual(ascent);
    expect(cleanNaturalBankFragments(world, copy)).toBe(true);
    expect(copy).toEqual(ascent);
  });

  it.each([153025, 12, 71])('keeps the mesh joined and preserves bank geometry in Solo Uplands on seed %i', seed => {
    const island = studies.get(seed)!, layers = islandMeshLayers(island);
    const natural = island.ascents.find(ascent => ascent.kind === 'gully')!;
    const full = island.triangles.filter(triangle => triangle.ascentId === natural.id);
    const solo = layers.uplands.standaloneTriangles.filter(triangle => triangle.ascentId === natural.id);
    expect(topArea(solo)).toBeCloseTo(topArea(full), 6);
    for (const uplands of [false, true]) for (const beaches of [false, true]) {
      expect(topArea(activeIslandLandTriangles(island, { base: true, uplands, beaches }))).toBeCloseTo(
        island.world.cells.reduce((sum, cell) => sum + cell * island.world.tileSize ** 2, 0), 6);
    }
    const edges = island.triangles.flatMap(triangle => {
      const points = triangle.vertices.map(p => ({ x: p.x + p.z * 0.173, y: p.y + p.z * 0.317, z: p.z }));
      return points.map((from, i) => ({ from, to: points[(i + 1) % 3] }));
    });
    expect(openMeshEdges(edges).every(edge => Math.abs(edge.from.z + 4) < 1e-7 && Math.abs(edge.to.z + 4) < 1e-7)).toBe(true);
    const tops = island.triangles.filter(triangle => triangle.plane === 'top' && triangle.ascentId === natural.id);
    for (const triangle of tops) {
      const point = {
        x: triangle.vertices.reduce((sum, p) => sum + p.x / 3, 0),
        y: triangle.vertices.reduce((sum, p) => sum + p.y / 3, 0),
      };
      expect(surface(island, point)).toBeCloseTo(triangle.vertices.reduce((sum, p) => sum + p.z / 3, 0), 8);
    }
  });

  it.each([41, 7])('retains the exact baseline when no open flank fits seed %i', seed => {
    const baseline = generateIslandLandform(seed, { naturalAscent: false }), study = generateIslandLandform(seed);
    expect(study.naturalAscent?.status).toBe('unsupported');
    expect(study.ascents).toEqual(baseline.ascents);
    expect(study.triangles).toEqual(baseline.triangles);
    expect(study.world).toEqual(baseline.world);
  });

  it.each([
    {}, { coastalGeneration: false }, { pilotCove: true }, { pilotCove: true, coordinateCoasts: true },
  ])('uses the final natural ascent in every generation path with options %j', options => {
    const island = generateIslandLandform(153025, options);
    expect(island.naturalAscent?.status).toBe('placed');
    expect(island.ascents.filter(ascent => ascent.kind === 'gully')).toHaveLength(1);
  });

  it('does not apply the study to conditioned internal edge comparisons', () => {
    const baseline = generateIslandLandform(12, { conditionEdges: true, naturalAscent: false });
    const study = generateIslandLandform(12, { conditionEdges: true });
    expect(study.naturalAscent?.status).toBe('unsupported');
    expect(study.triangles).toEqual(baseline.triangles);
  });
});
