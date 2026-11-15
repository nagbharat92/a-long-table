import type { World } from '../../../src/world-family/core/contracts';
import { buildIslandLandform } from '../../../src/world-family/core/island-landform';
import { projectLandVertex, type LandProjection, type LandTriangle } from '../../../src/world-family/core/landform-study';
import { createIslandEnvironment, waterWorldPoint } from '../../../src/world-family/render/island-environment';
import { createIslandOrbitRenderer } from '../../../src/world-family/render/island-orbit-renderer';
import { shadeShoreWater } from '../../../src/world-family/render/island-shore-water';
import { waterBedTransmission, waterTintedBed, WATER_MAX_DEPTH } from '../../../src/world-family/render/island-water-color';
import { projectedWaterColor, WATER_PROJECTED_PALETTE_STEPS } from '../../../src/world-family/render/island-water-projection';
import { DEFAULT_SUN } from '../../../src/world-family/render/island-sun';
import { createWaterSurfaceResponse } from '../../../src/world-family/render/island-water-surface';
import type { IslandShoreSample } from '../../../src/world-family/render/island-shore-field';
import { createDefaultLayersInspection } from '../../../src/world-family/render/landform-diagnostics';

function fixtureIsland(seed: number) {
  const world: World = {
    seed, generatorVersion: 'water-color-fixture', provenance: 'test-fixture',
    width: 16, height: 16, tileSize: 8, seaLevel: 0,
    cells: new Uint8Array(256).fill(1), heights: new Float32Array(256).fill(1),
    elevations: new Uint8Array(256), rampIds: new Int32Array(256).fill(-1), ramps: [],
  };
  return buildIslandLandform(world);
}

function compare(seed: number, projection: Exclude<LandProjection, 'plan'>, depth: number) {
  const island = fixtureIsland(seed);
  island.triangles = [];
  const z = -2.5 - depth;
  const vertices = [{ x: -256, y: -256, z }, { x: 512, y: -256, z },
    { x: 512, y: 512, z }, { x: -256, y: 512, z }];
  const face = (a: number, b: number, c: number): LandTriangle => ({
    vertices: [vertices[a], vertices[b], vertices[c]], plane: 'top', level: 0, submerged: true,
  });
  island.beach.underwaterTriangles = depth >= 0 ? [face(0, 1, 2), face(0, 2, 3)] : [];
  const base = createIslandEnvironment(island, { ...DEFAULT_SUN, intensity: 0, skyFill: 1, mapSize: 512 });
  const sample = (x: number): IslandShoreSample => ({
    distance: x, beachDistance: Math.abs(x), cliffDistance: Infinity, beachWeight: 1,
    kind: 'beach', variation: 0, breakup: 0.5, phase: 0.25, wetWidth: 2, shallowWidth: 12,
  });
  const environment = {
    ...base, shore: { distance: (x: number) => x, sample },
    waterDepth: {
      sample: () => depth >= 0 ? depth : 16,
      bodyDepth: () => depth >= 0 ? depth : 16,
      bedVisibility: () => 1,
    },
    surface: {
      ...base.surface,
      shade: (): readonly [number, number, number] => [160, 150, 90],
      shadeLayer: (): readonly [number, number, number] => [160, 150, 90],
    },
  };
  const canvas = document.createElement('canvas'), size = 320;
  const renderer = createIslandOrbitRenderer(canvas, island, environment);
  if (!renderer) throw new Error('Water color fixture requires WebGL depth textures.');
  const origin = { x: 160.17, y: 100.31 }, center = { x: 64, y: 64 };
  const pixels = new Uint8Array(size * size * 4), gl = canvas.getContext('webgl')!;
  try {
    const layers = createDefaultLayersInspection();
    layers.water.shoreFoam = false;
    renderer.prepare(projection, { width: size, height: size, origin }, { layers }, 0);
    return [0, Math.PI / 4, Math.PI / 2].map(yaw => {
      const seconds = 2.125, camera = { yaw, center };
      renderer.draw(camera, seconds);
      gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const points: number[] = [], indices: number[] = [];
      for (let y = 2; y < size - 2; y += 3) for (let x = 2; x < size - 2; x += 3) {
        const point = waterWorldPoint(x + 0.5 - origin.x, y + 0.5 - origin.y, projection, camera);
        if (point.x < 6 || point.x > 110 || point.y < 8 || point.y > 120) continue;
        if ([point.x, point.y].some(value => Math.abs(value - Math.round(value)) < 0.001)) continue;
        points.push(point.x, point.y);
        indices.push(((size - 1 - y) * size + x) * 4);
      }
      const frame = base.ocean.prepare(new Float64Array(points));
      const response = createWaterSurfaceResponse(base.sun, projection, camera);
      frame.animate(seconds);
      let total = 0, maximum = 0;
      for (let i = 0; i < indices.length; i++) {
        const offset = i * 4, body = frame.basePixels;
        const water = shadeShoreWater(sample(points[i * 2]), seconds, 0,
          [body[offset], body[offset + 1], body[offset + 2]],
          [0, 0, 0], { depth: depth >= 0 ? depth : 16, waterSettings: base.waterSettings,
            bodyColor: projectedWaterColor(depth >= 0 ? depth : 16, base.oceanBake.patches,
              points[i * 2], points[i * 2 + 1], seconds, base.waterSettings, true) }).color;
        const color = frame.shade(i, water);
        const transmission = depth >= 0 ? waterBedTransmission(depth, true) : 0;
        const bottom = waterTintedBed([160, 150, 90], color);
        const composite = color.map((v, channel) => v * (1 - transmission) + bottom[channel] * transmission);
        const expected = response([composite[0], composite[1], composite[2]], points[i * 2], points[i * 2 + 1], seconds, transmission, 1);
        for (let channel = 0; channel < 3; channel++) {
          const error = Math.abs(pixels[indices[i] + channel] - expected[channel]);
          total += error;
          maximum = Math.max(maximum, error);
        }
      }
      const gain = waterTintedBed([160, 150, 90], [100, 100, 100])[0] / 100;
      const transmission = depth >= 0 ? waterBedTransmission(depth, true) : 0;
      const paletteErrorLimit = Math.ceil(5 * (1 + transmission * (gain - 1)));
      return { samples: indices.length, mean: total / (indices.length * 3), maximum, paletteErrorLimit };
    });
  } finally { renderer.destroy(); }
}

function compareEdgeMotion(projection: Exclude<LandProjection, 'plan'>) {
  const island = fixtureIsland(153031);
  island.triangles = [];
  island.beach.underwaterTriangles = [];
  const base = createIslandEnvironment(island, { ...DEFAULT_SUN, mapSize: 512 });
  // Constant coherent noise isolates animated coverage from the existing drifting tone.
  const patches = new Uint8Array(256 ** 2).fill(128);
  const size = 160, viewport = { width: size, height: size, origin: { x: 80.17, y: 30.31 } };
  const camera = { yaw: 0.37, center: { x: 64, y: 64 } };
  const layers = createDefaultLayersInspection();
  layers.water.lighting = false;
  layers.water.surfaceResponse = false;
  layers.water.surfaceHighlights = false;
  layers.water.waves = false;
  layers.water.shoreFoam = false;
  const results = [];
  for (const depth of [28 / 255 * 16, 116 / 255 * 16, 16]) for (const enabled of [true, false]) {
    const settings = { ...base.waterSettings, noiseSpeed: enabled ? 0.2 : 0 };
    const environment = {
      ...base, waterSettings: settings, oceanBake: { ...base.oceanBake, patches },
      shore: {
        ...base.shore, distance: () => 200,
        sample: (): IslandShoreSample => ({
          distance: 200, beachDistance: Infinity, cliffDistance: Infinity, beachWeight: 0,
          kind: 'cliff', variation: 0, breakup: 0, phase: 0, wetWidth: 0, shallowWidth: 0,
        }),
      },
      waterDepth: { sample: () => depth, bodyDepth: () => depth, bedVisibility: () => 0 },
    };
    const canvas = document.createElement('canvas');
    const renderer = createIslandOrbitRenderer(canvas, island, environment);
    if (!renderer) throw new Error('Edge motion fixture requires WebGL depth textures.');
    const gl = canvas.getContext('webgl')!;
    const frames: Uint8Array[] = [];
    let total = 0, maximum = 0, samples = 0;
    try {
      renderer.prepare(projection, viewport, { layers }, 0);
      for (const seconds of [0, 4, 4 + 1 / 60, 8, 12, 16, 2560]) {
        renderer.draw(camera, seconds);
        const pixels = new Uint8Array(size * size * 4);
        gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        frames.push(pixels);
        for (let y = 2; y < size - 2; y++) for (let x = 2; x < size - 2; x++) {
          const point = waterWorldPoint(x + 0.5 - viewport.origin.x, y + 0.5 - viewport.origin.y, projection, camera);
          const expected = projectedWaterColor(depth, patches, point.x, point.y, seconds, settings, true);
          const offset = ((size - 1 - y) * size + x) * 4;
          for (let channel = 0; channel < 3; channel++) {
            const error = Math.abs(pixels[offset + channel] - expected[channel]);
            total += error;
            maximum = Math.max(maximum, error);
          }
          samples++;
        }
      }
      const changed = (a: Uint8Array, b: Uint8Array) => {
        let count = 0;
        for (let i = 0; i < size * size; i++) {
          if ([0, 1, 2].some(channel => a[i * 4 + channel] !== b[i * 4 + channel])) count++;
        }
        return count / (size * size);
      };
      results.push({
        depth, enabled, samples, mean: total / (samples * 3), maximum,
        changedFraction: changed(frames[0], frames[1]),
        nextFrameFraction: changed(frames[1], frames[2]),
        cycleChanges: changed(frames[0], frames[5]),
        clockWrapChanges: changed(frames[0], frames[6]),
      });
    } finally { renderer.destroy(); }
  }
  return results;
}

function compareSurface(projection: Exclude<LandProjection, 'plan'>) {
  const island = fixtureIsland(77);
  island.triangles = [];
  island.beach.underwaterTriangles = [];
  const results: { samples: number; mean: number; maximum: number }[] = [];
  for (const settings of [
    { ...DEFAULT_SUN, mapSize: 512 as const },
    { ...DEFAULT_SUN, azimuth: 35, elevation: 15, skyFill: 0.1, warmth: 0.9, mapSize: 512 as const },
    { ...DEFAULT_SUN, intensity: 0, skyFill: 0, mapSize: 512 as const },
  ]) {
    const base = createIslandEnvironment(island, settings);
    const environment = { ...base, shore: { ...base.shore, distance: (_x: number, _y: number) => 200 } };
    const canvas = document.createElement('canvas'), size = 160;
    const renderer = createIslandOrbitRenderer(canvas, island, environment);
    if (!renderer) throw new Error('Surface response fixture requires WebGL depth textures.');
    const origin = { x: 80.17, y: 30.31 }, center = { x: 64, y: 64 };
    const pixels = new Uint8Array(size * size * 4), gl = canvas.getContext('webgl')!;
    try {
      renderer.prepare(projection, { width: size, height: size, origin }, {}, 0);
      for (const yaw of [0, 0.37, Math.PI / 2, Math.PI]) {
        const camera = { yaw, center }, response = createWaterSurfaceResponse(environment.sun, projection, camera);
        const points: number[] = [], indices: number[] = [];
        for (let y = 2; y < size - 2; y += 4) for (let x = 2; x < size - 2; x += 4) {
          const point = waterWorldPoint(x + 0.5 - origin.x, y + 0.5 - origin.y, projection, camera);
          // This fixture isolates the surface from contact tint and depth propagation.
          if (environment.shore.distance(point.x, point.y) < 128) continue;
          points.push(point.x, point.y);
          indices.push(((size - 1 - y) * size + x) * 4);
        }
        const frame = environment.ocean.prepare(new Float64Array(points));
        for (const seconds of [0, 2.125, 7.5, 2559.875]) {
          renderer.draw(camera, seconds);
          gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          let total = 0, maximum = 0;
          for (let i = 0; i < indices.length; i++) {
            const body = projectedWaterColor(WATER_MAX_DEPTH, environment.oceanBake.patches,
              points[i * 2], points[i * 2 + 1], seconds, environment.waterSettings, true);
            const lit = frame.shade(i, body);
            const expected = response(lit, points[i * 2], points[i * 2 + 1], seconds, 0, 1);
            for (let channel = 0; channel < 3; channel++) {
              const error = Math.abs(pixels[indices[i] + channel] - expected[channel]);
              total += error;
              maximum = Math.max(maximum, error);
            }
          }
          results.push({ samples: indices.length, mean: total / (indices.length * 3), maximum });
        }
      }
    } finally { renderer.destroy(); }
  }
  return results;
}

function compareCoastalSlope(projection: Exclude<LandProjection, 'plan'>) {
  const island = fixtureIsland(153028);
  const environment = createIslandEnvironment(island, { ...DEFAULT_SUN, mapSize: 512 });
  const canvas = document.createElement('canvas'), size = 512;
  const renderer = createIslandOrbitRenderer(canvas, island, environment);
  if (!renderer) throw new Error('Coastal slope fixture requires WebGL depth textures.');
  const viewport = { width: size, height: size, origin: { x: 160.17, y: 165.31 } };
  const pixels = new Uint8Array(size * size * 4), gl = canvas.getContext('webgl')!;
  const layers = createDefaultLayersInspection();
  layers.water.lighting = false;
  layers.water.surfaceResponse = false;
  layers.water.shoreFoam = false;
  layers.water.colorPatches = false;
  const settings = environment.waterSettings;
  const shades = Array.from({ length: WATER_PROJECTED_PALETTE_STEPS * 2 + 1 }, (_, stop) => {
    const first = stop <= WATER_PROJECTED_PALETTE_STEPS;
    const from = first ? settings.shallow : settings.middle, to = first ? settings.middle : settings.deep;
    const t = (first ? stop : stop - WATER_PROJECTED_PALETTE_STEPS) / WATER_PROJECTED_PALETTE_STEPS;
    return from.map((value, channel) => Math.round(value + (to[channel] - value) * t)).join(',');
  });
  const allowed = new Set(shades);
  try {
    renderer.prepare(projection, viewport, { layers }, 0);
    return [0, 0.37, Math.PI / 2, Math.PI].map(yaw => {
      const camera = { yaw, center: { x: 64, y: 64 } };
      const cpu = environment.render(projection, viewport, undefined, { layers }, camera);
      cpu.animate(0);
      renderer.draw(camera, 0);
      gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let total = 0, maximum = 0, samples = 0, shallow = 0, transition = 0, deep = 0, offPalette = 0, mismatches = 0, nonAdjacent = 0;
      for (let y = 2; y < size - 2; y += 2) for (let x = 2; x < size - 2; x += 2) {
        const index = y * size + x;
        const point = waterWorldPoint(x + 0.5 - viewport.origin.x, y + 0.5 - viewport.origin.y, projection, camera);
        const distance = environment.shore.distance(point.x, point.y);
        if (!cpu.waterMask[index] || cpu.raster.depth[index] !== -Infinity || distance < 3) continue;
        const depth = environment.waterDepth.bodyDepth(point.x, point.y);
        if (depth < 3.5) shallow++;
        else if (depth < 12) transition++;
        else deep++;
        samples++;
        const offset = ((size - 1 - y) * size + x) * 4;
        const gpuShade = [...pixels.subarray(offset, offset + 3)].join(',');
        const cpuShade = [...cpu.raster.pixels.subarray(index * 4, index * 4 + 3)].join(',');
        if (!allowed.has(gpuShade)) offPalette++;
        if (gpuShade !== cpuShade) {
          mismatches++;
          if (Math.abs(shades.indexOf(gpuShade) - shades.indexOf(cpuShade)) > 1) nonAdjacent++;
        }
        for (let channel = 0; channel < 3; channel++) {
          const error = Math.abs(pixels[offset + channel] - cpu.raster.pixels[index * 4 + channel]);
          total += error; maximum = Math.max(maximum, error);
        }
      }
      return { yaw, samples, shallow, transition, deep, mean: total / (samples * 3), maximum,
        offPalette, nonAdjacent, mismatchFraction: mismatches / samples };
    });
  } finally { renderer.destroy(); }
}

function finiteShelfDifference(projection: Exclude<LandProjection, 'plan'>) {
  const island = fixtureIsland(153028);
  island.triangles = [];
  island.beach.underwaterTriangles = [];
  const environment = createIslandEnvironment(island, { ...DEFAULT_SUN, intensity: 0, skyFill: 1, mapSize: 512 });
  const vertices = [{ x: 10, y: 10, z: -14.5 }, { x: 100, y: 10, z: -14.5 },
    { x: 100, y: 100, z: -14.5 }, { x: 10, y: 100, z: -14.5 }];
  const sheet: LandTriangle[] = [[0, 1, 2], [0, 2, 3]].map(([a, b, c]) => ({
    vertices: [vertices[a], vertices[b], vertices[c]], plane: 'top', level: 0, submerged: true,
  }));
  const size = 240, camera = { center: { x: 64, y: 64 }, yaw: 0 };
  const viewport = { width: size, height: size, origin: { x: 120.17, y: 60.31 } };
  const frames: Uint8Array[][] = [];
  const layers = createDefaultLayersInspection();
  // Isolate shelf-derived colour from byte-tone changes at the packed depth boundary.
  layers.water.colorPatches = false;
  for (const triangles of [[], sheet]) {
    island.beach.underwaterTriangles = triangles;
    const canvas = document.createElement('canvas');
    const renderer = createIslandOrbitRenderer(canvas, island, environment);
    if (!renderer) throw new Error('Finite shelf fixture requires WebGL depth textures.');
    try {
      renderer.prepare(projection, viewport, { layers }, 0);
      frames.push([0, Math.PI / 4, Math.PI / 2].map(yaw => {
        renderer.draw({ ...camera, yaw }, 0);
        const pixels = new Uint8Array(size * size * 4), gl = canvas.getContext('webgl')!;
        gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return pixels;
      }));
    } finally { renderer.destroy(); }
  }
  return frames[0].map((before, view) => {
    let maximum = 0, changed = 0;
    for (let i = 0; i < before.length; i++) {
      const difference = Math.abs(before[i] - frames[1][view][i]);
      maximum = Math.max(maximum, difference);
      changed += Number(difference > 1);
    }
    return { maximum, changed };
  });
}

function softenedShelfEdges(projection: Exclude<LandProjection, 'plan'>) {
  const island = fixtureIsland(77);
  island.triangles = [];
  const size = 240, origin = { x: 120.17, y: 60.31 }, center = { x: 64, y: 64 };
  const results: { depth: number; edgeSamples: number; edgeMaximum: number; interiorMaximum: number }[] = [];
  for (const depth of [2, 3.5, 5.5]) {
    const z = -2.5 - depth;
    const vertices = [{ x: 10, y: 10, z }, { x: 110, y: 10, z },
      { x: 110, y: 110, z }, { x: 10, y: 110, z }];
    island.beach.underwaterTriangles = [[0, 1, 2], [0, 2, 3]].map(([a, b, c]) => ({
      vertices: [vertices[a], vertices[b], vertices[c]], plane: 'top', level: 0, submerged: true,
    }));
    const environment = createIslandEnvironment(island, { ...DEFAULT_SUN, mapSize: 512 });
    environment.surface.shade = () => [210, 180, 90];
    environment.surface.shadeLayer = environment.surface.shade;
    const canvas = document.createElement('canvas'), renderer = createIslandOrbitRenderer(canvas, island, environment);
    if (!renderer) throw new Error('Shelf edge fixture requires WebGL depth textures.');
    const gl = canvas.getContext('webgl')!, layers = createDefaultLayersInspection();
    layers.water.lighting = false;
    layers.water.shoreFoam = false;
    layers.water.surfaceResponse = false;
    const read = () => {
      const pixels = new Uint8Array(size * size * 4);
      gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    try {
      for (const yaw of [0, Math.PI / 4, Math.PI / 2]) {
        const camera = { yaw, center };
        layers.water.seabedVisibility = false;
        renderer.prepare(projection, { width: size, height: size, origin }, { layers }, 0);
        renderer.draw(camera, 0);
        const hidden = read();
        layers.water.seabedVisibility = true;
        renderer.prepare(projection, { width: size, height: size, origin }, { layers }, 0);
        renderer.draw(camera, 0);
        const shown = read();
        let edgeSamples = 0, edgeMaximum = 0, interiorMaximum = 0;
        for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
          const point = waterWorldPoint(x + 0.5 - origin.x, y + 0.5 - origin.y - depth, projection, camera);
          const edge = Math.min(point.x - 10, 110 - point.x, point.y - 10, 110 - point.y);
          if (edge < 0) continue;
          const offset = ((size - 1 - y) * size + x) * 4;
          const difference = Math.max(...[0, 1, 2].map(c => Math.abs(shown[offset + c] - hidden[offset + c])));
          if (edge < 0.5) { edgeSamples++; edgeMaximum = Math.max(edgeMaximum, difference); }
          if (edge > 8) interiorMaximum = Math.max(interiorMaximum, difference);
        }
        results.push({ depth, edgeSamples, edgeMaximum, interiorMaximum });
      }
    } finally { renderer.destroy(); }
  }
  return results;
}

function compareRefraction(projection: Exclude<LandProjection, 'plan'>, depth = 2) {
  const island = fixtureIsland(153025), width = 240, height = 220;
  island.world.cells.fill(0);
  for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) island.world.cells[y * 16 + x] = 1;
  const sheet = (x0: number, y0: number, x1: number, y1: number, z: number, submerged: boolean): LandTriangle[] => {
    const points = [{ x: x0, y: y0, z }, { x: x1, y: y0, z }, { x: x1, y: y1, z }, { x: x0, y: y1, z }];
    return [[0, 1, 2], [0, 2, 3]].map(([a, b, c]) => ({
      vertices: [points[a], points[b], points[c]], plane: 'top', level: 0, submerged,
    }));
  };
  island.triangles = sheet(50, 40, 70, 80, 4, false);
  island.beach.underwaterTriangles = sheet(0, 0, 128, 128, -2.5 - depth, true);
  const environment = createIslandEnvironment(island, { ...DEFAULT_SUN, mapSize: 512 });
  const shade: typeof environment.surface.shade = (triangle, point) => !triangle.submerged ? [250, 12, 230]
    : (Math.floor(point.x / 24) + Math.floor(point.y / 24)) % 2 ? [80, 140, 110] : [190, 170, 100];
  environment.surface.shade = shade;
  environment.surface.shadeLayer = shade;
  const canvas = document.createElement('canvas'), renderer = createIslandOrbitRenderer(canvas, island, environment);
  if (!renderer) throw new Error('Refraction fixture requires WebGL depth textures.');
  const gl = canvas.getContext('webgl')!;
  const viewport = { width, height, origin: projection === 'oblique' ? { x: 120.17, y: 30.31 } : { x: 60.17, y: 40.31 } };
  const layers = createDefaultLayersInspection();
  layers.water.shoreFoam = false;
  layers.water.lighting = false;
  // Isolate refraction errors from discrete palette choices at depth-texture thresholds.
  layers.water.depthColor = false;
  layers.water.colorPatches = false;
  const read = () => {
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  };
  const gpuOffset = (index: number) => ((height - 1 - Math.floor(index / width)) * width + index % width) * 4;
  try {
    return [0, 0.37, Math.PI / 2].map(yaw => {
      const camera = { yaw, center: { x: 64, y: 64 } };
      layers.water.visible = false;
      const rawCpu = environment.render(projection, viewport, undefined, { layers }, camera);
      renderer.prepare(projection, viewport, { layers }, 0);
      renderer.draw(camera, 0);
      const rawGpu = read();
      layers.water.visible = true;
      layers.water.surfaceResponse = false;
      renderer.prepare(projection, viewport, { layers }, 0);
      renderer.draw(camera, 2.125);
      const undistorted = read();
      layers.water.surfaceResponse = true;
      renderer.prepare(projection, viewport, { layers }, 0);
      // Use identical raw colours; independently rasterized checker edges are not an optics error.
      const originalShade = environment.surface.shade, originalLayerShade = environment.surface.shadeLayer;
      const sameInput: typeof originalShade = (_triangle, point) => {
        const screen = projectLandVertex(point, projection, camera);
        const x = Math.floor(screen.x + viewport.origin.x), y = Math.floor(screen.y + viewport.origin.y);
        if (x < 0 || x >= width || y < 0 || y >= height) throw new Error('Refraction reference sampled outside its raw scene.');
        const offset = gpuOffset(y * width + x);
        return [rawGpu[offset], rawGpu[offset + 1], rawGpu[offset + 2]];
      };
      environment.surface.shade = environment.surface.shadeLayer = sameInput;
      let cpu: ReturnType<typeof environment.render>;
      try {
        cpu = environment.render(projection, viewport, undefined, { layers }, camera);
      } finally {
        environment.surface.shade = originalShade;
        environment.surface.shadeLayer = originalLayerShade;
      }
      let total = 0, maximum = 0, samples = 0, bentPixels = 0, protectedPixels = 0, protectedChanges = 0, maxWetBlue = 0, foregroundLeaks = 0;
      let worst = {};
      const frames: Uint8Array[] = [];
      for (const seconds of [2.125, 4.5, 2.125]) {
        cpu.animate(seconds);
        renderer.draw(camera, seconds);
        const pixels = read();
        frames.push(pixels);
        for (let y = 8; y < height - 8; y++) for (let x = 8; x < width - 8; x++) {
          const index = y * width + x, offset = gpuOffset(index);
          // Use the GPU's own dry marker color at raster edges, not CPU coverage.
          const gpuDry = rawGpu[offset] === 250 && rawGpu[offset + 1] === 12 && rawGpu[offset + 2] === 230;
          if (gpuDry) {
            protectedPixels++;
            if ([0, 1, 2].some(c => pixels[offset + c] !== rawGpu[offset + c])) protectedChanges++;
            continue;
          }
          if (cpu.waterMask[index] && rawCpu.raster.submerged?.[index] && rawGpu[offset + 2] <= 110) {
            maxWetBlue = Math.max(maxWetBlue, pixels[offset + 2]);
            foregroundLeaks += Number(pixels[offset] > 220 && pixels[offset + 1] < 50 && pixels[offset + 2] > 220);
            if (seconds === 2.125 && frames.length === 1
              && [0, 1, 2].some(c => Math.abs(pixels[offset + c] - undistorted[offset + c]) >= 2)) bentPixels++;
          }
          if (!cpu.waterMask[index] || rawCpu.raster.depth[index] === -Infinity) continue;
          let matching = true;
          // Cover both bounded ray offsets, bilinear interpolation and bottom blur.
          for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) {
            const neighbor = index + dy * width + dx, gpu = gpuOffset(neighbor);
            if (!rawCpu.raster.submerged?.[neighbor] || rawGpu[gpu + 1] < 139 || rawGpu[gpu + 2] > 111)
              matching = false;
          }
          if (!matching) continue;
          samples++;
          for (let c = 0; c < 3; c++) {
            const error = Math.abs(pixels[offset + c] - cpu.raster.pixels[index * 4 + c]);
            total += error;
            if (error > maximum) worst = { x, y, seconds, gpu: [...pixels.subarray(offset, offset + 3)],
              cpu: [...cpu.raster.pixels.subarray(index * 4, index * 4 + 3)],
              rawGpu: [...rawGpu.subarray(offset, offset + 3)], rawCpu: [...rawCpu.raster.pixels.subarray(index * 4, index * 4 + 3)],
              point: waterWorldPoint(x + 0.5 - viewport.origin.x, y + 0.5 - viewport.origin.y, projection, camera) };
            maximum = Math.max(maximum, error);
          }
        }
      }
      const frozen = frames[0].every((v, i) => v === frames[2][i]);
      const animated = frames[0].some((v, i) => v !== frames[1][i]);
      let animatedBentPixels = 0;
      for (let i = 0; i < width * height; i++) {
        const offset = gpuOffset(i);
        if (rawCpu.raster.submerged?.[i]
          && [0, 1, 2].some(c => Math.abs(frames[0][offset + c] - frames[1][offset + c]) >= 2)) animatedBentPixels++;
      }
      return { samples, mean: total / (samples * 3), maximum, bentPixels, animatedBentPixels,
        protectedPixels, protectedChanges, maxWetBlue, foregroundLeaks, frozen, animated, worst };
    });
  } finally { renderer.destroy(); }
}

declare global {
  interface Window { islandWaterColorFixture: {
    compare: typeof compare;
    compareSurface: typeof compareSurface;
    compareCoastalSlope: typeof compareCoastalSlope;
    compareEdgeMotion: typeof compareEdgeMotion;
    finiteShelfDifference: typeof finiteShelfDifference;
    softenedShelfEdges: typeof softenedShelfEdges;
    compareRefraction: typeof compareRefraction;
  } }
}
window.islandWaterColorFixture = { compare, compareSurface, compareCoastalSlope, compareEdgeMotion, finiteShelfDifference, softenedShelfEdges, compareRefraction };
