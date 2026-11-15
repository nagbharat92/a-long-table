import type { World } from '../../../src/world-family/core/contracts';
import { buildIslandLandform } from '../../../src/world-family/core/island-landform';
import { projectLandVertex, type LandProjection } from '../../../src/world-family/core/landform-study';
import { createIslandEnvironment, waterWorldPoint, worldHeightFromDepth } from '../../../src/world-family/render/island-environment';
import { createIslandOrbitRenderer } from '../../../src/world-family/render/island-orbit-renderer';
import { createDefaultLayersInspection } from '../../../src/world-family/render/landform-diagnostics';
import { DEFAULT_SUN } from '../../../src/world-family/render/island-sun';
import { shoreMeshTriangles } from '../../../src/world-family/render/island-shore-mesh';
import { ISLAND_WATER_HEIGHT } from '../../../src/world-family/core/island-water-level';
import { BEACH_WASH_PERIOD } from '../../../src/world-family/render/island-beach-wash';

function compare(projection: Exclude<LandProjection, 'plan'>, mixed = false) {
  const cells = new Uint8Array(256);
  for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) cells[y * 16 + x] = 1;
  const heights = new Float32Array(256).fill(0.012);
  if (mixed) {
    for (let y = 3; y < 13; y++) for (let x = 8; x < 13; x++) heights[y * 16 + x] = 0.6;
    for (let y = 3; y < 7; y++) for (let x = 6; x < 10; x++) cells[y * 16 + x] = 0;
  }
  const world: World = {
    seed: 153025, generatorVersion: 'beach-wash-fixture', provenance: 'test-fixture',
    width: 16, height: 16, tileSize: 8, seaLevel: 0,
    cells, heights,
    elevations: new Uint8Array(256), rampIds: new Int32Array(256).fill(-1), ramps: [],
  };
  const island = buildIslandLandform(world);
  const environment = createIslandEnvironment(island, { ...DEFAULT_SUN, intensity: 0, skyFill: 1, mapSize: 512 });
  const canvas = document.createElement('canvas'), width = 320, height = 240;
  const renderer = createIslandOrbitRenderer(canvas, island, environment);
  if (!renderer) throw new Error('Beach wash fixture requires WebGL depth textures.');
  const gl = canvas.getContext('webgl')!;
  const subpixelEdge = Math.SQRT2 / 2 ** (gl.getParameter(gl.SUBPIXEL_BITS) + 1) + 0.0001;
  const pixels = new Uint8Array(width * height * 4);
  const viewport = { width, height, origin: projection === 'oblique' ? { x: 160.17, y: 40.31 } : { x: 80.17, y: 60.31 } };
  const layers = createDefaultLayersInspection();
  layers.water.shoreFoam = false;
  try {
    const yaws = mixed ? [0, Math.PI / 2, Math.PI, Math.PI * 1.5] : [0, 0.37, Math.PI / 2];
    return yaws.map(yaw => {
      const camera = { yaw, center: { x: 64, y: 64 } };
      const cpu = environment.render(projection, viewport, undefined, {}, camera);
      const baseline = environment.render(projection, viewport, undefined, { layers }, camera);
      const depths = cpu.raster.depth.slice();
      const times = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75].map(cycle => cycle * BEACH_WASH_PERIOD);
      renderer.prepare(projection, viewport, { layers }, 0);
      const reference = times.map(seconds => {
        renderer.draw(camera, seconds);
        const image = new Uint8Array(pixels.length);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, image);
        return image;
      });
      renderer.prepare(projection, viewport, {}, 0);
      let total = 0, samples = 0, maximum = 0, movingDryPixels = 0, foamSamples = 0, protectedChanges = 0;
      let deltaTotal = 0, deltaMaximum = 0;
      let rockFoamSamples = 0;
      let whiteFoamPixels = 0, expectedWhiteFoamPixels = 0;
      let rasterEdgeSamples = 0;
      let worst = { x: 0, y: 0, seconds: 0, dry: false, foam: false, gpu: [] as number[], cpu: [] as number[], baseline: [] as number[], ground: 0 };
      let strongDryPixels = 0, peakDryPixels = 0;
      for (const [time, seconds] of times.entries()) {
        let visibleDryPixels = 0;
        cpu.animate(seconds);
        baseline.animate(seconds);
        renderer.draw(camera, seconds);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        const meshEdges = new Map(shoreMeshTriangles(environment.shoreMesh, seconds).map(triangle => {
          const x = Math.min(...triangle.vertices.map(p => p.x)), y = Math.min(...triangle.vertices.map(p => p.y));
          const half = Number(triangle.vertices[1].y !== y);
          const projected = triangle.vertices.map(p => {
            const point = projectLandVertex(p, projection, camera);
            return { x: point.x + viewport.origin.x, y: point.y + viewport.origin.y };
          });
          return [`${x},${y},${half}`, projected] as const;
        }));
        for (let y = 2; y < height - 2; y++) for (let x = 2; x < width - 2; x++) {
          const index = y * width + x, offset = ((height - 1 - y) * width + x) * 4;
          // Compare matching treads, excluding geometry edges rather than the moving water front.
          const neighbors = [index, index - 1, index + 1, index - width, index + width];
          const groundHeight = (i: number) => worldHeightFromDepth(Math.floor(i / width) + 0.5 - viewport.origin.y, cpu.raster.depth[i], projection);
          const dry = neighbors.every(i => cpu.beachWashMask[i] === 1
            && Math.abs(groundHeight(i) - groundHeight(index)) < 1e-6);
          const foam = neighbors.every(i => cpu.waterMask[i] === 1) && cpu.foamMask[index] === 1;
          if (cpu.foamMask[index]) {
            const color = [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
            if (Math.min(...color) > 220 && Math.max(...color) - Math.min(...color) < 20) whiteFoamPixels++;
            const expected = [...cpu.raster.pixels.subarray(index * 4, index * 4 + 3)];
            if (Math.min(...expected) > 220 && Math.max(...expected) - Math.min(...expected) < 20) expectedWhiteFoamPixels++;
          }
          if (foam && !cpu.shoreWaveMask[index]) {
            const point = waterWorldPoint(x + 0.5 - viewport.origin.x, y + 0.5 - viewport.origin.y, projection, camera);
            if (environment.shore.sample(point.x, point.y).beachWeight < 0.6) rockFoamSamples++;
          }
          const protectedPixel = neighbors.every(i => !cpu.waterMask[i] && !cpu.beachWashMask[i])
            || cpu.oceanOnlyMask[index] === 1;
          if (protectedPixel && [0, 1, 2].some(c => pixels[offset + c] !== reference[time][offset + c])) protectedChanges++;
          if (!dry && !foam) continue;
          // Compare matching visible surfaces, not pre-existing atlas/raster edge differences.
          if ([0, 1, 2].some(c => Math.abs(reference[time][offset + c] - baseline.raster.pixels[index * 4 + c]) > 2)) continue;
          if (dry && [0, 1, 2].some(c => pixels[offset + c] !== reference[time][offset + c])) movingDryPixels++;
          if (dry && [0, 1, 2].some(c => Math.abs(pixels[offset + c] - reference[time][offset + c]) >= 20)) {
            strongDryPixels++;
            visibleDryPixels++;
          }
          if (foam) foamSamples++;
          // A displaced water silhouette has its own raster edges, separate from terrain treads.
          if (!neighbors.every(i => cpu.shoreWaveMask[i] === cpu.shoreWaveMask[index])) continue;
          if (cpu.shoreWaveMask[index]) {
            const point = waterWorldPoint(x + 0.5 - viewport.origin.x,
              y + 0.5 - viewport.origin.y + cpu.shoreWaveHeights[index] - ISLAND_WATER_HEIGHT, projection, camera);
            const cellX = Math.floor(point.x), cellY = Math.floor(point.y);
            const half = Number(point.x - cellX < point.y - cellY);
            const triangle = meshEdges.get(`${cellX},${cellY},${half}`);
            if (!triangle) throw new Error('Missing local-wave triangle in the raster-edge fixture.');
            const edge = Math.min(...triangle.map((a, i) => {
              const b = triangle[(i + 1) % 3], dx = b.x - a.x, dy = b.y - a.y;
              return Math.abs(dx * (y + 0.5 - a.y) - dy * (x + 0.5 - a.x)) / Math.hypot(dx, dy);
            }));
            // Hardware vertex snapping can select the adjoining triangle inside this measured bound.
            if (edge <= subpixelEdge) { rasterEdgeSamples++; continue; }
          }
          samples++;
          for (let channel = 0; channel < 3; channel++) {
            const error = Math.abs(pixels[offset + channel] - cpu.raster.pixels[index * 4 + channel]);
            total += error;
            if (error > maximum) worst = {
              x, y, seconds, dry, foam,
              gpu: [...pixels.subarray(offset, offset + 3)],
              cpu: [...cpu.raster.pixels.subarray(index * 4, index * 4 + 3)],
              baseline: [...baseline.raster.pixels.subarray(index * 4, index * 4 + 3)],
              ground: Number.isFinite(cpu.raster.depth[index]) ? groundHeight(index) : -Infinity,
            };
            maximum = Math.max(maximum, error);
            const deltaError = Math.abs((pixels[offset + channel] - reference[time][offset + channel])
              - (cpu.raster.pixels[index * 4 + channel] - baseline.raster.pixels[index * 4 + channel]));
            deltaTotal += deltaError;
            deltaMaximum = Math.max(deltaMaximum, deltaError);
          }
        }
        peakDryPixels = Math.max(peakDryPixels, visibleDryPixels);
      }
      if (!cpu.raster.depth.every((value, i) => value === depths[i])) throw new Error('Beach wash changed CPU geometry depth.');
      return { samples, mean: total / (samples * 3), maximum, movingDryPixels, foamSamples, protectedChanges,
        deltaMean: deltaTotal / (samples * 3), deltaMaximum, strongDryPixels, peakDryPixels, rockFoamSamples,
        whiteFoamPixels, expectedWhiteFoamPixels, rasterEdgeSamples, subpixelEdge, worst };
    });
  } finally { renderer.destroy(); }
}

declare global {
  interface Window { islandBeachWashFixture: { compare: typeof compare } }
}
window.islandBeachWashFixture = { compare };
