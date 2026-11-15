import { generateIslandLandform } from '../../../src/world-family/core/island-landform';
import { islandOrbitCenter, islandOrbitViewport } from '../../../src/world-family/core/island-view';
import type { LandProjection, LandTriangle } from '../../../src/world-family/core/landform-study';
import { createIslandEnvironment, waterWorldPoint, worldHeightFromDepth } from '../../../src/world-family/render/island-environment';
import { createIslandOrbitRenderer } from '../../../src/world-family/render/island-orbit-renderer';
import { createDefaultLayersInspection } from '../../../src/world-family/render/landform-diagnostics';
import { DEFAULT_SUN } from '../../../src/world-family/render/island-sun';
import { DEFAULT_WATER_SETTINGS, type WaterSettings } from '../../../src/world-family/render/island-water-settings';
import { BEACH_WASH_PERIOD } from '../../../src/world-family/render/island-beach-wash';
import { SHORE_MESH_STRIDE } from '../../../src/world-family/render/island-shore-mesh';
import { ISLAND_WATER_HEIGHT } from '../../../src/world-family/core/island-water-level';

type Mode = 'normal' | 'no-bottom' | 'flat' | 'no-foam' | 'no-depth' | 'raw';
interface RegressionScene {
  island: ReturnType<typeof generateIslandLandform>;
  environment: ReturnType<typeof createIslandEnvironment>;
  camera: { center: { x: number; y: number }; yaw: number };
  viewport: ReturnType<typeof islandOrbitViewport>;
  layers: ReturnType<typeof createDefaultLayersInspection>;
  canvas: HTMLCanvasElement;
  renderer: NonNullable<ReturnType<typeof createIslandOrbitRenderer>>;
  projection: Exclude<LandProjection, 'plan'>;
}
let current: RegressionScene | undefined;

function setup(seed: number, projection: Exclude<LandProjection, 'plan'>, mode: Mode = 'normal',
  settings: Readonly<WaterSettings> = DEFAULT_WATER_SETTINGS): RegressionScene {
  current?.renderer.destroy();
  const island = generateIslandLandform(seed);
  const environment = createIslandEnvironment(island, { ...DEFAULT_SUN, mapSize: 512 }, settings);
  const camera = { center: islandOrbitCenter(island.triangles), yaw: 0 };
  const viewport = islandOrbitViewport([...island.triangles, ...island.beach.underwaterTriangles], projection, camera);
  const layers = createDefaultLayersInspection();
  layers.water.seabedVisibility = mode !== 'no-bottom';
  layers.water.surfaceResponse = mode !== 'flat';
  layers.water.shoreFoam = mode !== 'no-foam';
  layers.water.depthColor = mode !== 'no-depth';
  layers.water.visible = mode !== 'raw';
  const canvas = document.createElement('canvas');
  canvas.style.width = `${viewport.width * 2}px`;
  canvas.style.height = `${viewport.height * 2}px`;
  canvas.style.imageRendering = 'pixelated';
  document.body.replaceChildren(canvas);
  const renderer = createIslandOrbitRenderer(canvas, island, environment);
  if (!renderer) throw new Error('Water regression fixture requires WebGL.');
  renderer.prepare(projection, viewport, { layers }, 0);
  return { island, environment, camera, viewport, layers, canvas, renderer, projection };
}

function prepare(seed = 153028, projection: Exclude<LandProjection, 'plan'> = 'oblique', mode: Mode = 'normal') {
  current = setup(seed, projection, mode);
  const maximumBedHeight = Math.max(...current.island.beach.underwaterTriangles
    .flatMap(triangle => triangle.vertices.map(point => point.z)));
  return { ...current.viewport, maximumBedHeight };
}

function draw(seconds: number, yaw = 0, compareSoftware = false) {
  if (!current) throw new Error('Prepare the regression fixture before drawing.');
  const { renderer, canvas, camera, viewport, environment, projection, layers } = current;
  camera.yaw = yaw;
  renderer.draw(camera, seconds);
  const gl = canvas.getContext('webgl')!;
  const pixels = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let bedPixels = 0, maximum = 0, errors = 0, total = 0, samples = 0;
  const software = compareSoftware ? environment.render(projection, viewport, undefined, { layers }, camera) : undefined;
  software?.animate(seconds);
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    const index = y * canvas.width + x;
    const offset = ((canvas.height - 1 - y) * canvas.width + x) * 4;
    if (pixels[offset] > 95 && pixels[offset + 1] > pixels[offset + 2] + 8) bedPixels++;
    if (!software?.submergedMask[index]) continue;
    samples++;
    for (let c = 0; c < 3; c++) {
      const error = Math.abs(pixels[offset + c] - software.raster.pixels[index * 4 + c]);
      maximum = Math.max(maximum, error);
      total += error;
      errors += Number(error > 15);
    }

  }
  return {
    image: canvas.toDataURL(), bedPixels, maximum, errors, samples,
    mean: samples ? total / (samples * 3) : 0,
  };
}

function probe(seconds: number, yaw: number, points: readonly { x: number; y: number }[]) {
  if (!current) throw new Error('Prepare the regression fixture before probing.');
  const { environment, projection, viewport, camera, layers, canvas, renderer } = current;
  camera.yaw = yaw;
  renderer.draw(camera, seconds);
  const gl = canvas.getContext('webgl')!;
  const rawLayers = createDefaultLayersInspection();
  rawLayers.water.visible = false;
  const raw = environment.render(projection, viewport, undefined, { layers: rawLayers }, camera);
  const frame = environment.render(projection, viewport, undefined, { layers }, camera);
  frame.animate(seconds);
  return points.map(({ x, y }) => {
    const index = y * viewport.width + x;
    const screenY = y + 0.5 - viewport.origin.y;
    const ground = worldHeightFromDepth(screenY, raw.raster.depth[index], projection);
    const point = waterWorldPoint(x + 0.5 - viewport.origin.x, screenY, projection, camera);
    const gpu = new Uint8Array(4);
    gl.readPixels(x, viewport.height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, gpu);
    return {
      x, y, ground, point, submerged: raw.raster.submerged?.[index],
      wave: frame.shoreWaveMask[index], waveHeight: frame.shoreWaveHeights[index],
      gpu: [...gpu.subarray(0, 3)], raw: [...raw.raster.pixels.subarray(index * 4, index * 4 + 3)],
      final: [...frame.raster.pixels.subarray(index * 4, index * 4 + 3)],
      bodyDepth: environment.waterDepth.bodyDepth(point.x, point.y),
    };
  });
}

function compareOcclusion(seed: number, projection: Exclude<LandProjection, 'plan'>, incoming = false) {
  const neutral = {
    ...DEFAULT_WATER_SETTINGS,
    shallow: [45, 100, 113] as const, middle: [45, 100, 113] as const, deep: [45, 100, 113] as const,
    noiseShallow: 0, noiseDeep: 0,
  };
  current = setup(seed, projection, 'normal', neutral);
  const { island, environment, camera, viewport, layers, canvas, renderer } = current;
  const before = JSON.stringify([island.triangles, island.beach.underwaterTriangles, island.world.cells]);
  layers.water.surfaceResponse = false;
  layers.water.lighting = false;
  const phases = new Set<number>();
  for (let i = 4; i < environment.shoreMesh.vertices.length; i += SHORE_MESH_STRIDE) {
    phases.add(environment.shoreMesh.vertices[i]);
  }
  const peaks = [...phases].map(phase => ((0.4 - phase + 1) % 1) * BEACH_WASH_PERIOD);
  const times = [...new Set([...Array.from({ length: 17 }, (_, i) => i / 2), ...peaks])];
  const read = () => {
    const gl = canvas.getContext('webgl')!, pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  };
  const results = [];
  for (const view of [0, 1, 2, 3]) {
    camera.yaw = view * Math.PI / 2;
    const rawLayers = createDefaultLayersInspection();
    rawLayers.water.visible = false;
    const raw = environment.render(projection, viewport, undefined, { layers: rawLayers }, camera);
    const masks = new Map<number, number[]>();
    for (const seconds of incoming ? times : peaks) {
      const cpu = environment.render(projection, viewport, undefined, { layers }, camera);
      cpu.animate(seconds);
      const indices = [];
      for (let y = 1; y < viewport.height - 1; y++) for (let x = 1; x < viewport.width - 1; x++) {
        const index = y * viewport.width + x;
        if (!Number.isFinite(raw.raster.depth[index])) continue;
        const ground = worldHeightFromDepth(y + 0.5 - viewport.origin.y, raw.raster.depth[index], projection);
        if (!raw.raster.submerged?.[index] || ground > ISLAND_WATER_HEIGHT + 1e-6
          || ground < ISLAND_WATER_HEIGHT - 0.76) continue;
        if (![index, index - 1, index + 1, index - viewport.width, index + viewport.width]
          .every(i => cpu.shoreWaveMask[i] && cpu.shoreWaveHeights[i] >= ISLAND_WATER_HEIGHT + (incoming ? 0.55 : 1.99))) continue;
        indices.push(((viewport.height - 1 - y) * viewport.width + x) * 4);
      }
      masks.set(seconds, indices);
    }
    layers.water.seabedVisibility = true;
    renderer.prepare(projection, viewport, { layers }, 0);
    const shown = times.map(seconds => { renderer.draw(camera, seconds); return read(); });
    layers.water.seabedVisibility = false;
    renderer.prepare(projection, viewport, { layers }, 0);
    let maximum = 0, samples = 0, peakFrames = 0;
    let worst = { seconds: 0, x: 0, y: 0 };
    for (const [frame, seconds] of times.entries()) {
      renderer.draw(camera, seconds);
      const hidden = read(), indices = masks.get(seconds);
      if (!indices?.length) continue;
      peakFrames++;
      for (const offset of indices) {
        samples++;
        for (let c = 0; c < 3; c++) {
          const error = Math.abs(shown[frame][offset + c] - hidden[offset + c]);
          if (error > maximum) {
            maximum = error;
            worst = { seconds, x: offset / 4 % viewport.width, y: viewport.height - 1 - Math.floor(offset / 4 / viewport.width) };
          }
        }
      }
    }
    const first = shown[times.indexOf(0)], last = shown[times.indexOf(8)];
    layers.water.seabedVisibility = true;
    const detail = incoming && maximum > 0 ? probe(worst.seconds, camera.yaw, [worst])[0] : undefined;
    results.push({ view, samples, maximum, peakFrames, worst: incoming ? { ...worst, detail } : undefined,
      continuous: first.every((value, index) => value === last[index]), frames: times.length });
    layers.water.seabedVisibility = true;
  }
  renderer.destroy();
  if (JSON.stringify([island.triangles, island.beach.underwaterTriangles, island.world.cells]) !== before) {
    throw new Error('Water occlusion changed source geometry.');
  }
  current = undefined;
  return results;
}

function compareShelfContours(seed: number, projection: Exclude<LandProjection, 'plan'>) {
  const neutral = {
    ...DEFAULT_WATER_SETTINGS,
    shallow: [45, 100, 113] as const, middle: [45, 100, 113] as const, deep: [45, 100, 113] as const,
    noiseShallow: 0, noiseDeep: 0,
  };
  current = setup(seed, projection, 'normal', neutral);
  const { island, environment, camera, viewport, layers, canvas, renderer } = current;
  const before = JSON.stringify([island.triangles, island.beach.underwaterTriangles, island.world.cells]);
  layers.water.surfaceResponse = true;
  layers.water.lighting = false;
  const times = Array.from({ length: 17 }, (_, i) => i / 2);
  const read = (target = canvas) => {
    const gl = target.getContext('webgl')!, pixels = new Uint8Array(target.width * target.height * 4);
    gl.readPixels(0, 0, target.width, target.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  };
  // Classify the actual GPU-owned primitive, including subpixel triangle edges.
  const faceCanvas = document.createElement('canvas');
  const faceShade = (triangle: LandTriangle) =>
    [Number(Boolean(triangle.submerged)) * 255, Number(triangle.plane !== 'top') * 255, 0] as const;
  const faceRenderer = createIslandOrbitRenderer(faceCanvas, island, {
    ...environment, surface: { ...environment.surface, shade: faceShade, shadeLayer: faceShade },
  });
  if (!faceRenderer) throw new Error('Shelf contour classification requires WebGL.');
  const results = [];
  for (let view = 0; view < 4; view++) {
    camera.yaw = view * Math.PI / 2;
    const rawLayers = createDefaultLayersInspection();
    rawLayers.water.visible = false;
    const raw = environment.render(projection, viewport, undefined, { layers: rawLayers }, camera);
    faceRenderer.prepare(projection, viewport, { layers: rawLayers }, 0);
    faceRenderer.draw(camera, 0);
    const faces = read(faceCanvas);
    const edges: number[] = [], interiors: number[] = [], protectedLand: number[] = [];
    for (let y = 0; y < viewport.height; y++) for (let x = 0; x < viewport.width; x++) {
      const index = y * viewport.width + x;
      const offset = ((viewport.height - 1 - y) * viewport.width + x) * 4;
      if (faces[offset] === 0) {
        protectedLand.push(offset);
        continue;
      }
      if (faces[offset] !== 255) continue;
      if (faces[offset + 1] === 255) edges.push(offset);
      else if (raw.raster.submerged?.[index] && Number.isFinite(raw.raster.depth[index])) {
        const ground = worldHeightFromDepth(y + 0.5 - viewport.origin.y, raw.raster.depth[index], projection);
        const bottom = waterWorldPoint(x + 0.5 - viewport.origin.x,
          y + 0.5 - viewport.origin.y + ground - ISLAND_WATER_HEIGHT, projection, camera);
        if (environment.waterDepth.bedVisibility(bottom.x, bottom.y) > 0.9
          && ground > ISLAND_WATER_HEIGHT - 3.5) interiors.push(offset);
      }
    }
    layers.water.seabedVisibility = true;
    renderer.prepare(projection, viewport, { layers }, 0);
    const shown = times.map(seconds => { renderer.draw(camera, seconds); return read(); });
    layers.water.seabedVisibility = false;
    renderer.prepare(projection, viewport, { layers }, 0);
    let maximum = 0, interiorMaximum = 0, protectedChanges = 0;
    let worst: { seconds: number; x: number; y: number; shown: number[]; hidden: number[] } =
      { seconds: 0, x: 0, y: 0, shown: [], hidden: [] };
    for (const [frame, seconds] of times.entries()) {
      renderer.draw(camera, seconds);
      const hidden = read();
      for (const offset of edges) for (let c = 0; c < 3; c++) {
        const error = Math.abs(shown[frame][offset + c] - hidden[offset + c]);
        if (error > maximum) {
          maximum = error;
          worst = {
            seconds, x: offset / 4 % viewport.width, y: viewport.height - 1 - Math.floor(offset / 4 / viewport.width),
            shown: [...shown[frame].subarray(offset, offset + 3)], hidden: [...hidden.subarray(offset, offset + 3)],
          };
        }
      }
      for (const offset of interiors) for (let c = 0; c < 3; c++)
        interiorMaximum = Math.max(interiorMaximum, Math.abs(shown[frame][offset + c] - hidden[offset + c]));
      for (const offset of protectedLand) for (let c = 0; c < 3; c++)
        protectedChanges += Number(shown[frame][offset + c] !== hidden[offset + c]);
    }
    results.push({
      view, edgeSamples: edges.length * times.length, maximum,
      interiorSamples: interiors.length, interiorMaximum, protectedChanges, frames: times.length, worst,
    });
    layers.water.seabedVisibility = true;
  }
  faceRenderer.destroy();
  renderer.destroy();
  current = undefined;
  if (JSON.stringify([island.triangles, island.beach.underwaterTriangles, island.world.cells]) !== before)
    throw new Error('Shelf contour rendering changed source geometry.');
  return results;
}

function compareVisibleFinish(seed: number, projection: Exclude<LandProjection, 'plan'>) {
  current = setup(seed, projection);
  const { island, environment, camera, viewport, layers, canvas, renderer } = current;
  const source = JSON.stringify([island.triangles, island.beach.underwaterTriangles, island.world.cells]);
  const unbentCanvas = document.createElement('canvas');
  const gl = unbentCanvas.getContext('webgl');
  if (!gl) throw new Error('Visible refraction comparison requires WebGL.');
  const originalSource = gl.shaderSource;
  let replacements = 0, classifications = 0;
  gl.shaderSource = function (shader, code) {
    const target = 'vec2 offset=u_surfaceResponse > 0.5 ? waterRefractionOffset(surfaceHeight-ground,distance,normal,u_waterView) : vec2(0.0);';
    const raw = 'gl_FragColor = vec4(land.a > 0.0 ? land.rgb : vec3(82.0,105.0,106.0)/255.0, 1.0);';
    if (code.includes(target)) replacements++;
    if (code.includes(raw)) classifications++;
    originalSource.call(this, shader, code.replace(target, 'vec2 offset=vec2(0.0);')
      .replace(raw, 'gl_FragColor = vec4(land.a > 0.35 && land.a < 0.65 ? vec3(1.0,0.0,0.0) : land.a >= 0.65 && groundHeight(v_uv) > u_waterHeight+2.01 ? vec3(0.0,1.0,0.0) : vec3(0.0), 1.0);'));
  };
  let unbent: ReturnType<typeof createIslandOrbitRenderer>;
  try {
    unbent = createIslandOrbitRenderer(unbentCanvas, island, environment);
  } finally {
    gl.shaderSource = originalSource;
  }
  if (!unbent || replacements !== 2 || classifications !== 2)
    throw new Error('Refraction and GPU-owned bed classification must be isolated in both water shaders.');
  const read = (target = canvas) => {
    const context = target.getContext('webgl')!;
    const pixels = new Uint8Array(target.width * target.height * 4);
    context.readPixels(0, 0, target.width, target.height, context.RGBA, context.UNSIGNED_BYTE, pixels);
    return pixels;
  };
  const difference = (a: Uint8Array, b: Uint8Array, indices: readonly number[]) => {
    let changed = 0, visible = 0, total = 0;
    for (const offset of indices) {
      const delta = Math.max(...[0, 1, 2].map(channel => Math.abs(a[offset + channel] - b[offset + channel])));
      changed += Number(delta > 0);
      visible += Number(delta >= 4);
      total += delta;
    }
    return { samples: indices.length, changed, visible, mean: total / Math.max(1, indices.length) };
  };
  const results = [];
  const images: Record<string, string> = {};
  let fringe: { samples: number; changed: number; visible: number; mean: number; disabledMotion: number } | undefined;
  try {
    for (let view = 0; view < 4; view++) {
      camera.yaw = view * Math.PI / 2;
      const rawLayers = createDefaultLayersInspection();
      rawLayers.water.visible = false;
      const raw = environment.render(projection, viewport, undefined, { layers: rawLayers }, camera);
      layers.water.visible = false;
      unbent.prepare(projection, viewport, { layers }, 0);
      unbent.draw(camera, 0);
      const gpuBeds = read(unbentCanvas);
      layers.water.visible = true;
      const beds: number[] = [], protectedLand: number[] = [], ocean: number[] = [];
      for (let y = 1; y < viewport.height - 1; y++) for (let x = 1; x < viewport.width - 1; x++) {
        const index = y * viewport.width + x;
        const offset = ((viewport.height - 1 - y) * viewport.width + x) * 4;
        if (!Number.isFinite(raw.raster.depth[index])) { ocean.push(offset); continue; }
        const ground = worldHeightFromDepth(y + 0.5 - viewport.origin.y, raw.raster.depth[index], projection);
        if (!raw.raster.submerged?.[index]) {
          if (ground > ISLAND_WATER_HEIGHT + 2.01 && gpuBeds[offset + 1] === 255) protectedLand.push(offset);
          continue;
        }
        if (gpuBeds[offset] !== 255 || ![index, index - 1, index + 1, index - viewport.width, index + viewport.width]
          .every(i => raw.raster.submerged?.[i])) continue;
        const bottom = waterWorldPoint(x + 0.5 - viewport.origin.x,
          y + 0.5 - viewport.origin.y + ground - ISLAND_WATER_HEIGHT, projection, camera);
        if (ground <= ISLAND_WATER_HEIGHT - 0.5 && ground >= ISLAND_WATER_HEIGHT - 2.01
          && environment.waterDepth.bedVisibility(bottom.x, bottom.y) > 0.25) beds.push(offset);
      }
      renderer.prepare(projection, viewport, { layers }, 0);
      unbent.prepare(projection, viewport, { layers }, 0);
      const frames = [0, 1, 2, 3, 4, 5, 6, 7].map(seconds => {
        renderer.draw(camera, seconds);
        const normal = read();
        unbent!.draw(camera, seconds);
        const flat = read(unbentCanvas);
        layers.water.seabedVisibility = false;
        renderer.draw(camera, seconds);
        const hidden = read();
        layers.water.seabedVisibility = true;
        let brown = 0;
        for (const offset of beds) {
          if (hidden[offset + 1] > hidden[offset] + 20 && hidden[offset + 2] > hidden[offset] + 20
            && (normal[offset] > normal[offset + 1] || normal[offset] > normal[offset + 2])) brown++;
        }
        if (view === 0 && seconds === 2) {
          renderer.draw(camera, seconds);
          images.normal = canvas.toDataURL();
          images.noRefraction = unbentCanvas.toDataURL();
          layers.water.seabedVisibility = false;
          renderer.draw(camera, seconds);
          images.noBottom = canvas.toDataURL();
          layers.water.seabedVisibility = true;
        }
        return { normal, flat, hidden, brown };
      });
      let animatedRefraction = 0, protectedChanges = 0;
      const bentPixels = beds.filter(offset => frames.some(frame =>
        [0, 1, 2].some(c => Math.abs(frame.normal[offset + c] - frame.flat[offset + c]) >= 4))).length;
      for (const offset of beds) {
        const first = frames[0], later = frames[2];
        if ([0, 1, 2].some(channel => Math.abs(
          (first.normal[offset + channel] - first.flat[offset + channel])
          - (later.normal[offset + channel] - later.flat[offset + channel]),
        ) >= 3)) animatedRefraction++;
      }
      for (const frame of frames) {
        protectedChanges += difference(frame.normal, frame.flat, protectedLand).changed;
        protectedChanges += difference(frame.normal, frame.hidden, protectedLand).changed;
      }
      results.push({
        view, beds: beds.length, protectedPixels: protectedLand.length, protectedChanges, animatedRefraction, bentPixels,
        frames: frames.map((frame, i) => ({
          seconds: i, bottom: difference(frame.normal, frame.hidden, beds),
          refraction: difference(frame.normal, frame.flat, beds), brown: frame.brown,
        })),
      });
      if (view === 0) {
        layers.water.surfaceResponse = false;
        layers.water.surfaceHighlights = false;
        layers.water.waves = false;
        layers.water.shoreFoam = false;
        layers.water.seabedVisibility = false;
        renderer.prepare(projection, viewport, { layers }, 0);
        renderer.draw(camera, 0);
        const first = read();
        images.fringeBefore = canvas.toDataURL();
        renderer.draw(camera, 4);
        const later = read();
        images.fringeAfter = canvas.toDataURL();
        const motion = difference(first, later, ocean);
        const settings = environment.waterSettings;
        environment.setWaterSettings({ ...settings, noiseSpeed: 0 });
        renderer.draw(camera, 0);
        const frozen = read();
        renderer.draw(camera, 4);
        const disabledMotion = difference(frozen, read(), ocean).changed;
        environment.setWaterSettings(settings);
        Object.assign(layers.water, createDefaultLayersInspection().water);
        fringe = { ...motion, disabledMotion };
      }
    }
    renderer.draw(camera, 2);
    if (JSON.stringify([island.triangles, island.beach.underwaterTriangles, island.world.cells]) !== source)
      throw new Error('Visible water finish changed terrain or seabed geometry.');
    if (!fringe) throw new Error('The visible fringe comparison did not run.');
    return { seed, projection, results, fringe, images };
  } finally {
    unbent.destroy();
    renderer.destroy();
    current = undefined;
  }
}

declare global {
  interface Window {
    islandWaterRegression: {
      prepare: typeof prepare; draw: typeof draw; probe: typeof probe;
      compareOcclusion: typeof compareOcclusion; compareShelfContours: typeof compareShelfContours;
      compareVisibleFinish: typeof compareVisibleFinish;
    };
  }
}
window.islandWaterRegression = { prepare, draw, probe, compareOcclusion, compareShelfContours, compareVisibleFinish };
