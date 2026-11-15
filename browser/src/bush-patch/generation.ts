import { seededRandom } from '../foliage-family/core/random';
import { PixelBrush } from '../foliage-family/core/ground-pixel-art';
import { treeSwayAngle, validateTreeMotion, type TreeWind } from '../foliage-family/core/tree-motion';

export const PATCH_SIZE = { width: 384, height: 256 } as const;
export const MOUND_SIZE = { width: 60, height: 44 } as const;
export const MOUND_BASE = 38;
export const PATCH_FORMS = ['Compact', 'Elongated', 'Winding', 'Broken'] as const;
export type BushPalette = 'green' | 'warm';
export interface PatchLobe { x: number; y: number; rx: number; ry: number }
export interface PatchBush {
  seed: number;
  cluster: number;
  x: number;
  y: number;
  depth: number;
  lobes: PatchLobe[];
  palette?: BushPalette;
}
export interface BushPatch {
  seed: number;
  form: typeof PATCH_FORMS[number];
  footprint: PatchLobe[];
  clusters: PatchLobe[][];
  clusterForms: BushPatch['form'][];
  bushes: PatchBush[];
}

export function patchSeed(value: string): number {
  if (/^\d+$/.test(value) && Number(value) <= 0xffffffff) return Number(value);
  if (!value.trim()) throw new Error('Enter a seed number or name.');
  let hash = 2166136261;
  for (const letter of value) hash = Math.imul(hash ^ letter.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function clusterShape(form: number, random: () => number): PatchLobe[] {
  const angle = random() * Math.PI * 2, c = Math.cos(angle), s = Math.sin(angle);
  const length = ((form === 3 ? 80 : 70) + random() * 32) / (1 + Math.abs(s) * 0.65);
  const width = 6 + random() * 3, bend = (14 + random() * 13) * (random() < 0.5 ? -1 : 1);
  const nodes = form === 0 ? 5 : form === 3 ? 19 : 11;
  return Array.from({ length: nodes }, (_, i) => {
    const t = i / (nodes - 1);
    const u = form === 0 ? Math.cos(i * 2.4) * 7 : (t - 0.5) * length;
    const v = form === 0 ? Math.sin(i * 2.4) * 6
      : form === 2 ? Math.sin(t * Math.PI) * bend
      : form === 3 ? Math.sin(t * Math.PI) * 42 : Math.sin(t * Math.PI * 2) * 2;
    const radius = form === 0 ? 12 + random() * 4
      : form === 1 ? width * (1.5 - t)
      : form === 2 ? width * 0.85
      : width * (0.5 + (1.6 + t * 0.6) * (0.5 + 0.5 * Math.cos(t * Math.PI * 4)) ** 3);
    return { x: u * c - v * s, y: u * s + v * c, rx: radius, ry: radius };
  });
}

function clusterBush(x: number, y: number, random: () => number): PatchBush {
  const seed = Math.floor(random() * 0x100000000) >>> 0, local = seededRandom(seed);
  const shape = Math.floor(local() * 3), scale = 0.8 + local() * 0.2;
  const rx = ([10, 7, 5][shape] + local() * [4, 4, 3][shape]) * scale;
  const ry = ([5, 8, 11][shape] + local() * [3, 4, 4][shape]) * scale;
  return { seed, cluster: 0, x, y, depth: 0, lobes: [{ x: 30, y: MOUND_BASE - 2, rx, ry }] };
}

function clusterBushes(lobes: PatchLobe[], random: () => number): PatchBush[] {
  const bushes: PatchBush[] = [];
  const left = Math.floor(Math.min(...lobes.map(lobe => lobe.x - lobe.rx)));
  const right = Math.ceil(Math.max(...lobes.map(lobe => lobe.x + lobe.rx)));
  const back = Math.floor(Math.min(...lobes.map(lobe => lobe.y - lobe.ry)));
  const front = Math.ceil(Math.max(...lobes.map(lobe => lobe.y + lobe.ry)));
  // A staggered, jittered crown-scale weave covers the entire spine, not a fixed bush quota.
  for (let y = back, row = 0; y <= front; y += 4, row++) {
    for (let x = left + row % 2 * 3.5; x <= right; x += 7) {
      const px = Math.round(x + random()), py = Math.round(y + random());
      if (!lobes.some(lobe => ((px - lobe.x) / lobe.rx) ** 2 + ((py - lobe.y) / lobe.ry) ** 2 < 1)) continue;
      bushes.push(clusterBush(px, py, random));
    }
  }
  for (let i = 1; i < lobes.length; i++) {
    const a = lobes[i - 1], b = lobes[i], steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4);
    for (let step = 0; step <= steps; step++) {
      const x = Math.round(a.x + (b.x - a.x) * step / steps), y = Math.round(a.y + (b.y - a.y) * step / steps);
      if (!bushes.some(bush => Math.hypot(bush.x - x, bush.y - y) < 3)) bushes.push(clusterBush(x, y, random));
    }
  }
  return bushes;
}

function canopyShape(pixels: number[]): number[] {
  let x = 0, y = 0, xx = 0, yy = 0, xy = 0;
  for (const pixel of pixels) {
    const px = pixel % 512, py = Math.floor(pixel / 512);
    x += px; y += py; xx += px * px; yy += py * py; xy += px * py;
  }
  const n = pixels.length;
  xx -= x * x / n; yy -= y * y / n; xy -= x * y / n;
  const spread = Math.hypot(xx - yy, 2 * xy);
  return [Math.sqrt((xx + yy + spread) / (xx + yy - spread)), Math.sqrt((xx + yy - spread) / (2 * n))];
}

function solidCanopy(pixels: Set<number>): boolean {
  const flood = (start: number, inside: (pixel: number) => boolean): number => {
    const seen = new Set([start]), pending = [start];
    while (pending.length) {
      const pixel = pending.pop()!;
      for (const offset of [-512, -1, 1, 512]) {
        const next = pixel + offset;
        if (!seen.has(next) && inside(next)) { seen.add(next); pending.push(next); }
      }
    }
    return seen.size;
  };
  if (flood(pixels.values().next().value!, pixel => pixels.has(pixel)) !== pixels.size) return false;
  let left = Infinity, right = -Infinity, back = Infinity, front = -Infinity;
  for (const pixel of pixels) {
    const x = pixel % 512, y = Math.floor(pixel / 512);
    left = Math.min(left, x - 1); right = Math.max(right, x + 1);
    back = Math.min(back, y - 1); front = Math.max(front, y + 1);
  }
  const exterior = flood(back * 512 + left, pixel => {
    const x = pixel % 512, y = Math.floor(pixel / 512);
    return x >= left && x <= right && y >= back && y <= front && !pixels.has(pixel);
  });
  return (right - left + 1) * (front - back + 1) - exterior - pixels.size < pixels.size * 0.035;
}

function addWarmPocket(seed: number, bushes: PatchBush[], clusterCount: number): void {
  const random = seededRandom(seed ^ 0x0c4e);
  if (random() < 0.25) return;
  const cluster = Math.floor(random() * clusterCount), angle = random() * Math.PI * 2;
  const members = bushes.filter(bush => bush.cluster === cluster);
  members.sort((a, b) => (b.x - a.x) * Math.cos(angle) + (b.y - a.y) * Math.sin(angle));
  const anchor = members[0], pocket = [anchor];
  const count = Math.min(8, Math.floor(bushes.length * 0.1), Math.floor(members.length * 0.25));
  while (pocket.length < count) {
    const next = members.filter(bush => !pocket.includes(bush)
      && pocket.some(neighbor => Math.hypot(bush.x - neighbor.x, bush.y - neighbor.y) <= 10))
      .sort((a, b) => Math.hypot(a.x - anchor.x, a.y - anchor.y) - Math.hypot(b.x - anchor.x, b.y - anchor.y))[0];
    if (!next) break;
    pocket.push(next);
  }
  pocket.forEach(bush => { bush.palette = 'warm'; });
}

export function generateBushPatch(seed: number): BushPatch {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Invalid patch seed.');
  const random = seededRandom(seed ^ 0xb057), form = PATCH_FORMS[Math.floor(random() * 4)];
  const count = 2 + Math.floor(random() * 2);
  const forms = [random() < 0.5 ? 0 : 3, 1 + Math.floor(random() * 2)];
  if (count === 3) forms.push(random() < 0.5 ? (forms[0] === 0 ? 3 : 0) : (forms[1] === 1 ? 2 : 1));
  for (let i = forms.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [forms[i], forms[j]] = [forms[j], forms[i]];
  }
  let scale = 1;
  // Restart the layout rather than clipping a long cluster or sparsifying its interior.
  for (let attempt = 0; attempt < 256; attempt++) {
    const clusters: PatchLobe[][] = [], bushes: PatchBush[] = [], clusterForms: BushPatch['form'][] = [];
    const aspects: number[] = [], widths: number[] = [];
    const occupied = new Set<number>();
    for (let index = 0; index < count; index++) {
      const shape = forms[index], lobes = clusterShape(shape, random).map(lobe => ({
        x: lobe.x * scale, y: lobe.y * scale, rx: lobe.rx * scale, ry: lobe.ry * scale,
      }));
      const members = clusterBushes(lobes, random);
      if (members.length < 18) { scale = Math.min(1, scale * 1.03); break; }
      if (bushes.length + members.length > 100) { scale *= 0.94; break; }
      const pixels = new Set<number>();
      for (const bush of members) bushPixels(bush).forEach((row, y) => row.forEach((tone, x) => {
        if (tone) pixels.add((y + bush.y - MOUND_BASE + 128) * 512 + x + bush.x - 30 + 128);
      }));
      if (!solidCanopy(pixels)) break;
      const silhouette = [...pixels];
      const [aspect, width] = canopyShape(silhouette);
      aspects.push(aspect); widths.push(width);
      const left = Math.min(...members.map(bush => bush.x)), right = Math.max(...members.map(bush => bush.x));
      const back = Math.min(...members.map(bush => bush.y)), front = Math.max(...members.map(bush => bush.y));
      let placed = false;
      for (let attempt = 0; attempt < 180; attempt++) {
        const x = Math.ceil(28 - left) + Math.floor(random() * (229 - right + left));
        const y = Math.ceil(132 - back) + Math.floor(random() * (83 - front + back));
        if (x + right > 256 || y + front > 214 || y + back < 132) continue;
        const offset = y * 512 + x;
        if (silhouette.some(pixel => occupied.has(pixel + offset))) continue;
        clusters.push(lobes.map(lobe => ({ ...lobe, x: lobe.x + x, y: lobe.y + y })));
        clusterForms.push(PATCH_FORMS[shape]);
        bushes.push(...members.map(bush => ({ ...bush, cluster: index, x: bush.x + x, y: bush.y + y })));
        // Reserve a real two-dimensional canopy gap, including the unchanged crown silhouettes.
        const horizontal = new Set<number>();
        for (const pixel of pixels) for (let dx = -5; dx <= 5; dx++) horizontal.add(pixel + offset + dx);
        for (const pixel of horizontal) for (let dy = -5; dy <= 5; dy++) occupied.add(pixel + dy * 512);
        placed = true;
        break;
      }
      if (!placed) break;
    }
    if (clusters.length !== count) continue;
    if (Math.min(...aspects) > 1.7 || Math.max(...aspects) < 2.6
      || Math.max(...widths) / Math.min(...widths) < 1.3) continue;
    bushes.sort((a, b) => a.y - b.y || a.x - b.x);
    const near = Math.max(...bushes.map(bush => bush.y)), far = Math.min(...bushes.map(bush => bush.y));
    bushes.forEach(bush => { bush.depth = (bush.y - far) / Math.max(1, near - far); });
    addWarmPocket(seed, bushes, count);
    return { seed, form, footprint: clusters.flat(), clusters, clusterForms, bushes };
  }
  throw new Error('Bush patch generation failed. Try another seed.');
}

const BUSH_COLORS = [[81, 109, 68], [95, 119, 70], [111, 130, 73], [123, 139, 78]] as const;
const WARM_COLORS = [[151, 128, 72], [160, 136, 75], [139, 113, 66], [129, 102, 60]] as const;
export function bushTones(depth: number, seed = 0, palette: BushPalette = 'green'): readonly string[] {
  if (!Number.isFinite(depth) || depth < 0 || depth > 1) throw new RangeError('Invalid bush depth.');
  if (palette !== 'green' && palette !== 'warm') throw new RangeError('Invalid bush palette.');
  const random = seededRandom(seed ^ 0xc0107);
  const colors = palette === 'warm' ? WARM_COLORS : BUSH_COLORS;
  const family = Math.min(colors.length - 1, Math.floor((depth * (palette === 'warm' ? 0 : 0.4)
    + random() * (palette === 'warm' ? 1 : 0.6)) * colors.length));
  const light = 0.9 + random() * 0.12;
  const warmth = (random() - 0.5) * 6;
  const base = colors[family].map((channel, c) => channel * light + (c === 0 ? warmth : c === 2 ? -warmth : 0));
  const hex = (scale: number): string => '#' + base.map(channel => Math.round(Math.min(255, channel * scale)).toString(16).padStart(2, '0')).join('');
  return ['', hex(0.84), hex(1), hex(1.04)];
}

export function bushPixels(bush: PatchBush): number[][] {
  const brush = new PixelBrush(MOUND_SIZE), random = seededRandom(bush.seed);
  const lean = (random() - 0.5) * 4;
  for (const lobe of bush.lobes) {
    for (let y = Math.floor(lobe.y - lobe.ry); y <= Math.min(MOUND_BASE, lobe.y + 1); y++) {
      const height = Math.max(0, (lobe.y - y - 0.5) / lobe.ry);
      for (let x = Math.floor(lobe.x - lobe.rx - 3); x <= lobe.x + lobe.rx + 3; x++) {
        const across = (x + 0.5 - lobe.x - lean * height) / lobe.rx;
        if (Math.abs(across) >= 1 || height ** 2 + across ** 2 > 1) continue;
        if (y + 0.5 > lobe.y + 1 - Math.abs(across)) continue;
        const lower = y > lobe.y - lobe.ry * (0.16 + across * 0.06);
        const shoulder = height > 0.72 && across < -0.12;
        brush.put(x, y, lower ? 1 : shoulder ? 3 : 2);
      }
    }
  }
  return brush.pixels;
}

export function prepareBushMotion(bush: PatchBush): (seconds: number, wind: TreeWind) => number[][] {
  const original = bushPixels(bush);
  return (seconds, wind) => {
    validateTreeMotion(seconds, wind);
    const sway = wind.mode === 0 ? 0 : treeSwayAngle(seconds, bush.seed, wind);
    const flutter = wind.mode === 1 || wind.preset === 0 ? 0
      : wind.direction * wind.strength * 0.2 * (Math.sin(seconds * wind.speed * 1.7 + bush.seed % 31) - Math.sin(bush.seed % 31));
    return original.map((row, y) => {
      const height = (MOUND_BASE - y) / MOUND_BASE;
      const shift = Math.round((sway * MOUND_BASE + flutter) * Math.max(0, height));
      return row.map((_, x) => row[x - shift] ?? 0);
    });
  };
}
