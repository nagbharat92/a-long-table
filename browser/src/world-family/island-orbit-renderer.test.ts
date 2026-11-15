import { describe, expect, it, vi } from 'vitest';
import { buildIslandLandform, generateIslandLandform, type IslandLandform } from './core/island-landform';
import type { World } from './core/contracts';
import type { LandTriangle } from './core/landform-study';
import { createIslandEnvironment } from './render/island-environment';
import { createIslandOrbitRenderer } from './render/island-orbit-renderer';
import { createIslandOcean } from './render/island-ocean';
import { createDefaultLayersInspection, soloIslandLayer } from './render/landform-diagnostics';
import { DEFAULT_SUN } from './render/island-sun';
import { waterViewDirection } from './render/island-water-surface';
import { DEFAULT_WATER_SETTINGS } from './render/island-water-settings';

function fixture() {
  let resource = 0, cpuSamples = 0, draws = 0, uploads = 0;
  const live = new Set<object>();
  const uniforms = new Map<string, number[]>();
  const images: object[] = [];
  const textureParameters = new Map<object, Map<unknown, unknown>>();
  let boundTexture: object;
  let visibilitySamples = 0;
  const allocations: { image: object; width: number; height: number; pixels: Uint8Array | Uint8ClampedArray | null }[] = [];
  const source: string[] = [];
  const meshes: Float32Array[] = [];
  const listeners = new Map<string, EventListener>();
  const allocate = () => { const item = { id: ++resource }; live.add(item); return item; };
  const constants = new Map<string, number>();
  const methods: Record<string, unknown> = {
    getExtension: () => ({}),
    getParameter: () => 2048,
    getShaderPrecisionFormat: () => ({ precision: 23 }),
    createShader: allocate, createProgram: allocate, createBuffer: allocate, createFramebuffer: allocate,
    createTexture: () => { const image = allocate(); images.push(image); return image; },
    bindTexture: (_target: unknown, image: object) => { boundTexture = image; },
    texParameteri: (_target: unknown, name: unknown, value: unknown) => {
      if (!textureParameters.has(boundTexture)) textureParameters.set(boundTexture,new Map());
      textureParameters.get(boundTexture)!.set(name,value);
    },
    deleteShader: (value: object) => live.delete(value),
    deleteProgram: (value: object) => live.delete(value),
    deleteTexture: (value: object) => live.delete(value),
    deleteBuffer: (value: object) => live.delete(value),
    deleteFramebuffer: (value: object) => live.delete(value),
    shaderSource: (_: unknown, value: string) => source.push(value),
    getShaderParameter: () => true, getProgramParameter: () => true,
    getUniformLocation: (_: unknown, name: string) => name,
    getAttribLocation: (_: unknown, name: string) => ({ a_position: 0,a_uv: 1,a_barycentric: 2,a_bounds: 3,a_shore: 1,a_gradient: 2,a_beachGradient: 4 })[name],
    bufferData: (_target: unknown, data: Float32Array) => meshes.push(data),
    uniform1f: (name: string, value: number) => uniforms.set(name,[value]),
    uniform1i: (name: string, value: number) => uniforms.set(name,[value]),
    uniform2f: (name: string, a: number, b: number) => uniforms.set(name,[a,b]),
    uniform3f: (name: string, a: number, b: number, c: number) => uniforms.set(name,[a,b,c]),
    uniform4f: (name: string, a: number, b: number, c: number, d: number) => uniforms.set(name,[a,b,c,d]),
    texImage2D: (_target: unknown, _level: unknown, _internal: unknown, width: number, height: number,
      _border: unknown, _format: unknown, _type: unknown, pixels: Uint8Array | Uint8ClampedArray | null) => {
      uploads++;
      allocations.push({ image: boundTexture,width,height,pixels });
    },
    drawArrays: () => draws++,
    checkFramebufferStatus: () => constants.get('FRAMEBUFFER_COMPLETE'),
  };
  const gl = new Proxy(methods,{
    get(target,key: string) {
      if (key in target) return target[key];
      if (key === key.toUpperCase()) {
        if (!constants.has(key)) constants.set(key,constants.size+1);
        return constants.get(key);
      }
      return () => {};
    },
  });
  // Populate the framebuffer constant before the status stub is invoked.
  void gl.FRAMEBUFFER_COMPLETE;
  const canvas = {
    width: 0,height: 0,dataset: {} as Record<string,string>,
    getContext: () => gl,
    addEventListener: (name: string, listener: EventListener) => listeners.set(name,listener),
    removeEventListener: (name: string) => listeners.delete(name),
  } as unknown as HTMLCanvasElement;
  const world: World = {
    seed: 1,generatorVersion: 'test',width: 2,height: 2,tileSize: 4,seaLevel: 0,
    cells: new Uint8Array(4),heights: new Float32Array(4),provenance: 'test-fixture',
  };
  const top: LandTriangle = { vertices: [{ x: 0,y: 0,z: 0 },{ x: 4,y: 0,z: 0 },{ x: 0,y: 4,z: 0 }],plane: 'top',level: 0 };
  const shelf: LandTriangle = { ...top,submerged: true,vertices: top.vertices.map(point => ({ ...point,z: -3 })) as unknown as LandTriangle['vertices'] };
  const island = { world,triangles: [top],beach: { underwaterTriangles: [shelf] } } as IslandLandform;
  const surface = {
    shade: (_triangle: LandTriangle, point: { x: number; y: number }) => { cpuSamples++; return [point.x*10,point.y*10,40]; },
    regions: () => { cpuSamples++; return [100,120,140]; },
  };
  const sun = {
    settings: { ...DEFAULT_SUN },
    direction: { x: 0,y: -Math.SQRT1_2,z: Math.SQRT1_2 },
    visibility: () => { cpuSamples++; visibilitySamples++; return 1; },
    shade: (color: number[]) => { cpuSamples++; return color; },
  };
  const environment = {
    surface,sun,waterSettings: DEFAULT_WATER_SETTINGS,
    waterDepth: { sample: () => 16, bodyDepth: () => 16, bedVisibility: () => 1 },
    shoreMesh: { vertices: new Float32Array() },
    setLayers: vi.fn(),
    oceanBake: createIslandOcean(1).bake,
    shore: { distance: () => { cpuSamples++; return 200; } },
    ocean: {
      prepare: (points: Float32Array) => {
        cpuSamples++;
        const pixels = new Uint8ClampedArray(points.length*2).fill(100);
        return { pixels,unlitPixels: pixels,animate: () => {} };
      },
    },
  } as unknown as ReturnType<typeof createIslandEnvironment>;
  return {
    canvas,gl,environment,island,uniforms,allocations,source,listeners,live,images,textureParameters,meshes,
    counts: () => ({ cpuSamples,draws,uploads }),
    visibilitySamples: () => visibilitySamples,
  };
}

const viewport = { width: 80,height: 60,origin: { x: 40,y: 20 } };

describe('cached island GPU presentation',() => {
  it('draws beach geometry with the shared clock, without per-frame uploads or CPU sampling', () => {
    const f = fixture();
    Object.assign(f.environment, { shoreMesh: { vertices: new Float32Array([
      0, 0, 3, 1, 0, 0.4, 1, 0, 0, 0,
      1, 0, 4, 1, 0, 0.4, 1, 0, 0, 0,
      0, 1, 3, 1, 0, 0.4, 1, 0, 0, 0,
    ]) } });
    const renderer = createIslandOrbitRenderer(f.canvas, f.island, f.environment)!;
    renderer.prepare('oblique', viewport, {}, 0);
    expect(f.canvas.dataset.shoreWaveTriangles).toBe('1');
    const before = f.counts();
    renderer.draw({ yaw: 0.37, center: { x: 4, y: 4 } }, 1.28);
    expect(f.counts()).toEqual({ ...before, draws: before.draws + 4 });
    expect(f.uniforms.get('u_seconds')).toEqual([1.28]);
    expect(f.uniforms.get('u_waterShallow')).toEqual([...DEFAULT_WATER_SETTINGS.shallow]);
    expect(f.uniforms.get('u_waveEndSoftness')).toEqual([DEFAULT_WATER_SETTINGS.waveEndSoftness]);
    const layers = createDefaultLayersInspection();
    layers.water.shoreFoam = false;
    renderer.prepare('oblique', viewport, { layers }, 1.28);
    const flat = f.counts();
    renderer.draw({ yaw: 0.37, center: { x: 4, y: 4 } }, 1.28);
    expect(f.counts()).toEqual({ ...flat, draws: flat.draws + 2 });
    renderer.destroy();
    expect(f.live.size).toBe(0);
  });
  it('rebakes water shadows for layer visibility and restores them after solo and plan views', () => {
    const f = fixture();
    const world = {
      ...f.island.world, cells: new Uint8Array(4).fill(1), elevations: new Uint8Array(4),
      ramps: [], rampIds: new Int32Array(4).fill(-1),
    };
    const island = buildIslandLandform(world);
    const environment = createIslandEnvironment(island, { ...DEFAULT_SUN, shadowMode: 'hard' });
    const renderer = createIslandOrbitRenderer(f.canvas, island, environment)!;
    const shadows = () => f.allocations.filter(image => image.image === f.images[2] && image.width === 1024);
    renderer.prepare('oblique', viewport, {}, 0);
    const original = shadows().at(-1)!.pixels!;
    expect(original.some((value, i) => i % 4 === 3 && value < 255)).toBe(true);
    const layers = soloIslandLayer(createDefaultLayersInspection(), 'water');
    renderer.prepare('oblique', viewport, { layers }, 0);
    const waterOnly = shadows().at(-1)!.pixels!;
    expect(waterOnly.every((value, i) => i % 4 !== 3 || value === 255)).toBe(true);
    const uploads = f.counts().uploads, sun = environment.sun;
    renderer.prepare('oblique', viewport, { layers }, 1);
    expect(f.counts().uploads).toBe(uploads);
    expect(environment.sun).toBe(sun);
    renderer.prepare('plan', viewport, {}, 1);
    const beforeReturning = shadows().length;
    renderer.prepare('oblique', viewport, {}, 1);
    expect(shadows()).toHaveLength(beforeReturning + 1);
    expect(shadows().at(-1)!.pixels).toEqual(original);
    renderer.destroy();
    expect(f.live.size).toBe(0);
  });

  it('falls back cleanly when WebGL or the required depth textures are unavailable',() => {
    const f = fixture();
    expect(createIslandOrbitRenderer({ getContext: () => null } as unknown as HTMLCanvasElement,f.island,f.environment)).toBeUndefined();
    f.gl.getExtension = () => null;
    expect(createIslandOrbitRenderer(f.canvas,f.island,f.environment)).toBeUndefined();
    expect(f.live.size).toBe(0);
  });

  it('keeps WebGL and corrected grass depth when optional derivative filtering is unavailable',() => {
    const f = fixture();
    f.gl.getExtension = (name: string) => name === 'OES_standard_derivatives' ? null : {};
    const warning = vi.spyOn(console,'warn').mockImplementation(() => {});
    try {
      const renderer = createIslandOrbitRenderer(f.canvas,f.island,f.environment)!;
      expect(renderer).toBeDefined();
      expect(f.canvas.dataset.detailFiltering).toBe('nearest');
        expect(f.canvas.dataset.shoreInterpolation).toBe('raster');
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('retaining nearest'));
      expect(f.source.some(shader => shader.includes('#define DETAIL_FILTER'))).toBe(false);
      expect(f.source.some(shader => shader.includes('#define SHORE_INTERPOLATION'))).toBe(false);
      renderer.prepare('oblique',viewport,{},0);
      renderer.draw({ yaw: 0.3,center: { x: 4,y: 4 } },0);
      renderer.destroy();
      expect(f.live.size).toBe(0);
    } finally { warning.mockRestore(); }
  });

  it('bounds every face to its own texel centers and disables detail filtering for inspection',() => {
    const f = fixture(), renderer = createIslandOrbitRenderer(f.canvas,f.island,f.environment)!;
    renderer.prepare('oblique',viewport,{},0);
    renderer.draw({ yaw: 0,center: { x: 4,y: 4 } },0);
    expect(f.canvas.dataset.detailFiltering).toBe('bounded-minification');
    expect(f.canvas.dataset.shoreInterpolation).toBe('pixel-center');
    expect(f.source.some(shader => shader.includes('#define SHORE_INTERPOLATION'))).toBe(true);
    expect(f.uniforms.get('u_minification')).toEqual([1]);
    const mesh = f.meshes.find(data => data.length === 2*3*12)!;
    expect(mesh).toBeDefined();
    for (let i = 0; i < mesh.length; i += 12) {
      const [u,v] = mesh.slice(i+3,i+5), [left,top,right,bottom] = mesh.slice(i+8,i+12);
      expect(left).toBeGreaterThan(0);
      expect(top).toBeGreaterThan(0);
      expect(right).toBeLessThan(1);
      expect(bottom).toBeLessThan(1);
      expect(u).toBeGreaterThanOrEqual(left);
      expect(u).toBeLessThanOrEqual(right);
      expect(v).toBeGreaterThanOrEqual(top);
      expect(v).toBeLessThanOrEqual(bottom);
    }
    for (const diagnostics of [{ checker: true },{ regions: true },{ wireframe: true }]) {
      renderer.prepare('oblique',viewport,diagnostics,0);
      renderer.draw({ yaw: 0,center: { x: 4,y: 4 } },0);
      expect(f.uniforms.get('u_minification')).toEqual([0]);
    }
    renderer.prepare('plan',viewport,{},0);
    renderer.draw({ yaw: 0,center: { x: 4,y: 4 } },0);
    expect(f.uniforms.get('u_minification')).toEqual([0]);
    renderer.destroy();
    expect(f.live.size).toBe(0);
  });

  it('bakes world-aligned colors and submerged flags once, then only issues GPU draws',() => {
    const f = fixture(), renderer = createIslandOrbitRenderer(f.canvas,f.island,f.environment)!;
    expect(renderer).toBeDefined();
    expect(() => renderer.draw({ yaw: 0,center: { x: 4,y: 4 } },0)).toThrow('Prepare');
    renderer.prepare('oblique',viewport,{ checker: true },2);
    const initial = f.counts();
    const atlas = f.allocations.find(image => image.width === 2048 && image.pixels !== null)!;
    expect(atlas.height).toBeLessThanOrEqual(2048);
    expect(atlas.pixels!.some((value,index) => index%4 === 3 && value === 128)).toBe(true);
    renderer.prepare('oblique',viewport,{ checker: true },3);
    expect(f.counts()).toEqual(initial);
    for (let frame = 0; frame < 60; frame++) renderer.draw({ yaw: frame*Math.PI/120,center: { x: 4,y: 4 } },2+frame/60);
    expect(f.counts().cpuSamples).toBe(initial.cpuSamples);
    expect(f.counts().uploads).toBe(initial.uploads);
    expect(f.counts().draws-initial.draws).toBe(120);
    expect(f.uniforms.get('u_rotation')![0]).toBeCloseTo(Math.cos(59*Math.PI/120));
    expect(f.uniforms.get('u_rotation')![1]).toBeCloseTo(Math.sin(59*Math.PI/120));
    expect(f.uniforms.get('u_center')).toEqual([4,4]);
    expect(f.uniforms.get('u_origin')).toEqual([40,20]);
    expect(f.uniforms.get('u_waterHeight')).toEqual([-2.5]);
    expect(f.uniforms.get('u_surfaceResponse')).toEqual([1]);
    const waterView = waterViewDirection('oblique',59*Math.PI/120);
    expect(f.uniforms.get('u_waterView')).toEqual([waterView.x,waterView.y,waterView.z]);
    expect(f.uniforms.get('u_surfaceLight')).toEqual([1,0.3,0.3,1]);
    renderer.destroy(); renderer.destroy();
    expect(f.live.size).toBe(0);
    expect(f.listeners.size).toBe(0);
  });

  it('invalidates lighting bakes but not world textures on a viewport-only update',() => {
    const f = fixture(), renderer = createIslandOrbitRenderer(f.canvas,f.island,f.environment)!;
    renderer.prepare('oblique',viewport,{ checker: true },0);
    const atlases = () => f.allocations.filter(image => image.width === 2048 && image.pixels).length;
    expect(atlases()).toBe(1);
    renderer.prepare('oblique',{ ...viewport,width: 81 },{ checker: true },1);
    expect(atlases()).toBe(1);
    Object.assign(f.environment,{ sun: { ...f.environment.sun } });
    renderer.prepare('oblique',{ ...viewport,width: 81 },{ checker: true },1);
    expect(atlases()).toBe(2);
    expect(() => renderer.prepare('oblique',{ ...viewport,width: 2049 },{},0)).toThrow('viewport');
    expect(() => renderer.draw({ yaw: NaN,center: { x: 0,y: 0 } },0)).toThrow('finite');
    renderer.destroy();
    expect(f.live.size).toBe(0);
  });

  it('filters only continuous coast and shadow data, never scene colors, depth or categorical markers',() => {
    const f = fixture(), renderer = createIslandOrbitRenderer(f.canvas,f.island,f.environment)!;
    renderer.prepare('oblique',viewport,{ checker: true },0);
    for (const [index,image] of f.images.entries()) {
      const filter = index === 2 || index === 3 || index === 4 ? f.gl.LINEAR : f.gl.NEAREST;
      expect(f.textureParameters.get(image)?.get(f.gl.TEXTURE_MIN_FILTER)).toBe(filter);
      expect(f.textureParameters.get(image)?.get(f.gl.TEXTURE_MAG_FILTER)).toBe(filter);
    }
    renderer.destroy();
    expect(f.live.size).toBe(0);
  });

  it('anchors coastal data to the world and reuses water bakes across pan, resize and projection changes',() => {
    const f = fixture(), renderer = createIslandOrbitRenderer(f.canvas,f.island,f.environment)!;
    const camera = { yaw: 0,center: { x: 4,y: 4 } };
    renderer.prepare('oblique',viewport,{ checker: true },0);
    renderer.draw(camera,0);
    expect(f.uniforms.get('u_waterMin')).toEqual([-128,-128]);
    expect(f.uniforms.get('u_waterSpan')).toEqual([264]);
    const initial = f.counts(), samples = f.visibilitySamples();
    expect(samples).toBe(1024*1024);
    renderer.prepare('oblique',{ ...viewport,origin: { x: -200,y: 170 } },{ checker: true },0);
    expect(f.counts()).toEqual(initial);
    renderer.prepare('oblique',{ ...viewport,width: 81 },{ checker: true },0);
    expect(f.counts().cpuSamples).toBe(initial.cpuSamples);
    expect(f.counts().uploads).toBe(initial.uploads+2);
    for (const projection of ['current','plan','oblique'] as const) {
      renderer.prepare(projection,viewport,{ checker: true },0);
      renderer.draw(camera,0);
      expect(f.visibilitySamples()).toBe(samples);
      expect(f.uniforms.get('u_waterMin')).toEqual([-128,-128]);
      expect(f.uniforms.get('u_waterSpan')).toEqual([264]);
    }
    Object.assign(f.environment,{ sun: { ...f.environment.sun } });
    renderer.prepare('oblique',viewport,{ checker: true },0);
    expect(f.visibilitySamples()).toBe(samples*2);
    renderer.destroy();
    expect(f.live.size).toBe(0);
  });

  it('prepares water when first leaving an elevation plan',() => {
    const f = fixture(), renderer = createIslandOrbitRenderer(f.canvas,f.island,f.environment)!;
    renderer.prepare('plan',viewport,{ checker: true },0);
    expect(f.visibilitySamples()).toBe(0);
    renderer.prepare('oblique',viewport,{ checker: true },0);
    expect(f.visibilitySamples()).toBe(1024*1024);
    renderer.destroy();
  });

  it.each(['sun','geometry'] as const)('defers invalidated %s water data during plan and rebuilds it on returning to 3D',change => {
    const f = fixture(), renderer = createIslandOrbitRenderer(f.canvas,f.island,f.environment)!;
    renderer.prepare('oblique',viewport,{ checker: true },0);
    const samples = f.visibilitySamples();
    renderer.prepare('plan',viewport,{ checker: true },0);
    if (change === 'sun') Object.assign(f.environment,{ sun: { ...f.environment.sun } });
    else f.island.triangles = [...f.island.triangles];
    renderer.prepare('plan',viewport,{ checker: true },0);
    expect(f.visibilitySamples()).toBe(samples);
    renderer.prepare('oblique',viewport,{ checker: true },0);
    expect(f.visibilitySamples()).toBe(samples*2);
    renderer.destroy();
    expect(f.live.size).toBe(0);
  });

  it('covers long low-sun ocean shadows without reducing the coastal field resolution',() => {
    const f = fixture();
    for (const triangle of f.island.triangles) for (const point of triangle.vertices) point.z = 48;
    const angle = 10*Math.PI/180;
    const direction = { x: Math.cos(angle),y: 0,z: Math.sin(angle) };
    Object.assign(f.environment.sun,{ direction });
    const renderer = createIslandOrbitRenderer(f.canvas,f.island,f.environment)!;
    renderer.prepare('oblique',viewport,{ checker: true },0);
    renderer.draw({ yaw: 0,center: { x: 4,y: 4 } },0);
    const [left,top] = f.uniforms.get('u_shadowMin')!, [span] = f.uniforms.get('u_shadowSpan')!;
    expect(span).toBeGreaterThan(264);
    expect(f.uniforms.get('u_waterMin')).toEqual([-128,-128]);
    expect(f.uniforms.get('u_waterSpan')).toEqual([264]);
    for (const triangle of f.island.triangles) for (const point of triangle.vertices) {
      const x = point.x-direction.x/direction.z*(point.z+2.5);
      expect(x-left).toBeGreaterThanOrEqual(32);
      expect(left+span-x).toBeGreaterThanOrEqual(32);
      expect(point.y-top).toBeGreaterThanOrEqual(32);
      expect(top+span-point.y).toBeGreaterThanOrEqual(32);
    }
    renderer.destroy();
    expect(f.live.size).toBe(0);
  });

  it('keeps adjacent face texels on the same world grid, including submerged shelf colors',() => {
    const f = fixture(), renderer = createIslandOrbitRenderer(f.canvas,f.island,f.environment)!;
    renderer.prepare('oblique',viewport,{},0);
    const atlas = f.allocations.find(image => image.width === 2048 && image.pixels !== null)!;
    const top = (2048+1)*4, shelf = (2048+7)*4;
    expect(Array.from(atlas.pixels!.slice(top,top+4))).toEqual([5,5,40,255]);
    expect(Array.from(atlas.pixels!.slice(shelf,shelf+4))).toEqual([5,5,40,128]);
    renderer.destroy();
    expect(f.live.size).toBe(0);
  });

  it.each(['current','oblique','plan'] as const)('sets the exact %s projection without changing framing',projection => {
    const f = fixture(), renderer = createIslandOrbitRenderer(f.canvas,f.island,f.environment)!;
    renderer.prepare(projection,viewport,{ regions: true },0);
    renderer.draw({ yaw: Math.PI/2,center: { x: 4,y: 4 } },0);
    expect(f.uniforms.get('u_projection')).toEqual([{ current: 0,oblique: 1,plan: 2 }[projection]]);
    expect(f.canvas.width).toBe(80);
    expect(f.canvas.height).toBe(60);
    expect(f.source.some(shader => shader.includes('p.x*u_rotation.x-p.y*u_rotation.y'))).toBe(true);
    renderer.destroy();
  });

  it('marks a lost context for CPU fallback and never draws into it again',() => {
    const f = fixture(), renderer = createIslandOrbitRenderer(f.canvas,f.island,f.environment)!;
    renderer.prepare('plan',viewport,{},0);
    let prevented = false;
    f.listeners.get('webglcontextlost')!({ preventDefault: () => { prevented = true; } } as unknown as Event);
    renderer.draw({ yaw: 0,center: { x: 0,y: 0 } },0);
    expect(prevented).toBe(true);
    expect(f.canvas.dataset.orbitRenderer).toBe('lost');
    expect(f.counts().draws).toBe(0);
    expect(() => renderer.prepare('plan',viewport,{},0)).toThrow('fallback');
    renderer.destroy();
    expect(f.live.size).toBe(0);
  });

  it('prepares the production terrain and beach shelf without grass within the bounded texture budget',() => {
    const f = fixture();
    const island = generateIslandLandform(12), environment = createIslandEnvironment(island);
    const renderer = createIslandOrbitRenderer(f.canvas,island,environment)!;
    const start = performance.now();
    renderer.prepare('oblique',{ width: 820,height: 600,origin: { x: 350,y: 120 } },{},0);
    const prepareMs = performance.now()-start;
    const uploaded = f.counts().uploads;
    const drawStart = performance.now();
    for (let frame = 0; frame < 60; frame++) {
      renderer.draw({ yaw: frame*Math.PI/120,center: {
        x: island.world.width*island.world.tileSize/2,y: island.world.height*island.world.tileSize/2,
      } },frame/60);
    }
    const drawMs = (performance.now()-drawStart)/60;
    expect(f.counts().uploads).toBe(uploaded);
    expect(f.counts().draws).toBeGreaterThanOrEqual(120);
    expect(f.canvas.dataset.grassCount).toBe('0');
    expect(Number(f.canvas.dataset.orbitTriangles)).toBe(island.triangles.length+island.beach.underwaterTriangles.length);
    expect(f.allocations.every(image => image.width <= 2048 && image.height <= 2048)).toBe(true);
    console.info(`Island GPU CPU-side benchmark (mock GL, not GPU timing): prepare ${prepareMs.toFixed(1)} ms; draw ${drawMs.toFixed(3)} ms; ${f.canvas.dataset.orbitTriangles} triangles; atlas resolution ${f.canvas.dataset.orbitAtlasResolution}.`);
    renderer.destroy();
    expect(f.live.size).toBe(0);
  });
});
