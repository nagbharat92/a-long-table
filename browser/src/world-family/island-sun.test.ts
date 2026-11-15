import { describe, expect, it } from 'vitest';
import { generateIslandLandform } from './core/island-landform';
import type { LandTriangle, LandVertex } from './core/landform-study';
import { surfaceNormal } from './render/surface-projection';
import {
  createIslandSun, DEFAULT_SUN, sunParameters, sunSettingsFromParameters, validateSunSettings,
  type SunSettings,
} from './render/island-sun';

const up = { x: 0, y: 0, z: 1 };
const settings = (overrides: Partial<SunSettings> = {}): SunSettings => ({
  ...DEFAULT_SUN, azimuth: 0, elevation: 45, shadowMode: 'hard', mapSize: 1024, ...overrides,
});
const triangle = (a: LandVertex, b: LandVertex, c: LandVertex): LandTriangle => ({
  vertices: [a, b, c], plane: 'top', level: 0,
});
function quad(a: LandVertex, b: LandVertex, c: LandVertex, d: LandVertex): LandTriangle[] {
  return [triangle(a, b, c), triangle(a, c, d)];
}
const roof = (z = 20) => quad(
  { x: 0, y: -40, z }, { x: 20, y: -40, z },
  { x: 20, y: 40, z }, { x: 0, y: 40, z },
);

// Independent geometric ray/triangle oracle, used only in the actual mesh proof.
function intersects(p: LandVertex, d: LandVertex, t: LandTriangle): boolean {
  const [a, b, c] = t.vertices;
  const e = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const f = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  const h = { x: d.y * f.z - d.z * f.y, y: d.z * f.x - d.x * f.z, z: d.x * f.y - d.y * f.x };
  const det = e.x * h.x + e.y * h.y + e.z * h.z;
  if (Math.abs(det) < 1e-9) return false;
  const s = { x: p.x - a.x, y: p.y - a.y, z: p.z - a.z };
  const u = (s.x * h.x + s.y * h.y + s.z * h.z) / det;
  if (u < 0 || u > 1) return false;
  const q = { x: s.y * e.z - s.z * e.y, y: s.z * e.x - s.x * e.z, z: s.x * e.y - s.y * e.x };
  const v = (d.x * q.x + d.y * q.y + d.z * q.z) / det;
  return v >= 0 && u + v <= 1 && (f.x * q.x + f.y * q.y + f.z * q.z) / det > 0.01;
}

describe('directional triangle sunlight', () => {
  it('scales local sky fill without changing direct light, visibility or global settings', () => {
    const input = settings({ skyFill: 0.3 }), sun = createIslandSun(roof(), input);
    const brighterSky = createIslandSun(roof(), { ...input, skyFill: 0.525 });
    const color = [132, 104, 72], normal = { x: 1, y: 0, z: 0 };
    for (const visibility of [0, 0.5, 1]) {
      expect(sun.shade(color, normal, visibility, 1.75)).toEqual(brighterSky.shade(color, normal, visibility));
      expect(sun.shade(color, normal, visibility)).toEqual(sun.shade(color, normal, visibility, 1));
    }
    const darkSky = createIslandSun([], { ...input, skyFill: 0 });
    expect(darkSky.shade(color, normal, 1, 1.75)).toEqual(darkSky.shade(color, normal, 1));
    expect(darkSky.shade(color, normal, 0, 1.75)).toEqual([0, 0, 0]);
    expect(sun.settings).toEqual(input);
  });

  it('uses the documented defaults and round-trips the complete URL settings without mutation', () => {
    expect(DEFAULT_SUN).toEqual({
      azimuth: 230, elevation: 40, intensity: 1, skyFill: 0.3, warmth: 0.3,
      shadowStrength: 1, softness: 2, shadowMode: 'contact', mapSize: 1024,
    });
    expect(Object.isFrozen(DEFAULT_SUN)).toBe(true);
    expect(sunSettingsFromParameters(new URLSearchParams())).toEqual(DEFAULT_SUN);
    const input = Object.freeze(settings({ azimuth: 360, shadowMode: 'filtered', mapSize: 2048, softness: 8 }));
    expect(sunSettingsFromParameters(sunParameters(input))).toEqual(input);
    const copy = validateSunSettings(input);
    expect(copy).toEqual(input);
    expect(copy).not.toBe(input);
    const source = settings(), sun = createIslandSun([], source);
    source.intensity = 0;
    expect(sun.settings.intensity).toBe(1);
    expect(Object.isFrozen(sun.settings)).toBe(true);
    expect(Object.isFrozen(sun.direction)).toBe(true);
  });

  it.each([
    ['azimuth', -1], ['azimuth', 361], ['elevation', 9], ['elevation', 86],
    ['intensity', -0.1], ['intensity', 2.1], ['skyFill', -0.1], ['skyFill', 1.1],
    ['warmth', -0.1], ['warmth', 1.1], ['shadowStrength', -0.1], ['shadowStrength', 1.1],
    ['softness', -0.1], ['softness', 8.1], ['mapSize', 768], ['shadowMode', 'random'],
    ['mapSize', '1024'], ['intensity', '1'], ['azimuth', NaN], ['elevation', Infinity],
  ])('rejects invalid %s=%s explicitly', (field, value) => {
    const input = { ...DEFAULT_SUN, [field]: value } as SunSettings;
    const before = { ...input };
    expect(() => validateSunSettings(input)).toThrow();
    expect(() => createIslandSun([], input)).toThrow();
    expect(() => sunParameters(input)).toThrow();
    expect(input).toEqual(before);
  });

  it.each([
    'sunAzimuth=', 'sunElevation= ', 'sunIntensity=NaN', 'skyFill=Infinity',
    'sunWarmth=0.5x', 'shadowStrength=-1', 'shadowSoftness=9',
    'shadowMode=bad', 'shadowQuality=1024.0', 'shadowQuality=0x400',
    'sunAzimuth=0x10', 'sunIntensity=1_0', 'sunAzimuth=2&sunAzimuth=bad',
    'shadowMode=hard&shadowMode=contact',
  ])('rejects malformed URL parameter %s', query => {
    const params = new URLSearchParams(query), before = params.toString();
    expect(() => sunSettingsFromParameters(params)).toThrow();
    expect(params.toString()).toBe(before);
  });

  it('rotates a normalized Z-up sun and casts to remote ocean receivers at low elevations', () => {
    const geometry = roof(), before = structuredClone(geometry);
    const east = createIslandSun(geometry, settings());
    const west = createIslandSun(geometry, settings({ azimuth: 180 }));
    expect(Math.hypot(...Object.values(east.direction))).toBeCloseTo(1, 14);
    expect(east.direction.x).toBeCloseTo(Math.SQRT1_2);
    expect(east.direction.z).toBeCloseTo(Math.SQRT1_2);
    expect(east.visibility({ x: -10, y: 0, z: 0 })).toBe(0);
    expect(west.visibility({ x: -10, y: 0, z: 0 })).toBe(1);
    expect(west.visibility({ x: 30, y: 0, z: 0 })).toBe(0);
    const low = createIslandSun(geometry, settings({ elevation: 10 }));
    const distant = { x: 10 - 20 / Math.tan(Math.PI / 18), y: 0, z: 0 };
    expect(distant.x).toBeLessThan(-100);
    expect(low.visibility(distant)).toBe(0);
    expect(low.visibility({ ...distant, y: 10000 })).toBe(1);
    expect(low.visibility({ x: 1e7, y: -1e7, z: 0 })).toBe(1);
    expect(createIslandSun([], settings()).visibility(distant)).toBe(1);
    expect(geometry).toEqual(before);
  });

  it('receives real cast shadows on a vertical wall, not just horizontal tops', () => {
    const wall = quad(
      { x: -15, y: -8, z: 0 }, { x: -15, y: 8, z: 0 },
      { x: -15, y: 8, z: 12 }, { x: -15, y: -8, z: 12 },
    );
    const sun = createIslandSun([...roof(), ...wall], settings());
    const normal = surfaceNormal(wall[0]);
    expect(normal).toEqual({ x: 1, y: 0, z: 0 });
    expect(sun.visibility({ x: -15, y: 0, z: 1 }, normal)).toBe(0);
    expect(sun.visibility({ x: -15, y: 0, z: 10 }, normal)).toBe(1);
    const contact = { x: -0.08, y: 0, z: 19.9 };
    expect(sun.visibility(contact, up)).toBe(0);
  });

  it.each(['hard', 'filtered', 'contact'] as const)('has no self-acne on a sloped plane in %s mode', shadowMode => {
    const point = (x: number, y: number) => ({ x, y, z: 0.2 * x - 0.1 * y });
    const plane = quad(point(-50, -50), point(50, -50), point(50, 50), point(-50, 50));
    const normal = surfaceNormal(plane[0]);
    const sun = createIslandSun(plane, settings({ shadowMode, softness: 8, elevation: 10 }));
    for (let y = -40; y <= 40; y += 4) for (let x = -40; x <= 40; x += 4) {
      expect(sun.visibility(point(x, y), normal)).toBe(1);
    }
  });

  it('offers hard tests, bounded fractional PCF edges, and identical hard results at zero softness', () => {
    const hard = createIslandSun(roof(), settings());
    const filtered = createIslandSun(roof(), settings({ shadowMode: 'filtered', softness: 2 }));
    const zeroFiltered = createIslandSun(roof(), settings({ shadowMode: 'filtered', softness: 0 }));
    const zeroContact = createIslandSun(roof(), settings({ shadowMode: 'contact', softness: 0 }));
    const hardSoft = createIslandSun(roof(), settings({ softness: 8 }));
    let fractions = 0;
    for (let x = -24; x <= -16; x += 0.1) {
      const p = { x, y: 0, z: 0 }, h = hard.visibility(p), f = filtered.visibility(p);
      expect(h === 0 || h === 1).toBe(true);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
      if (f > 0 && f < 1) fractions++;
      expect(zeroFiltered.visibility(p)).toBe(h);
      expect(zeroContact.visibility(p)).toBe(h);
      expect(hardSoft.visibility(p)).toBe(h);
    }
    expect(fractions).toBeGreaterThan(30);
    expect(filtered.visibility({ x: -10, y: 0, z: 0 })).toBe(0);
    expect(filtered.visibility({ x: -30, y: 0, z: 0 })).toBe(1);
  });

  it('uses angular directional penumbrae that grow with blocker distance and source size', () => {
    const broad = createIslandSun(roof(), settings({ shadowMode: 'contact', softness: 8, mapSize: 2048 }));
    const narrow = createIslandSun(roof(), settings({ shadowMode: 'contact', softness: 2, mapSize: 2048 }));
    function fractionalWidth(sun: ReturnType<typeof createIslandSun>, z: number): number {
      const edge = -(20 - z);
      let count = 0;
      for (let i = -200; i <= 200; i++) {
        const visibility = sun.visibility({ x: edge + i * 0.025, y: 0, z });
        if (visibility > 0 && visibility < 1) count++;
      }
      return count * 0.025;
    }
    const near = fractionalWidth(broad, 19), far = fractionalWidth(broad, 0);
    expect(far).toBeGreaterThan(2);
    expect(near).toBeLessThan(0.5);
    expect(far).toBeGreaterThan(near * 5);
    expect(far).toBeGreaterThan(fractionalWidth(narrow, 0) * 2);
  });

  it('separates cool sky fill and warm direct lighting; shadow strength never changes raw visibility', () => {
    const geometry = roof(), color = Object.freeze([120, 150, 100]), before = [...color];
    const sun = createIslandSun(geometry, settings());
    const disabled = createIslandSun(geometry, settings({ shadowStrength: 0 }));
    const p = { x: -10, y: 0, z: 0 };
    expect(sun.visibility(p)).toBe(0);
    expect(disabled.visibility(p)).toBe(0);
    expect(disabled.shade(color, up, 0)).toEqual(disabled.shade(color, up, 1));
    expect(sun.shade(color, up, 1)).toEqual(disabled.shade(color, up, 1));
    const sky = createIslandSun([], settings({ intensity: 0 }));
    expect(sun.shade(color, up, 0)).toEqual(sky.shade(color, up));
    expect(sun.shade(color, up, 0)[1]).toBeLessThan(sun.shade(color, up, 1)[1]);
    const white = [150, 150, 150], warm = createIslandSun([], settings({ warmth: 1, skyFill: 0 }));
    const lit = warm.shade(white, up);
    expect(lit[0]).toBeGreaterThan(lit[2]);
    const skyWhite = sky.shade(white, up);
    expect(skyWhite[2]).toBeGreaterThan(skyWhite[0]);
    expect(sun.shade([60, 75, 50], up)[1]).toBeLessThan(sun.shade(color, up)[1]);
    for (const result of [lit, skyWhite, sun.shade([Infinity, -10, 999], up), sun.shade(color, { x: NaN, y: 0, z: 1 })]) {
      expect(result.every(value => Number.isInteger(value) && value >= 0 && value <= 255)).toBe(true);
    }
    expect(color).toEqual(before);
  });

  it('matches actual terrace, ascent and beach triangle occlusion and is deterministic without modifying the mesh', () => {
    const island = generateIslandLandform(12), before = structuredClone(island);
    expect(island.triangles.some(t => t.ascentId !== undefined)).toBe(true);
    expect(island.beach).toBeDefined();
    const timings: string[] = [];
    createIslandSun(island.triangles, settings({ mapSize: 512 }));
    for (const mapSize of [512, 1024, 2048] as const) {
      const samples: number[] = [];
      for (let run = 0; run < 3; run++) {
        const start = performance.now();
        const timed = createIslandSun(island.triangles, settings({ mapSize }));
        samples.push(performance.now() - start);
        expect(timed.settings.mapSize).toBe(mapSize);
      }
      timings.push(`${mapSize}: ${samples.sort((a, b) => a - b)[1].toFixed(1)}ms`);
    }
    console.info(`island sunlight factory median (${island.triangles.length} actual mesh triangles): ${timings.join(', ')}`);
    const sun = createIslandSun(island.triangles, settings({ azimuth: 230, elevation: 20, mapSize: 2048 }));
    const repeat = createIslandSun(island.triangles, settings({ azimuth: 230, elevation: 20, mapSize: 2048 }));
    let blocked = 0, lit = 0, agreement = 0, total = 0;
    for (const t of island.triangles) {
      const normal = surfaceNormal(t);
      if (normal.x * sun.direction.x + normal.y * sun.direction.y + normal.z * sun.direction.z < 0.15) continue;
      const p = {
        x: t.vertices.reduce((sum, v) => sum + v.x, 0) / 3,
        y: t.vertices.reduce((sum, v) => sum + v.y, 0) / 3,
        z: t.vertices.reduce((sum, v) => sum + v.z, 0) / 3,
      };
      const visible = sun.visibility(p, normal);
      const ray = { x: p.x + normal.x * 0.005, y: p.y + normal.y * 0.005, z: p.z + normal.z * 0.005 };
      const expected = island.triangles.some(other => intersects(ray, sun.direction, other)) ? 0 : 1;
      agreement += Number(visible === expected);
      total++;
      if (visible) lit++; else blocked++;
      expect(repeat.visibility(p, normal)).toBe(visible);
      expect(repeat.shade([120, 150, 100], normal, visible)).toEqual(sun.shade([120, 150, 100], normal, visible));
    }
    expect(blocked).toBeGreaterThan(10);
    expect(lit).toBeGreaterThan(10);
    expect(agreement / total).toBeGreaterThan(0.97);
    expect(island).toEqual(before);
  });

  it('rejects non-finite geometry instead of constructing a corrupt map', () => {
    expect(() => createIslandSun([triangle({ x: NaN, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, up)])).toThrow('finite');
  });

  it('is two-sided and supports a bounded hot query loop without rebuilding geometry', () => {
    const geometry = roof();
    const reversed = geometry.map(t => ({ ...t, vertices: [...t.vertices].reverse() as unknown as LandTriangle['vertices'] }));
    const options = settings({ shadowMode: 'contact', softness: 8 });
    const sun = createIslandSun(geometry, options), reverse = createIslandSun(reversed, options);
    const p = { x: 0, y: 0, z: 0 }, color = [120, 150, 100];
    let checksum = 0;
    const start = performance.now();
    for (let i = 0; i < 100000; i++) {
      p.x = -25 + (i % 400) * 0.075;
      p.y = ((i / 400) | 0) % 40 - 20;
      const visible = sun.visibility(p, up);
      if (i < 400) expect(reverse.visibility(p, up)).toBe(visible);
      checksum += sun.shade(color, up, visible)[1];
    }
    const elapsed = performance.now() - start;
    expect(checksum).toBeGreaterThan(100000);
    // Broad sanity guard only, not a hardware-sensitive frame-time benchmark.
    expect(elapsed).toBeLessThan(5000);
    console.info(`island sunlight: 100k contact visibility + shade queries in ${Math.round(elapsed)}ms`);
    const shadeStart = performance.now();
    for (let i = 0; i < 65536; i++) {
      const level = i & 255;
      color[0] = color[1] = color[2] = level;
      checksum += sun.shade(color, up, (i >>> 8) / 255)[0];
    }
    expect(checksum).toBeGreaterThan(100000);
    console.info(`island sunlight: 65,536 grayscale shade LUT queries in ${(performance.now() - shadeStart).toFixed(1)}ms`);
  });
});
