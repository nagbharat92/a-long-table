import type { World } from '../../../src/world-family/core/contracts';
import { buildIslandLandform } from '../../../src/world-family/core/island-landform';
import type { LandProjection } from '../../../src/world-family/core/landform-study';
import { createIslandEnvironment } from '../../../src/world-family/render/island-environment';
import { createIslandOrbitRenderer } from '../../../src/world-family/render/island-orbit-renderer';

type Mode = 'grass' | 'occluded' | 'texture' | 'bounds';

function fixture(mode: Mode, projection: LandProjection) {
  const world: World = {
    seed: 153025,generatorVersion: 'detail-fixture',provenance: 'test-fixture',
    width: 16,height: 16,tileSize: 8,seaLevel: 0,
    cells: new Uint8Array(256).fill(1),heights: new Float32Array(256).fill(1),
    elevations: new Uint8Array(256),rampIds: new Int32Array(256).fill(-1),ramps: [],
  };
  const island = buildIslandLandform(world);
  if (mode === 'occluded') {
    island.triangles.push(
      { vertices: [{ x: -32,y: -32,z: 8 },{ x: 160,y: -32,z: 8 },{ x: 160,y: 160,z: 8 }],plane: 'top',level: 1 },
      { vertices: [{ x: -32,y: -32,z: 8 },{ x: 160,y: 160,z: 8 },{ x: -32,y: 160,z: 8 }],plane: 'top',level: 1 },
    );
  }
  const base = createIslandEnvironment(island);
  const environment = {
    ...base,
    surface: {
      ...base.surface,
      material: () => mode === 'grass' || mode === 'occluded' ? 'turf' as const : 'moss' as const,
      ground: (x: number,y: number) => ({ ...base.surface.ground(x,y),meadow: 1,moss: 0 }),
      shade: (triangle: typeof island.triangles[number],point: { x: number; y: number }): readonly [number,number,number] => {
        if (mode === 'grass' || mode === 'occluded') {
          return Math.abs(triangle.vertices[1].x-triangle.vertices[0].x) === 1 ? [255,0,255] : [0,0,0];
        }
        if (mode === 'bounds') return triangle === island.triangles[0] ? [255,0,0] : [0,0,255];
        return (Math.floor(point.x)+Math.floor(point.y))%2 === 0 ? [100,160,80] : [124,184,104];
      },
    },
  };
  const canvas = document.createElement('canvas');
  const renderer = createIslandOrbitRenderer(canvas,island,environment);
  if (!renderer) throw new Error('Detail fixture requires WebGL depth textures.');
  const origin = projection === 'oblique' ? { x: 160,y: 80 } : { x: 80,y: 80 };
  renderer.prepare(projection,{ width: 320,height: 320,origin },{},0);
  const gl = canvas.getContext('webgl')!;
  const pixels = new Uint8Array(320*320*4);
  return {
    canvas,renderer,origin,pixels,
    draw(yaw: number) {
      renderer.draw({ yaw,center: { x: 64,y: 64 } },0);
      gl.readPixels(0,0,320,320,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    },
  };
}

function grass(projection: 'oblique' | 'current',occluded = false) {
  const f = fixture(occluded ? 'occluded' : 'grass',projection), counts: number[] = [];
  try {
    for (let frame = 0; frame <= 32; frame++) {
      f.draw(frame*Math.PI/64);
      let count = 0;
      for (let i = 0; i < f.pixels.length; i += 4) {
        if (f.pixels[i] > 150 && f.pixels[i+1] < 10 && f.pixels[i+2] > 150) count++;
      }
      counts.push(count);
    }
    return { counts,tufts: Number(f.canvas.dataset.grassCount) };
  } finally { f.renderer.destroy(); }
}

function texture(projection: 'oblique' | 'current') {
  const f = fixture('texture',projection);
  try {
    return (projection === 'oblique' ? [0,Math.PI/8,Math.PI/4,3*Math.PI/8,Math.PI/2] : [0]).map(yaw => {
      f.draw(yaw);
      const cosine = Math.cos(yaw), sine = Math.sin(yaw);
      const worldAt = (x: number,y: number) => {
        let px = x-f.origin.x, py = y-f.origin.y;
        if (projection === 'oblique') {
          const sum = py/0.425, difference = px/0.85;
          px = (sum+difference)*0.5; py = (sum-difference)*0.5;
        }
        px -= 64; py -= 64;
        return { x: px*cosine+py*sine+64,y: -px*sine+py*cosine+64 };
      };
      let error = 0, samples = 0;
      for (let y = 2; y < 318; y += 2) for (let x = 2; x < 318; x += 2) {
        const point = worldAt(x+0.5,y+0.5);
        if (point.x < 16 || point.y < 16 || point.x > 112 || point.y > 112) continue;
        let expected = 0;
        for (let sy = 0; sy < 8; sy++) for (let sx = 0; sx < 8; sx++) {
          const p = worldAt(x+(sx+0.5)/8,y+(sy+0.5)/8);
          expected += (Math.floor(p.x)+Math.floor(p.y))%2 === 0 ? 100 : 124;
        }
        error += Math.abs(f.pixels[((319-y)*320+x)*4]-expected/64);
        samples++;
      }
      return { yaw,samples,error: error/samples,filter: f.canvas.dataset.detailFiltering };
    });
  } finally { f.renderer.destroy(); }
}

function bounds() {
  const f = fixture('bounds','oblique');
  let mixed = 0, red = 0, blue = 0;
  try {
    for (const yaw of [0,Math.PI/4,Math.PI/2]) {
      f.draw(yaw);
      for (let i = 0; i < f.pixels.length; i += 4) {
        const r = f.pixels[i], g = f.pixels[i+1], b = f.pixels[i+2];
        if (g === 0 && r+b === 255) {
          if (r !== 0 && b !== 0) mixed++;
          else if (r === 255) red++;
          else blue++;
        }
      }
    }
    return { mixed,red,blue };
  } finally { f.renderer.destroy(); }
}

declare global {
  interface Window {
    islandDetailFixture: { grass: typeof grass; texture: typeof texture; bounds: typeof bounds };
  }
}
window.islandDetailFixture = { grass,texture,bounds };
