import type { IslandLandform } from '../core/island-landform';
import { activeIslandLandTriangles, activeIslandSeabedTriangles, classifyTriangleLayer } from '../core/island-layers';
import { ISLAND_WATER_HEIGHT } from '../core/island-water-level';
import type { LandCamera, LandProjection, LandTriangle, LandVertex } from '../core/landform-study';
import {
  createDefaultLayersInspection,
  createProjectionChecker,
  hasActiveMeshInspection,
  isDefaultLayersInspection,
  layersSignature,
  type LandDiagnostics,
} from './landform-diagnostics';
import type { createIslandEnvironment, IslandViewport } from './island-environment';
import { islandLevelPalette } from './island-level-palette';
import { WATER_PALETTE_GLSL, WATER_COLOR_REACH, WATER_DISTANCE_SPAN, WATER_MAX_DEPTH } from './island-water-color';
import { WATER_NOISE_GLSL } from './island-water-noise';
import { WATER_PROJECTION_GLSL } from './island-water-projection';
import { WATER_OPTICS_GLSL } from './island-water-optics';
import { WATER_SURFACE_GLSL, waterViewDirection } from './island-water-surface';
import { WATER_REFRACTION_GLSL } from './island-water-refraction';
import { BEACH_WASH_GLSL, BEACH_WASH_MAX_HEIGHT, BEACH_WAVE_OFFSHORE } from './island-beach-wash';
import { SHORE_MESH_STRIDE } from './island-shore-mesh';
import { ROCK_CONTACT_GLSL } from './island-shore-water';
import { WATER_FOAM_COLOR } from './island-water-foam';

export interface IslandOrbitRenderer {
  /** Reuses world-space bakes until geometry, sunlight, or diagnostics change. */
  prepare(projection: LandProjection, viewport: IslandViewport, diagnostics: LandDiagnostics, seconds: number): void;
  /** Only uniforms and GPU draws; never samples the CPU surface, sun, or shore. */
  draw(camera: LandCamera, seconds: number): void;
  destroy(): void;
}

type Environment = ReturnType<typeof createIslandEnvironment>;
type GL = WebGLRenderingContext;
interface Program {
  value: WebGLProgram;
  attributes: Record<string, number>;
  uniforms: Record<string, WebGLUniformLocation>;
}
interface Batch { buffer: WebGLBuffer; texture: WebGLTexture; count: number; width: number; height: number }
interface Face {
  triangle: LandTriangle;
  a: LandVertex;
  u: LandVertex;
  v: LandVertex;
  width: number;
  height: number;
  coordinates: readonly (readonly [number, number])[];
  x: number;
  y: number;
}

// Terrain minification is face-bounded in the shader; depth and markers stay nearest.
const ATLAS_SIZE = 2048;
const MAX_ATLASES = 4;
const WATER_SIZE = 1024;
const COAST_PADDING = 128;
const SHADOW_PADDING = 32;
const VERTEX_STRIDE = 12;
const projectionGLSL = `
uniform vec2 u_size;
uniform vec2 u_origin;
uniform vec2 u_center;
uniform vec2 u_rotation;
uniform float u_projection;
uniform float u_range;
vec4 projectIslandVertex(vec3 position) {
  vec2 p = position.xy - u_center;
  p = vec2(p.x*u_rotation.x-p.y*u_rotation.y,
           p.x*u_rotation.y+p.y*u_rotation.x) + u_center;
  vec2 screen = p;
  float height = position.z;
  float depth = height;
  if (u_projection < 0.5) {
    screen.y -= height;
    depth = p.y + height;
  } else if (u_projection < 1.5) {
    screen = vec2((p.x-p.y)*0.85, (p.x+p.y)*0.425-height);
    depth = (p.x+p.y)*0.85+height*0.7225;
  }
  screen += u_origin;
  return vec4(screen.x*2.0/u_size.x-1.0,
    1.0-screen.y*2.0/u_size.y, -depth/u_range, 1.0);
}`;
const vertexShader = `
precision highp float;
attribute vec3 a_position;
attribute vec2 a_uv;
attribute vec3 a_barycentric;
attribute vec4 a_bounds;
varying vec2 v_uv;
varying vec3 v_barycentric;
varying vec4 v_bounds;
${projectionGLSL}
void main() {
  gl_Position = projectIslandVertex(a_position);
  v_uv = a_uv;
  v_barycentric = a_barycentric;
  v_bounds = a_bounds;
}`;
const surfaceShader = `
precision highp float;
uniform sampler2D u_texture;
uniform float u_wireframe;
varying vec2 v_uv;
varying vec3 v_barycentric;
#ifdef DETAIL_FILTER
uniform vec2 u_texel;
uniform float u_minification;
varying vec4 v_bounds;
vec3 faceSample(vec2 uv) { return texture2D(u_texture,clamp(uv,v_bounds.xy,v_bounds.zw)).rgb; }
#endif
void main() {
  vec4 surface = texture2D(u_texture, v_uv);
  vec3 color = surface.rgb;
#ifdef DETAIL_FILTER
  vec2 dx = dFdx(v_uv), dy = dFdy(v_uv);
  vec2 x = dx/u_texel, y = dy/u_texel;
  float trace = dot(x,x)+dot(y,y), determinant = x.x*y.y-x.y*y.x;
  // The largest singular value avoids yaw-dependent filtering strength on level ground.
  float footprint = sqrt(0.5*(trace+sqrt(max(0.0,trace*trace-4.0*determinant*determinant))));
  if (u_minification > 0.5 && footprint > 1.0) {
    vec2 a = dx*0.25, b = dy*0.25;
    vec3 filtered = (faceSample(v_uv-a-b)+faceSample(v_uv+a-b)
      +faceSample(v_uv-a+b)+faceSample(v_uv+a+b))*0.25;
    color = mix(color,filtered,clamp(footprint-1.0,0.0,1.0));
  }
#endif
  if (u_wireframe > 0.5 && min(min(v_barycentric.x,v_barycentric.y),v_barycentric.z) < 0.025)
    color = vec3(25.0,38.0,42.0)/255.0;
  gl_FragColor = vec4(color, surface.a);
}`;
const screenVertexShader = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position*0.5+0.5;
  gl_Position = vec4(a_position,0.0,1.0);
}`;
const shoreVertexShader = `
precision highp float;
attribute vec2 a_position;
attribute vec4 a_shore;
attribute vec2 a_gradient;
attribute vec2 a_beachGradient;
uniform float u_seconds;
varying vec3 v_position;
varying vec4 v_shore;
varying vec2 v_gradient;
varying vec2 v_beachGradient;
${projectionGLSL}
${BEACH_WASH_GLSL}
void main() {
  float cycle=beachCycle(a_shore.z,u_seconds);
  float height=beachWave(a_shore.x,cycle,a_shore.y).y;
  v_position=vec3(a_position,height);
  v_shore=a_shore;
  v_gradient=a_gradient;
  v_beachGradient=a_beachGradient;
  gl_Position=projectIslandVertex(v_position);
}`;
const waterShader = `
precision highp float;
uniform sampler2D u_scene;
uniform sampler2D u_depth;
uniform sampler2D u_ocean;
uniform sampler2D u_coast;
uniform sampler2D u_detail;
uniform sampler2D u_light;
uniform sampler2D u_patches;
uniform sampler2D u_waves;
uniform vec2 u_size;
uniform vec2 u_origin;
uniform vec2 u_center;
uniform vec2 u_rotation;
uniform vec2 u_waterMin;
uniform float u_waterSpan;
uniform vec2 u_shadowMin;
uniform float u_shadowSpan;
uniform float u_projection;
uniform float u_range;
uniform float u_seconds;
uniform float u_inspect;
uniform float u_waterHeight;
uniform vec2 u_waterLayerA;
uniform vec2 u_waterLayerB;
uniform vec2 u_waterLayerC;
uniform vec2 u_waterLayerD;
uniform float u_surfaceResponse;
uniform vec3 u_waterView;
uniform vec3 u_sunDirection;
uniform vec4 u_surfaceLight;
#ifdef SHORE_MESH
varying vec3 v_position;
varying vec4 v_shore;
varying vec2 v_gradient;
varying vec2 v_beachGradient;
#else
varying vec2 v_uv;
#endif
float wave(vec2 p) {
  return texture2D(u_waves,(mod(p,512.0)+0.5)/512.0).r*255.0-128.0;
}
${WATER_PALETTE_GLSL}
${WATER_NOISE_GLSL}
${WATER_PROJECTION_GLSL}
${WATER_OPTICS_GLSL}
${WATER_SURFACE_GLSL}
${WATER_REFRACTION_GLSL}
${BEACH_WASH_GLSL}
${ROCK_CONTACT_GLSL}
float groundHeight(vec2 uv) {
  float depth=(0.5-texture2D(u_depth,uv).r)*2.0*u_range;
  float screenY=(1.0-uv.y)*u_size.y-u_origin.y;
  return u_projection < 0.5 ? (depth-screenY)/2.0 : (depth-screenY*2.0)/2.7225;
}
vec3 refractedTap(vec2 pixel, vec4 land, float ground, float surfaceHeight) {
  vec2 uv=(pixel+0.5)/u_size;
  if (any(lessThan(uv,vec2(0.0))) || any(greaterThan(uv,vec2(1.0)))) return land.rgb;
  vec4 candidate=texture2D(u_scene,uv);
  float z=groundHeight(uv);
  if (candidate.a <= 0.0 || (candidate.a < 0.65) != (land.a < 0.65)
    || z >= surfaceHeight-0.01 || abs(z-ground) > 1.25) return land.rgb;
  return candidate.rgb;
}
vec3 filteredBedPixel(vec2 pixel, vec4 land, float ground, float surfaceHeight) {
  vec2 base=floor(pixel), blend=fract(pixel);
  return mix(mix(refractedTap(base,land,ground,surfaceHeight),
    refractedTap(base+vec2(1.0,0.0),land,ground,surfaceHeight),blend.x),
    mix(refractedTap(base+vec2(0.0,1.0),land,ground,surfaceHeight),
    refractedTap(base+1.0,land,ground,surfaceHeight),blend.x),blend.y);
}
vec3 refractedBed(vec2 uv, vec4 land, float ground, float surfaceHeight, float distance, vec3 normal) {
  if (ground >= surfaceHeight-0.01) return land.rgb;
  vec2 offset=u_surfaceResponse > 0.5 ? waterRefractionOffset(surfaceHeight-ground,distance,normal,u_waterView) : vec2(0.0);
  offset=vec2(offset.x*u_rotation.x-offset.y*u_rotation.y,offset.x*u_rotation.y+offset.y*u_rotation.x);
  if (u_projection > 0.5) offset=vec2((offset.x-offset.y)*0.85,(offset.x+offset.y)*0.425);
  vec2 pixel=uv*u_size-0.5+vec2(offset.x,-offset.y);
  vec3 center=filteredBedPixel(pixel,land,ground,surfaceHeight);
  float radius=waterBedBlurRadius(land.a < 0.65
    ? waterBedOpticalDepth(surfaceHeight,ground,u_waterView.z) : surfaceHeight-ground);
  if (radius <= 0.0) return center;
  return center*0.4+0.15*(filteredBedPixel(pixel-vec2(radius,0.0),land,ground,surfaceHeight)
    +filteredBedPixel(pixel+vec2(radius,0.0),land,ground,surfaceHeight)
    +filteredBedPixel(pixel-vec2(0.0,radius),land,ground,surfaceHeight)
    +filteredBedPixel(pixel+vec2(0.0,radius),land,ground,surfaceHeight));
}
vec3 litWaterColor(vec3 color, float visibility) {
  return u_waterLayerD.y > 0.5 ? vec3(
    texture2D(u_light,vec2((color.r+0.5)/256.0,(visibility+0.5)/256.0)).r,
    texture2D(u_light,vec2((color.g+0.5)/256.0,(visibility+0.5)/256.0)).g,
    texture2D(u_light,vec2((color.b+0.5)/256.0,(visibility+0.5)/256.0)).b) : color/255.0;
}
#ifdef SHORE_INTERPOLATION
vec2 shoreScreenVector(vec3 point) {
  vec2 p=vec2(point.x*u_rotation.x-point.y*u_rotation.y,point.x*u_rotation.y+point.y*u_rotation.x);
  vec2 screen=u_projection < 0.5 ? vec2(p.x,p.y-point.z)
    : vec2((p.x-p.y)*0.85,(p.x+p.y)*0.425-point.z);
  return vec2(screen.x,-screen.y);
}
#endif
void main() {
#ifdef SHORE_MESH
  vec2 v_uv=gl_FragCoord.xy/u_size;
  vec3 shorePosition=v_position;
  vec4 shoreFields=v_shore;
  vec2 shoreGradient=v_gradient;
  vec2 shoreBeachGradient=v_beachGradient;
#ifdef SHORE_INTERPOLATION
  // Undo vertex subpixel snapping for high-contrast foam attributes, not geometry.
  vec3 positionX=dFdx(v_position), positionY=dFdy(v_position);
  vec2 screenX=shoreScreenVector(positionX), screenY=shoreScreenVector(positionY);
  vec2 center=u_projection < 0.5 ? u_center
    : vec2((u_center.x-u_center.y)*0.85,(u_center.x+u_center.y)*0.425);
  vec2 projected=shoreScreenVector(vec3(v_position.xy-u_center,v_position.z))
    +vec2(center.x+u_origin.x,u_size.y-center.y-u_origin.y);
  vec2 error=gl_FragCoord.xy-projected;
  float determinant=screenX.x*screenY.y-screenY.x*screenX.y;
  vec2 correction=abs(determinant) > 0.000001
    ? vec2(error.x*screenY.y-error.y*screenY.x,screenX.x*error.y-screenX.y*error.x)/determinant : vec2(0.0);
  shorePosition+=positionX*correction.x+positionY*correction.y;
  shoreFields+=dFdx(v_shore)*correction.x+dFdy(v_shore)*correction.y;
  shoreGradient+=dFdx(v_gradient)*correction.x+dFdy(v_gradient)*correction.y;
  shoreBeachGradient+=dFdx(v_beachGradient)*correction.x+dFdy(v_beachGradient)*correction.y;
#endif
#endif
  vec4 land = texture2D(u_scene,v_uv);
  if (u_waterLayerA.x < 0.5) {
    gl_FragColor = vec4(land.a > 0.0 ? land.rgb : vec3(82.0,105.0,106.0)/255.0, 1.0);
    return;
  }
  float depth = (0.5-texture2D(u_depth,v_uv).r)*2.0*u_range;
  vec2 screen = vec2(v_uv.x*u_size.x,(1.0-v_uv.y)*u_size.y)-u_origin;
  float z = u_projection < 0.5 ? (depth-screen.y)/2.0 : (depth-screen.y*2.0)/2.7225;
  bool dryWash=land.a > 0.65 && land.a < 0.9 && z >= u_waterHeight-0.01
    && z <= ${BEACH_WASH_MAX_HEIGHT.toFixed(2)}+0.00001;
#ifdef SHORE_MESH
  float surfaceDepth=(0.5-gl_FragCoord.z)*2.0*u_range;
  if ((land.a > 0.0 && surfaceDepth < depth-0.0001)
    || (land.a > 0.65 && z >= u_waterHeight-0.01 && !dryWash)
    || v_position.z <= u_waterHeight+0.01) discard;
  float surfaceHeight=shorePosition.z;
  vec2 p=shorePosition.xy;
#else
  if (u_projection > 1.5 || (land.a > 0.0 && (u_inspect > 0.5
    || (land.a > 0.65 && z >= u_waterHeight-0.01 && (!dryWash || u_waterLayerD.x < 0.5))))) {
    gl_FragColor = vec4(land.rgb,1.0);
    return;
  }
  float surfaceHeight=dryWash ? z : u_waterHeight;
  vec2 p;
  if (u_projection < 0.5) p=vec2(screen.x,screen.y+surfaceHeight);
  else {
    float sum=(screen.y+surfaceHeight)/0.425;
    float difference=screen.x/0.85;
    p=vec2((sum+difference)*0.5,(sum-difference)*0.5);
  }
  p-=u_center;
  p=vec2(p.x*u_rotation.x+p.y*u_rotation.y,-p.x*u_rotation.y+p.y*u_rotation.x)+u_center;
#endif
  vec2 uv=(p-u_waterMin)/u_waterSpan;
  vec2 shadowUv=(p-u_shadowMin)/u_shadowSpan;
  vec4 coast=texture2D(u_coast,uv);
  vec4 detail=texture2D(u_detail,uv);
  float distance=(coast.r*65280.0+detail.b*255.0)/65535.0*${WATER_DISTANCE_SPAN.toFixed(1)}-8.0;
  float beach=coast.g;
  float shallow=coast.b*32.0;
  float phase=(detail.r*65280.0+detail.a*255.0)/65535.0;
  float breakup=detail.g*2.0-1.0;
#ifdef SHORE_MESH
  if (beach <= 0.6) discard;
  distance=shoreFields.x;
  beach=shoreFields.y;
  phase=shoreFields.z;
  breakup=shoreFields.w;
  if (beach <= 0.6 || distance <= -8.0 || distance >= ${BEACH_WAVE_OFFSHORE.toFixed(1)}) discard;
#endif
  // CPU-matched snapped crest drift.
  vec2 snapped=floor(p+0.00001);
  vec2 drift=mod(u_seconds,2560.0)*vec2(0.2,0.4);
  vec2 base=snapped-floor(drift), f=fract(drift);
  float crest=mix(mix(wave(base),wave(base-vec2(1.0,0.0)),f.x),
    mix(wave(base-vec2(0.0,1.0)),wave(base-vec2(1.0,1.0)),f.x),f.y);
  float signedNoise=u_waterLayerB.x > 0.5 ? sampleWaterNoise(p,u_seconds) : 0.0;
  vec3 baseColor=waterPaletteColor(${WATER_MAX_DEPTH.toFixed(1)},signedNoise);
  vec3 surfaceColor=u_waterLayerC.x > 0.5 ? floor(baseColor+crest*vec3(1.0,1.12,1.0)+0.5)-baseColor : vec3(0.0);
  vec2 colorUv=(floor(p)+0.5-u_waterMin)/u_waterSpan;
  float bedDepth=all(greaterThanEqual(colorUv,vec2(0.0))) && all(lessThanEqual(colorUv,vec2(1.0)))
    ? texture2D(u_coast,colorUv).a*${WATER_MAX_DEPTH.toFixed(1)} : ${WATER_MAX_DEPTH.toFixed(1)};
  vec3 bodyColor=projectedWaterColor(u_waterLayerA.y > 0.5 ? bedDepth : ${WATER_MAX_DEPTH.toFixed(1)},
    p,u_seconds,u_waterLayerB.x);
  vec3 color=bodyColor+surfaceColor;
  vec4 wash=u_waterLayerD.x > 0.5 ? beachWash(distance,beach,phase,breakup,u_seconds,
    dryWash ? z : u_waterHeight) : vec4(0.0,0.0,0.0,u_waterHeight);
  float foam=wash.y;
#ifndef SHORE_MESH
  foam=u_waterLayerD.x > 0.5 ? rockContactFoam(distance,beach,breakup,u_seconds) : 0.0;
#endif
  if (distance > 0.0 && distance < shallow) {
    float d=clamp(distance/shallow+breakup*0.035,0.0,1.0);
    float contact=(1.0-smoothstep(0.15,1.4,distance))*(1.0-beach)*0.3;
    float ripple=u_waterLayerC.y > 0.5 ? sin(distance*0.85+u_seconds*0.65+phase*4.0)*(1.0-d)*beach*1.3 : 0.0;
    color+=ripple;
    color=mix(color,vec3(30.0,82.0,96.0),contact);
  }
  color=floor(clamp(color,0.0,255.0)+0.5);
  // CPU sunlight transfer table.
  float visibility=all(greaterThanEqual(shadowUv,vec2(0.0))) && all(lessThanEqual(shadowUv,vec2(1.0)))
    ? floor(texture2D(u_ocean,shadowUv).a*255.0+0.5) : 255.0;
  vec3 lit=litWaterColor(color,visibility);
  float transmission=0.0;
  if (land.a > 0.0) {
    bool bed=land.a < 0.65;
    if (!bed || (u_waterLayerB.y > 0.5 && land.a > 0.35)) {
      transmission=waterBedTransmission(bed
        ? waterBedOpticalDepth(surfaceHeight,z,u_waterView.z) : max(0.0,surfaceHeight-z),bed);
      if (bed) {
        vec2 bottomPoint=p-u_waterView.xy/u_waterView.z*max(0.0,surfaceHeight-z);
        transmission*=texture2D(u_ocean,(bottomPoint-u_shadowMin)/u_shadowSpan).r;
      }
    }
  }
#ifdef SHORE_MESH
  float cycle=beachCycle(phase,u_seconds);
  vec2 heightGradient=beachWaveGradient(distance,cycle,beach,shoreGradient,shoreBeachGradient);
  vec3 normal=coastalWaterNormalFromGradient(p,u_seconds,distance,beach,1.0,heightGradient,u_waveEndSoftness);
#else
  vec3 normal=coastalWaterNormalFromGradient(p,u_seconds,distance,beach,u_waterLayerD.x,vec2(0.0),u_waveEndSoftness);
#endif
  vec3 bottom=land.rgb;
  if (transmission > 0.0 && !dryWash)
    bottom=refractedBed(v_uv,land,z,surfaceHeight,distance,
      waterRefractionNormal(normal,p,u_seconds,distance,beach,u_waterLayerD.x,u_waveEndSoftness));
  if (land.a > 0.0 && land.a < 0.65) bottom=waterTintedBed(bottom*255.0,lit*255.0)/255.0;
  vec3 composite=mix(lit,bottom,clamp(transmission,0.0,1.0));
#ifdef SHORE_MESH
  if (u_surfaceResponse > 0.5 && u_waterLayerD.y > 0.5)
    composite=waterSurfaceResponseNormal(composite*255.0,p,u_seconds,u_waterView,u_sunDirection,
      u_surfaceLight,transmission,visibility/255.0,normal)/255.0;
  if (foam > 0.0)
    composite=mix(composite,litWaterColor(vec3(${WATER_FOAM_COLOR.map(value => value.toFixed(1)).join(',')}),visibility),foam);
  // A displaced water surface replaces flat water; wash coverage is only for dry sand.
  float opacity=(dryWash ? max(wash.x,foam) : 1.0)*smoothstep(0.01,0.12,surfaceHeight-u_waterHeight);
  if (opacity <= 0.0) discard;
  gl_FragColor=vec4(composite,opacity);
#else
  if (u_surfaceResponse > 0.5 && u_waterLayerD.y > 0.5)
    composite=waterSurfaceResponseNormal(composite*255.0,p,u_seconds,u_waterView,u_sunDirection,
      u_surfaceLight,transmission,visibility/255.0,normal)/255.0;
  if (dryWash) composite=land.rgb*(1.0-wash.z*0.18);
  else if (foam > 0.0)
    composite=mix(composite,litWaterColor(vec3(${WATER_FOAM_COLOR.map(value => value.toFixed(1)).join(',')}),visibility),foam);
  gl_FragColor=vec4(composite,1.0);
#endif
}`;

function program(gl: GL, vertex: string, fragment: string, attributes: string[], uniforms: string[]): Program {
  const shaders: WebGLShader[] = [];
  let value: WebGLProgram | null = null;
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('Could not allocate an island shader.');
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Island shader compilation failed.');
    }
    value = gl.createProgram();
    if (!value) throw new Error('Could not allocate an island program.');
    shaders.forEach(shader => gl.attachShader(value!, shader));
    gl.linkProgram(value);
    if (!gl.getProgramParameter(value, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(value) ?? 'Island shader linking failed.');
    return {
      value,
      attributes: Object.fromEntries(attributes.map(name => [name, gl.getAttribLocation(value!, name)])),
      uniforms: Object.fromEntries(uniforms.map(name => {
        const location = gl.getUniformLocation(value!, name);
        if (location === null) throw new Error(`Missing island shader uniform ${name}.`);
        return [name, location];
      })),
    };
  } catch (error) {
    if (value) gl.deleteProgram(value);
    throw error;
  } finally {
    shaders.forEach(shader => gl.deleteShader(shader));
  }
}

function faceFor(triangle: LandTriangle, resolution: number): Face | undefined {
  const [a, b, c] = triangle.vertices;
  const ab = { x: b.x-a.x, y: b.y-a.y, z: b.z-a.z };
  const ac = { x: c.x-a.x, y: c.y-a.y, z: c.z-a.z };
  const normal = { x: ab.y*ac.z-ab.z*ac.y,y: ab.z*ac.x-ab.x*ac.z,z: ab.x*ac.y-ab.y*ac.x };
  if (Math.hypot(normal.x,normal.y,normal.z) < 1e-8) return undefined;
  const axes = ['x','y','z'] as const;
  const missing = axes.reduce((largest,axis) => Math.abs(normal[axis]) > Math.abs(normal[largest]) ? axis : largest);
  const [horizontal,vertical] = axes.filter(axis => axis !== missing);
  const minU = Math.floor(Math.min(a[horizontal],b[horizontal],c[horizontal])/resolution)*resolution;
  const minV = Math.floor(Math.min(a[vertical],b[vertical],c[vertical])/resolution)*resolution;
  const maxU = Math.max(a[horizontal],b[horizontal],c[horizontal]);
  const maxV = Math.max(a[vertical],b[vertical],c[vertical]);
  const u = { x: 0,y: 0,z: 0 }, v = { x: 0,y: 0,z: 0 };
  u[horizontal] = 1; u[missing] = -normal[horizontal]/normal[missing];
  v[vertical] = 1; v[missing] = -normal[vertical]/normal[missing];
  const start = {
    x: a.x+u.x*(minU-a[horizontal])+v.x*(minV-a[vertical]),
    y: a.y+u.y*(minU-a[horizontal])+v.y*(minV-a[vertical]),
    z: a.z+u.z*(minU-a[horizontal])+v.z*(minV-a[vertical]),
  };
  return {
    triangle,a: start,u,v,width: Math.ceil((maxU-minU)/resolution)+2,height: Math.ceil((maxV-minV)/resolution)+2,
    coordinates: triangle.vertices.map(point => [point[horizontal]-minU,point[vertical]-minV] as const),x: 0,y: 0,
  };
}

/** A dedicated canvas is required: WebGL and the CPU renderer cannot share a context. */
export function createIslandOrbitRenderer(canvas: HTMLCanvasElement, island: IslandLandform, environment: Environment): IslandOrbitRenderer | undefined {
  let gl: GL | null;
  try {
    gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
  } catch { return undefined; }
  if (!gl || !gl.getExtension('WEBGL_depth_texture')
    || gl.getParameter(gl.MAX_TEXTURE_SIZE) < ATLAS_SIZE
    || gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) < 8
    || !gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision) return undefined;
  const context = gl;
  const derivatives = Boolean(context.getExtension('OES_standard_derivatives'));
  canvas.dataset.detailFiltering = derivatives ? 'bounded-minification' : 'nearest';
  canvas.dataset.shoreInterpolation = derivatives ? 'pixel-center' : 'raster';
  if (!derivatives) console.warn('Island derivative filtering is unavailable; retaining nearest detail and raster shoreline interpolation.');
  const textures = new Set<WebGLTexture>(), buffers = new Set<WebGLBuffer>();
  const programs: Program[] = [];
  let framebuffer: WebGLFramebuffer | null = null;
  let destroyed = false, lost = false;
  const texture = (linear = false): WebGLTexture => {
    const result = context.createTexture();
    if (!result) throw new Error('Could not allocate an island texture.');
    textures.add(result);
    context.bindTexture(context.TEXTURE_2D, result);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, linear ? context.LINEAR : context.NEAREST);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, linear ? context.LINEAR : context.NEAREST);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
    return result;
  };
  const upload = (target: WebGLTexture, width: number, height: number, pixels: Uint8Array | Uint8ClampedArray | null): void => {
    context.bindTexture(context.TEXTURE_2D, target);
    context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, width, height, 0, context.RGBA, context.UNSIGNED_BYTE, pixels);
  };
  const buffer = (data: Float32Array): WebGLBuffer => {
    const result = context.createBuffer();
    if (!result) throw new Error('Could not allocate an island mesh.');
    buffers.add(result);
    context.bindBuffer(context.ARRAY_BUFFER, result);
    context.bufferData(context.ARRAY_BUFFER, data, context.STATIC_DRAW);
    return result;
  };
  const releaseBatch = (batch: Batch): void => {
    context.deleteTexture(batch.texture); textures.delete(batch.texture);
    context.deleteBuffer(batch.buffer); buffers.delete(batch.buffer);
  };
  const onLost = (event: Event): void => {
    event.preventDefault();
    lost = true;
    canvas.dataset.orbitRenderer = 'lost';
  };
  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    canvas.removeEventListener('webglcontextlost', onLost);
    textures.forEach(item => context.deleteTexture(item));
    buffers.forEach(item => context.deleteBuffer(item));
    programs.forEach(item => context.deleteProgram(item.value));
    if (framebuffer) context.deleteFramebuffer(framebuffer);
    textures.clear(); buffers.clear();
    canvas.dataset.orbitRenderer = 'destroyed';
  };
  try {
    const geometry = program(context, vertexShader,
      (derivatives ? '#extension GL_OES_standard_derivatives : enable\n#define DETAIL_FILTER\n' : '')+surfaceShader,
      ['a_position','a_uv','a_barycentric',...(derivatives ? ['a_bounds'] : [])],
      ['u_size','u_origin','u_center','u_rotation','u_projection','u_range','u_texture','u_wireframe',
        ...(derivatives ? ['u_texel','u_minification'] : [])]);
    programs.push(geometry);
    const water = program(context, screenVertexShader, waterShader, ['a_position'],
      ['u_scene','u_depth','u_ocean','u_coast','u_detail','u_light','u_size','u_origin','u_center','u_rotation',
        'u_waterMin','u_waterSpan','u_shadowMin','u_shadowSpan','u_projection','u_range','u_seconds','u_inspect',
        'u_waterHeight','u_patches','u_waves','u_waterLayerA','u_waterLayerB','u_waterLayerC','u_waterLayerD',
        'u_surfaceResponse','u_waterView','u_sunDirection','u_surfaceLight','u_waveEndSoftness',
        'u_waterShallow','u_waterMiddle','u_waterDeep','u_waterDepth','u_waterNoise']);
    programs.push(water);
    const shoreWater = program(context, shoreVertexShader,
      (derivatives ? '#extension GL_OES_standard_derivatives : enable\n#define SHORE_INTERPOLATION\n' : '')+'#define SHORE_MESH\n'+waterShader,
      ['a_position','a_shore','a_gradient','a_beachGradient'],
      Object.keys(water.uniforms).filter(name => name !== 'u_inspect' && name !== 'u_detail'));
    programs.push(shoreWater);
    const scene = texture(), depth = texture(), ocean = texture(true), coast = texture(true), detail = texture(true), light = texture();
    const patches = texture(), waves = texture();
    const bake = environment.oceanBake;
    const patchPixels = new Uint8Array(256*256*4), wavePixels = new Uint8Array(512*512*4);
    for (let i = 0; i < bake.patches.length; i++) {
      patchPixels.set([...bake.palette.subarray(bake.patches[i]*3,bake.patches[i]*3+3),bake.patches[i]],i*4);
    }
    for (let i = 0; i < bake.waves.length; i++) wavePixels.set([bake.waves[i]+128,0,0,255],i*4);
    upload(patches,256,256,patchPixels);
    upload(waves,512,512,wavePixels);
    for (const image of [ocean,coast,detail,light]) upload(image,1,1,new Uint8Array([56,126,140,255]));
    const quad = buffer(new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]));
    framebuffer = context.createFramebuffer();
    if (!framebuffer) throw new Error('Could not allocate the island framebuffer.');
    let batches: Batch[] = [];
    let projection: LandProjection = 'oblique', viewport: IslandViewport | undefined;
    let diagnostics: LandDiagnostics = {};
    let bakedSun: Environment['sun'] | undefined, bakedSignature = '';
    const waterMin = { x: -COAST_PADDING, y: -COAST_PADDING };
    const waterSpan = Math.max(island.world.width,island.world.height)*island.world.tileSize+COAST_PADDING*2;
    let waterPrepared = false, shadowMin = { ...waterMin }, shadowSpan = waterSpan, range = 1;
    const originalTriangles = island.triangles;
    const originalUnderwater = island.beach.underwaterTriangles;
    let bakedTriangles = originalTriangles, bakedUnderwater = originalUnderwater;
    let shoreBuffer: WebGLBuffer | undefined, shoreCount = 0;
    function bakeShore(): void {
      if (shoreBuffer) { context.deleteBuffer(shoreBuffer); buffers.delete(shoreBuffer); }
      const mesh = environment.shoreMesh;
      shoreCount = mesh.vertices.length / SHORE_MESH_STRIDE;
      shoreBuffer = buffer(mesh.vertices);
      canvas.dataset.shoreWaveTriangles = String(shoreCount / 3);
    }

    function bakeSurface(): void {
      const layers = diagnostics.layers ?? createDefaultLayersInspection();
      const customLayers = !isDefaultLayersInspection(diagnostics.layers);
      const landTriangles = activeIslandLandTriangles(island, {
        base: layers.base.visible,
        uplands: layers.uplands.visible,
        beaches: layers.beaches.visible,
      });
      const seabedTriangles = activeIslandSeabedTriangles(island, {
        seabed: layers.seabed.visible,
      });
      const triangles = projection === 'plan'
        ? landTriangles.filter(triangle => triangle.plane === 'top')
        : [...landTriangles, ...seabedTriangles];
      let resolution = 1, pages: Face[][] = [];
      // Lower only texture resolution, never geometry, to respect the fixed GPU budget.
      for (;;) {
        const faces = triangles.map(triangle => faceFor(triangle,resolution)).filter((face): face is Face => Boolean(face));
        faces.sort((a,b) => b.height-a.height);
        pages = [[]];
        let x = 0, y = 0, rowHeight = 0, fits = true;
        for (const face of faces) {
          if (face.width > ATLAS_SIZE || face.height > ATLAS_SIZE) { fits = false; break; }
          if (x+face.width > ATLAS_SIZE) { x = 0; y += rowHeight; rowHeight = 0; }
          if (y+face.height > ATLAS_SIZE) { pages.push([]); x = 0; y = 0; rowHeight = 0; }
          face.x = x; face.y = y;
          pages[pages.length-1].push(face);
          x += face.width; rowHeight = Math.max(rowHeight,face.height);
        }
        if (fits && pages.length <= MAX_ATLASES) break;
        resolution *= 2;
        if (resolution > 128) throw new Error('Island geometry exceeds the GPU atlas budget.');
      }
      const checker = createProjectionChecker();
      const levels = islandLevelPalette(island.world,[211,217,184],[112,142,120]);
      const canShadeLayer = (customLayers || diagnostics.groundMask) && typeof environment.surface.shadeLayer === 'function';
      const defaultShade = diagnostics.checker ? checker : diagnostics.regions ? environment.surface.regions
        : projection === 'plan' ? (triangle: LandTriangle) => levels[triangle.level] : environment.surface.shade;
      const next: Batch[] = [];
      try {
        for (const faces of pages) {
          if (!faces.length) continue;
          const height = faces.reduce((height,face) => Math.max(height,face.y+face.height),1);
          const pixels = new Uint8Array(ATLAS_SIZE*height*4);
          // Alpha is a submerged-shelf marker until the final opaque water composite.
          const vertices = new Float32Array(faces.length*3*VERTEX_STRIDE);
          let cursor = 0;
          for (const face of faces) {
            const layerId = classifyTriangleLayer(face.triangle);
            const layerState = layers[layerId];
            const faceWireframe = Boolean(diagnostics.wireframe || layerState.wireframe);
            const seabedOverlay = face.triangle.submerged && (
              layerState.wireframe || layerState.vertices || layerState.boundaries
              || layerState.normals || layerState.uvChecker || layerState.uvSeams
            );
            const washSurface = layerId === 'beaches'
              && !face.triangle.submerged
              && !hasActiveMeshInspection(diagnostics.layers);
            for (let y = 0; y < face.height; y++) {
              for (let x = 0; x < face.width; x++) {
                const u = (x-0.5)*resolution, v = (y-0.5)*resolution;
                const point = {
                  x: face.a.x+face.u.x*u+face.v.x*v,
                  y: face.a.y+face.u.y*u+face.v.y*v,
                  z: face.a.z+face.u.z*u+face.v.z*v,
                };
                const color = canShadeLayer
                  ? (projection === 'plan' && layerState.materials && !layerState.uvChecker && !layerState.normals && !diagnostics.checker && !diagnostics.regions
                    ? environment.surface.shadeLayer(face.triangle, point, { ...layerState, textures: false, lighting: false }, diagnostics, resolution)
                    : environment.surface.shadeLayer(face.triangle, point, layerState, diagnostics, resolution))
                  : defaultShade(face.triangle,point);
                const offset = ((face.y+y)*ATLAS_SIZE+face.x+x)*4;
                pixels[offset] = color[0]; pixels[offset+1] = color[1]; pixels[offset+2] = color[2];
                const material = washSurface ? environment.surface.material(point.x,point.y) : undefined;
                pixels[offset+3] = face.triangle.submerged && !seabedOverlay ? (face.triangle.plane === 'top' ? 128 : 64)
                  : washSurface && (material === 'wet-sand' || material === 'dry-sand') ? 192 : 255;
              }
            }
            face.triangle.vertices.forEach((point,index) => {
              const uv = face.coordinates[index];
              const b0 = !customLayers || faceWireframe ? Number(index===0) : 1;
              const b1 = !customLayers || faceWireframe ? Number(index===1) : 1;
              const b2 = !customLayers || faceWireframe ? Number(index===2) : 1;
              vertices.set([point.x,point.y,point.z,(face.x+1+uv[0]/resolution)/ATLAS_SIZE,
                (face.y+1+uv[1]/resolution)/height,b0,b1,b2,
                (face.x+0.5)/ATLAS_SIZE,(face.y+0.5)/height,
                (face.x+face.width-0.5)/ATLAS_SIZE,(face.y+face.height-0.5)/height],cursor);
              cursor += VERTEX_STRIDE;
            });
          }
          const image = texture();
          upload(image,ATLAS_SIZE,height,pixels);
          next.push({ buffer: buffer(vertices),texture: image,count: faces.length*3,width: ATLAS_SIZE,height });
        }
      } catch (error) {
        next.forEach(releaseBatch);
        throw error;
      }
      batches.forEach(releaseBatch);
      batches = next;
      canvas.dataset.orbitAtlasResolution = String(resolution);
      canvas.dataset.orbitTriangles = String(triangles.length);
      canvas.dataset.grassCount = '0';
    }

    function bakeWater(): void {
      let left = waterMin.x, top = waterMin.y, right = left+waterSpan, bottom = top+waterSpan;
      const direction = environment.sun.direction;
      // Shadow reach can exceed the coastal band at low sun angles.
      const layers = diagnostics.layers ?? createDefaultLayersInspection();
      const casters = activeIslandLandTriangles(island, {
        base: layers.base.visible, uplands: layers.uplands.visible, beaches: layers.beaches.visible,
      });
      for (const triangle of casters) for (const point of triangle.vertices) {
        const height = Math.max(0,point.z-ISLAND_WATER_HEIGHT);
        const x = point.x-direction.x/direction.z*height, y = point.y-direction.y/direction.z*height;
        left = Math.min(left,x-SHADOW_PADDING); right = Math.max(right,x+SHADOW_PADDING);
        top = Math.min(top,y-SHADOW_PADDING); bottom = Math.max(bottom,y+SHADOW_PADDING);
      }
      shadowMin = { x: Math.floor(left),y: Math.floor(top) };
      shadowSpan = Math.ceil(Math.max(right-shadowMin.x,bottom-shadowMin.y));
      const size = WATER_SIZE;
      const shorePixels = new Uint8Array(size*size*4), detailPixels = new Uint8Array(size*size*4);
      const clampByte = (value: number) => Math.round(Math.max(0,Math.min(1,value))*255);
      const waterDepth = environment.waterDepth;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = y*size+x, px = waterMin.x+(x+0.5)*waterSpan/size, py = waterMin.y+(y+0.5)*waterSpan/size;
          const distance = environment.shore.distance(px,py);
          if (distance > -8 && distance < WATER_COLOR_REACH) {
            const sample = environment.shore.sample(px,py);
            // Recombine paired linear bytes before using steep water-height intersections.
            const distanceCode = Math.round(Math.max(0,Math.min(1,(sample.distance+8)/WATER_DISTANCE_SPAN))*65535);
            shorePixels.set([distanceCode>>>8,clampByte(sample.beachWeight),
              clampByte(sample.shallowWidth/32),clampByte(waterDepth.bodyDepth(px,py)/WATER_MAX_DEPTH)],i*4);
            const phase = Math.round(sample.phase*65535);
            detailPixels.set([phase>>>8,clampByte((sample.breakup+1)/2),
              distanceCode&255,phase&255],i*4);
          } else {
            shorePixels[i*4] = distance <= -8 ? 0 : 255;
            shorePixels[i*4+3] = clampByte(waterDepth.bodyDepth(px,py)/WATER_MAX_DEPTH);
          }
        }
      }
      const pixels = new Uint8Array(size*size*4);
      const up = { x: 0,y: 0,z: 1 };
      for (let i = 0; i < size*size; i++) {
        const x = shadowMin.x+(i%size+0.5)*shadowSpan/size;
        const y = shadowMin.y+(Math.floor(i/size)+0.5)*shadowSpan/size;
        pixels[i*4] = clampByte(waterDepth.bedVisibility(x,y));
        pixels[i*4+3] = clampByte(environment.sun.visibility({ x,y,z: ISLAND_WATER_HEIGHT },up));
      }
      upload(ocean,size,size,pixels);
      upload(coast,size,size,shorePixels);
      upload(detail,size,size,detailPixels);
      const lighting = new Uint8Array(256*256*4);
      for (let visibility = 0; visibility < 256; visibility++) {
        for (let value = 0; value < 256; value++) {
          const color = environment.sun.shade([value,value,value],up,visibility/255);
          lighting.set([...color,255],(visibility*256+value)*4);
        }
      }
      upload(light,256,256,lighting);
    }

    canvas.addEventListener('webglcontextlost',onLost);
    canvas.dataset.orbitRenderer = 'webgl';
    return {
      prepare(nextProjection,nextViewport,nextDiagnostics,seconds) {
        if (destroyed || lost) throw new Error('Island GPU renderer is unavailable; recreate it or use the CPU fallback.');
        if (!['current','oblique','plan'].includes(nextProjection)
          || ![nextViewport.width,nextViewport.height].every(value => Number.isInteger(value) && value > 0 && value <= 2048)
          || ![nextViewport.origin.x,nextViewport.origin.y,seconds].every(Number.isFinite)) {
          throw new Error('Island GPU preparation requires a valid projection, finite time and a 1–2048 pixel viewport.');
        }
        const resized = canvas.width !== nextViewport.width || canvas.height !== nextViewport.height;
        if (resized) { canvas.width = nextViewport.width; canvas.height = nextViewport.height; }
        projection = nextProjection;
        viewport = { ...nextViewport,origin: { ...nextViewport.origin } };
        canvas.dataset.originX = String(viewport.origin.x);
        canvas.dataset.originY = String(viewport.origin.y);
        diagnostics = { ...nextDiagnostics };
        range = Math.max(4096,Math.hypot(island.world.width*island.world.tileSize,island.world.height*island.world.tileSize)*8);
        if (resized || !bakedSun) {
          upload(scene,canvas.width,canvas.height,null);
          context.bindTexture(context.TEXTURE_2D,depth);
          context.texImage2D(context.TEXTURE_2D,0,context.DEPTH_COMPONENT,canvas.width,canvas.height,0,
            context.DEPTH_COMPONENT,context.UNSIGNED_INT,null);
          context.bindFramebuffer(context.FRAMEBUFFER,framebuffer);
          context.framebufferTexture2D(context.FRAMEBUFFER,context.COLOR_ATTACHMENT0,context.TEXTURE_2D,scene,0);
          context.framebufferTexture2D(context.FRAMEBUFFER,context.DEPTH_ATTACHMENT,context.TEXTURE_2D,depth,0);
          if (context.checkFramebufferStatus(context.FRAMEBUFFER) !== context.FRAMEBUFFER_COMPLETE) throw new Error('Island GPU framebuffer is unsupported.');
          context.bindFramebuffer(context.FRAMEBUFFER,null);
        }
        const signature = `${projection}:${Boolean(diagnostics.checker)}:${Boolean(diagnostics.regions)}:${Boolean(diagnostics.groundMask)}:${Boolean(diagnostics.wireframe)}:${layersSignature(diagnostics.layers)}`;
        environment.setLayers(diagnostics.layers);
        const changed = environment.sun !== bakedSun || island.triangles !== bakedTriangles || island.beach.underwaterTriangles !== bakedUnderwater;
        if (!shoreBuffer || island.triangles !== bakedTriangles || island.beach.underwaterTriangles !== bakedUnderwater) bakeShore();
        if (signature !== bakedSignature || changed) bakeSurface();
        if (changed) waterPrepared = false;
        if (projection !== 'plan' && !waterPrepared) {
          bakeWater();
          waterPrepared = true;
        }
        bakedSignature = signature; bakedSun = environment.sun;
        bakedTriangles = island.triangles; bakedUnderwater = island.beach.underwaterTriangles;
      },
      draw(camera,seconds) {
        if (destroyed || lost) return;
        if (!viewport) throw new Error('Prepare the island GPU renderer before drawing.');
        if (![camera.yaw,camera.center.x,camera.center.y,seconds].every(Number.isFinite)) throw new Error('Island GPU camera and time must be finite.');
        const gl = context, view = viewport;
        const layers = diagnostics.layers ?? createDefaultLayersInspection();
        const anyLayerWireframe = Boolean(
          diagnostics.layers && (
            (layers.base.visible && layers.base.wireframe)
            || (layers.uplands.visible && layers.uplands.wireframe)
            || (layers.beaches.visible && layers.beaches.wireframe)
            || (layers.seabed.visible && layers.seabed.wireframe)
          ),
        );
        const anyWireframe = Boolean(diagnostics.wireframe || anyLayerWireframe);
        const projectionNumber = projection === 'current' ? 0 : projection === 'oblique' ? 1 : 2;
        const cosine = Math.cos(camera.yaw), sine = Math.sin(camera.yaw);
        gl.viewport(0,0,view.width,view.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
        gl.disable(gl.BLEND);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(true);
        // Screen Y is inverted in clip space; source mesh fronts are clockwise.
        gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(gl.CW);
        gl.clearColor(56/255,126/255,140/255,0);
        gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
        gl.useProgram(geometry.value);
        const u = geometry.uniforms;
        gl.uniform2f(u.u_size,view.width,view.height); gl.uniform2f(u.u_origin,view.origin.x,view.origin.y);
        gl.uniform2f(u.u_center,camera.center.x,camera.center.y); gl.uniform2f(u.u_rotation,cosine,sine);
        gl.uniform1f(u.u_projection,projectionNumber); gl.uniform1f(u.u_range,range);
        gl.uniform1f(u.u_wireframe,Number(anyWireframe));
        gl.uniform1i(u.u_texture,0);
        if (derivatives) gl.uniform1f(u.u_minification,Number(projection !== 'plan' && !diagnostics.checker && !diagnostics.regions && !diagnostics.groundMask && !anyWireframe && !hasActiveMeshInspection(diagnostics.layers)));
        const drawBatch = (batch: Batch): void => {
          gl.bindBuffer(gl.ARRAY_BUFFER,batch.buffer);
          for (const [name,size,offset] of [['a_position',3,0],['a_uv',2,3],['a_barycentric',3,5],['a_bounds',4,8]] as const) {
            const location = geometry.attributes[name];
            if (location === undefined) continue;
            gl.enableVertexAttribArray(location);
            gl.vertexAttribPointer(location,size,gl.FLOAT,false,VERTEX_STRIDE*4,offset*4);
          }
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,batch.texture);
          if (derivatives) gl.uniform2f(u.u_texel,1/batch.width,1/batch.height);
          gl.drawArrays(gl.TRIANGLES,0,batch.count);
        };
        batches.forEach(drawBatch);
        gl.bindFramebuffer(gl.FRAMEBUFFER,null);
        gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
        gl.useProgram(water.value);
        gl.bindBuffer(gl.ARRAY_BUFFER,quad);
        // Disable geometry-only attributes before binding the much smaller full-screen buffer.
        Object.values(geometry.attributes).forEach(location => gl.disableVertexAttribArray(location));
        const position = water.attributes.a_position;
        gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
        const bindWater = (w: Program['uniforms']): void => {
          for (const [index,name,image] of [
            [0,'u_scene',scene],[1,'u_depth',depth],[2,'u_ocean',ocean],
            [3,'u_coast',coast],[4,'u_detail',detail],[5,'u_light',light],[6,'u_patches',patches],[7,'u_waves',waves],
          ] as const) {
            gl.activeTexture(gl.TEXTURE0+index); gl.bindTexture(gl.TEXTURE_2D,image);
            if (w[name]) gl.uniform1i(w[name],index);
          }
          gl.uniform2f(w.u_size,view.width,view.height); gl.uniform2f(w.u_origin,view.origin.x,view.origin.y);
          gl.uniform2f(w.u_center,camera.center.x,camera.center.y); gl.uniform2f(w.u_rotation,cosine,sine);
          gl.uniform2f(w.u_waterMin,waterMin.x,waterMin.y); gl.uniform1f(w.u_waterSpan,waterSpan);
          gl.uniform2f(w.u_shadowMin,shadowMin.x,shadowMin.y); gl.uniform1f(w.u_shadowSpan,shadowSpan);
          gl.uniform1f(w.u_projection,projectionNumber); gl.uniform1f(w.u_range,range);
          gl.uniform1f(w.u_seconds,seconds%2560); gl.uniform1f(w.u_waterHeight,ISLAND_WATER_HEIGHT);
          if (w.u_inspect) gl.uniform1f(w.u_inspect,Number(Boolean(diagnostics.checker||diagnostics.regions||diagnostics.wireframe)));
          gl.uniform2f(w.u_waterLayerA,Number(layers.water.visible),Number(layers.water.depthColor));
          gl.uniform2f(w.u_waterLayerB,Number(layers.water.colorPatches),Number(layers.water.seabedVisibility && layers.seabed.visible));
          gl.uniform2f(w.u_waterLayerC,Number(layers.water.surfaceHighlights),Number(layers.water.waves));
          gl.uniform2f(w.u_waterLayerD,Number(layers.water.shoreFoam && layers.beaches.visible
            && !hasActiveMeshInspection(diagnostics.layers) && !diagnostics.checker && !diagnostics.regions && !diagnostics.wireframe),
          Number(layers.water.lighting));
          gl.uniform1f(w.u_surfaceResponse,Number(layers.water.surfaceResponse));
          const waterView = waterViewDirection(projection,camera.yaw), sun = environment.sun;
          gl.uniform3f(w.u_waterView,waterView.x,waterView.y,waterView.z);
          gl.uniform3f(w.u_sunDirection,sun.direction.x,sun.direction.y,sun.direction.z);
          gl.uniform4f(w.u_surfaceLight,sun.settings.intensity,sun.settings.skyFill,sun.settings.warmth,sun.settings.shadowStrength);
          const settings = environment.waterSettings;
          gl.uniform3f(w.u_waterShallow,...settings.shallow);
          gl.uniform3f(w.u_waterMiddle,...settings.middle);
          gl.uniform3f(w.u_waterDeep,...settings.deep);
          gl.uniform3f(w.u_waterDepth,settings.transitionDepth,settings.deepDepth,settings.blendSoftness);
          gl.uniform4f(w.u_waterNoise,settings.noiseShallow,settings.noiseDeep,settings.noiseScale,settings.noiseSpeed);
          gl.uniform1f(w.u_waveEndSoftness,settings.waveEndSoftness);
        };
        bindWater(water.uniforms);
        gl.drawArrays(gl.TRIANGLES,0,6);
        if (shoreCount && projection !== 'plan' && layers.water.visible && layers.water.shoreFoam && layers.beaches.visible
          && !hasActiveMeshInspection(diagnostics.layers) && !diagnostics.checker && !diagnostics.regions && !diagnostics.wireframe) {
          gl.disableVertexAttribArray(position);
          gl.useProgram(shoreWater.value);
          bindWater(shoreWater.uniforms);
          gl.bindBuffer(gl.ARRAY_BUFFER,shoreBuffer!);
          for (const [name,size,offset] of [['a_position',2,0],['a_shore',4,2],['a_gradient',2,6],['a_beachGradient',2,8]] as const) {
            const location = shoreWater.attributes[name];
            gl.enableVertexAttribArray(location);
            gl.vertexAttribPointer(location,size,gl.FLOAT,false,SHORE_MESH_STRIDE*4,offset*4);
          }
          gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
          gl.clearDepth(1); gl.clear(gl.DEPTH_BUFFER_BIT);
          gl.enable(gl.DEPTH_TEST);
          gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(gl.CW);
          // Resolve the closest crest before blending overlapping projected water.
          gl.colorMask(false,false,false,false);
          gl.drawArrays(gl.TRIANGLES,0,shoreCount);
          gl.colorMask(true,true,true,true);
          gl.depthFunc(gl.EQUAL);
          gl.drawArrays(gl.TRIANGLES,0,shoreCount);
          gl.depthFunc(gl.LEQUAL);
          gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
          Object.values(shoreWater.attributes).forEach(location => gl.disableVertexAttribArray(location));
        }
      },
      destroy,
    };
  } catch (cause) {
    destroy();
    throw cause;
  }
}
