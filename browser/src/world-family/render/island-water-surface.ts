import type { LandCamera, LandProjection } from '../core/landform-study';
import type { IslandSun } from './island-sun';
import type { SurfaceColor } from './island-surface';
import { BEACH_WAVE_OFFSHORE, DEFAULT_BEACH_WAVE_END_SOFTNESS, shoreWaveWeight } from './island-beach-wash';

const TAU = Math.PI * 2;
const WAVES = [
  { x: 0.92, y: 0.38, length: 32, slope: 0.16, period: 16, phase: 0.4 },
  { x: 0.78, y: 0.63, length: 21, slope: 0.075, period: 10, phase: 1.7 },
  { x: 0.98, y: -0.2, length: 49, slope: 0.055, period: 32, phase: 3.1 },
] as const;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (a: number, b: number, value: number) => {
  const t = clamp((value - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const normalize = (x: number, y: number, z: number) => {
  const length = Math.hypot(x, y, z);
  return { x: x / length, y: y / length, z: z / length };
};

/** Analytic slopes only: neither the waterline nor the submerged geometry moves. */
export function waterSurfaceNormal(x: number, y: number, seconds: number) {
  if (![x, y, seconds].every(Number.isFinite)) throw new RangeError('Water surface coordinates and time must be finite.');
  const time = ((seconds % 2560) + 2560) % 2560;
  let dx = 0, dy = 0;
  for (const wave of WAVES) {
    const slope = wave.slope * Math.cos((x * wave.x + y * wave.y) * TAU / wave.length
      - time * TAU / wave.period + wave.phase);
    dx += wave.x * slope;
    dy += wave.y * slope;
  }
  return normalize(-dx, -dy, 1);
}

export function coastalWaterNormal(
  x: number, y: number, seconds: number, distance: number, beach: number, wash: boolean,
  slope = 0, gradient: { x: number; y: number } = { x: 0, y: 0 },
  endSoftness = DEFAULT_BEACH_WAVE_END_SOFTNESS,
) {
  if (Number.isNaN(distance) || ![beach, slope, gradient.x, gradient.y].every(Number.isFinite))
    throw new RangeError('Coastal normals need a valid distance and finite beach weight, slope and gradient.');
  return coastalWaterNormalFromGradient(x, y, seconds, distance, beach, wash,
    { x: gradient.x * slope, y: gradient.y * slope }, endSoftness);
}

export function coastalWaterNormalFromGradient(
  x: number, y: number, seconds: number, distance: number, beach: number, wash: boolean,
  heightGradient: { x: number; y: number } = { x: 0, y: 0 }, endSoftness = DEFAULT_BEACH_WAVE_END_SOFTNESS,
) {
  if (Number.isNaN(distance) || ![beach, heightGradient.x, heightGradient.y].every(Number.isFinite)) {
    throw new RangeError('Coastal normals need a valid distance and finite beach weight and height gradient.');
  }
  const support = shoreWaveWeight(distance, beach, endSoftness);
  const strength = wash ? 1 - support : 1;
  const wave = waterSurfaceNormal(x, y, seconds);
  const z = 1 + (wave.z - 1) * strength;
  return normalize(wave.x * strength / z - heightGradient.x, wave.y * strength / z - heightGradient.y, 1);
}

export function waterRefractionNormal(
  normal: { x: number; y: number; z: number }, x: number, y: number, seconds: number,
  distance: number, beach: number, wash: boolean, endSoftness = DEFAULT_BEACH_WAVE_END_SOFTNESS,
) {
  if (![normal.x, normal.y, normal.z].every(Number.isFinite) || normal.z <= 0)
    throw new RangeError('Refraction normals must be finite and upward.');
  const support = shoreWaveWeight(distance, beach, endSoftness);
  const retained = wash ? support * 0.75 : 0;
  const wave = waterSurfaceNormal(x, y, seconds);
  return normalize(normal.x / normal.z + wave.x / wave.z * retained,
    normal.y / normal.z + wave.y / wave.z * retained, 1);
}

export function waterViewDirection(projection: LandProjection, yaw = 0) {
  if (!Number.isFinite(yaw)) throw new RangeError('Water view yaw must be finite.');
  const view = projection === 'current' ? normalize(0, 1, 1)
    : projection === 'oblique' ? normalize(1, 1, 0.85) : { x: 0, y: 0, z: 1 };
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: view.x * c + view.y * s, y: -view.x * s + view.y * c, z: view.z };
}

export function createWaterSurfaceResponse(sun: IslandSun, projection: LandProjection, camera?: LandCamera) {
  const view = waterViewDirection(projection, camera?.yaw);
  const light = sun.direction, settings = sun.settings;
  const half = normalize(light.x + view.x, light.y + view.y, light.z + view.z);
  return (color: SurfaceColor, x: number, y: number, seconds: number, transmission: number, visibility: number,
    strength = 1, localNormal?: { x: number; y: number; z: number }): SurfaceColor => {
    const wave = localNormal ?? waterSurfaceNormal(x, y, seconds);
    const normal = normalize(wave.x * strength, wave.y * strength, 1 + (wave.z - 1) * strength);
    const nv = clamp(normal.x * view.x + normal.y * view.y + normal.z * view.z);
    const nl = Math.max(0, normal.x * light.x + normal.y * light.y + normal.z * light.z);
    const nh = Math.max(0, normal.x * half.x + normal.y * half.y + normal.z * half.z);
    const direct = settings.intensity * (1 - settings.shadowStrength * (1 - clamp(visibility)));
    const time = ((seconds % 2560) + 2560) % 2560;
    const group = smooth(0.1, 0.8, Math.sin(x * 0.023 + y * 0.031 - time * TAU / 160)
      * Math.sin(x * 0.037 - y * 0.019 - time * TAU / 256));
    const diffuse = (nl - light.z) * direct * 12 * (1 - transmission);
    const specular = smooth(0.5, 0.95, nh ** 48) * direct * 9 * group;
    const reflection = (0.035 + 0.16 * (1 - nv) ** 4) * Math.min(1, settings.skyFill / 0.3);
    const sky = smooth(-0.2, 0.9, 2 * nv * normal.z - view.z);
    const skyColor = [97 + sky * 61, 139 + sky * 45, 145 + sky * 34];
    const warmth = [1 + settings.warmth * 0.12, 1, 1 - settings.warmth * 0.22];
    const component = (channel: number) => Math.round(Math.max(0, Math.min(255,
      (color[channel] + diffuse) * (1 - reflection) + skyColor[channel] * reflection + specular * warmth[channel])));
    return [component(0), component(1), component(2)];
  };
}

const glsl = (value: number) => value.toFixed(12);
export const WATER_SURFACE_GLSL = `
vec3 waterSurfaceNormal(vec2 p, float seconds) {
  vec2 slope=vec2(0.0);
  ${WAVES.map(wave => `slope+=vec2(${glsl(wave.x)},${glsl(wave.y)})*${glsl(wave.slope)}
    *cos(dot(p,vec2(${glsl(wave.x)},${glsl(wave.y)}))*${glsl(TAU / wave.length)}
      -seconds*${glsl(TAU / wave.period)}+${glsl(wave.phase)});`).join('\n  ')}
  return normalize(vec3(-slope,1.0));
}
vec3 coastalWaterNormalFromGradient(vec2 p, float seconds, float distance, float beach, float wash,
  vec2 heightGradient, float endSoftness) {
  float strength=1.0-wash*beach*smoothstep(0.6,0.6+endSoftness,beach)
    *(1.0-smoothstep(4.0,${BEACH_WAVE_OFFSHORE.toFixed(1)},distance));
  vec3 wave=waterSurfaceNormal(p,seconds);
  float z=1.0+(wave.z-1.0)*strength;
  return normalize(vec3(wave.xy*strength/z-heightGradient,1.0));
}
vec3 coastalWaterNormal(vec2 p, float seconds, float distance, float beach, float wash, float slope, vec2 gradient) {
  return coastalWaterNormalFromGradient(p,seconds,distance,beach,wash,gradient*slope,
    ${DEFAULT_BEACH_WAVE_END_SOFTNESS.toFixed(2)});
}
vec3 waterRefractionNormal(vec3 normal, vec2 p, float seconds, float distance, float beach, float wash,
  float endSoftness) {
  float retained=wash*0.75*beach*smoothstep(0.6,0.6+endSoftness,beach)
    *(1.0-smoothstep(4.0,${BEACH_WAVE_OFFSHORE.toFixed(1)},distance));
  vec3 wave=waterSurfaceNormal(p,seconds);
  return normalize(vec3(normal.xy/normal.z+wave.xy/wave.z*retained,1.0));
}
vec3 waterSurfaceResponseNormal(vec3 color, vec2 p, float seconds, vec3 view, vec3 light,
  vec4 settings, float transmission, float visibility, vec3 normal) {
  float nv=clamp(dot(normal,view),0.0,1.0);
  float nl=max(0.0,dot(normal,light));
  float nh=max(0.0,dot(normal,normalize(light+view)));
  float direct=settings.x*(1.0-settings.w*(1.0-clamp(visibility,0.0,1.0)));
  float group=smoothstep(0.1,0.8,sin(dot(p,vec2(0.023,0.031))-seconds*${glsl(TAU / 160)})
    *sin(dot(p,vec2(0.037,-0.019))-seconds*${glsl(TAU / 256)}));
  float diffuse=(nl-light.z)*direct*12.0*(1.0-transmission);
  float specular=smoothstep(0.5,0.95,pow(nh,48.0))*direct*9.0*group;
  float reflection=(0.035+0.16*pow(1.0-nv,4.0))*min(1.0,settings.y/0.3);
  float sky=smoothstep(-0.2,0.9,2.0*nv*normal.z-view.z);
  vec3 skyColor=mix(vec3(97.0,139.0,145.0),vec3(158.0,184.0,179.0),sky);
  vec3 warmth=vec3(1.0+settings.z*0.12,1.0,1.0-settings.z*0.22);
  return floor(clamp((color+diffuse)*(1.0-reflection)+skyColor*reflection+specular*warmth,0.0,255.0)+0.5);
}
`;
