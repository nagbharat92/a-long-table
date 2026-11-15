import { seededRandom } from '../foliage-family/core/random';
import { treeSwayAngle, validateTreeMotion, type TreeWind } from '../foliage-family/core/tree-motion';
import { color } from '../foliage-family/core/tree-shadow-study';
import { bushPixels, bushTones, MOUND_BASE, PATCH_SIZE, type BushPatch, type PatchBush } from './generation';

export interface CanopyPoint {
  x: number;
  y: number;
  groundY: number;
  height: number;
  normal: readonly [number, number, number];
  rgb: readonly number[];
  green: readonly number[];
  crease: boolean;
  region: number;
  greenRegion: number;
}
export interface CanopyFrame {
  surface: CanopyPoint[];
  tops: CanopyPoint[];
}
export interface PreparedCanopy {
  baseY: number;
  creaseCount: number;
  draw(seconds: number, wind: TreeWind): CanopyFrame;
}

function inwardDistance(mask: Uint8Array, width: number, height: number, regions?: Uint8Array): Float32Array {
  const distance = Float32Array.from(mask, value => value ? mask.length : 0);
  const neighbor = (i: number, next: number): number => regions && regions[i] !== regions[next] ? 0 : distance[next];
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x;
    if (mask[i]) distance[i] = Math.min(distance[i], neighbor(i, i - 1) + 1, neighbor(i, i - width) + 1,
      neighbor(i, i - width - 1) + Math.SQRT2, neighbor(i, i - width + 1) + Math.SQRT2);
  }
  for (let y = height - 2; y > 0; y--) for (let x = width - 2; x > 0; x--) {
    const i = y * width + x;
    if (mask[i]) distance[i] = Math.min(distance[i], neighbor(i, i + 1) + 1, neighbor(i, i + width) + 1,
      neighbor(i, i + width - 1) + Math.SQRT2, neighbor(i, i + width + 1) + Math.SQRT2);
  }
  return distance;
}

export function prepareCanopy(patch: BushPatch, cluster: number): PreparedCanopy {
  const members = patch.bushes.filter(bush => bush.cluster === cluster).sort((a, b) => a.y - b.y || a.x - b.x);
  if (!members.length || !patch.clusters[cluster]?.length) throw new Error('A canopy needs a populated footprint.');
  const seed = (patch.seed ^ Math.imul(cluster + 1, 0xca90)) >>> 0, random = seededRandom(seed);
  const artwork = new Map(members.map(bush => [bush, bushPixels(bush)]));
  const points = new Set<number>();
  for (const [bush, pixels] of artwork) pixels.forEach((row, y) => row.forEach((tone, x) => {
    if (tone) points.add((y + bush.y - MOUND_BASE) * PATCH_SIZE.width + x + bush.x - 30);
  }));
  const xs = [...points].map(i => i % PATCH_SIZE.width), ys = [...points].map(i => Math.floor(i / PATCH_SIZE.width));
  const left = Math.min(...xs) - 1, right = Math.max(...xs) + 1, back = Math.min(...ys) - 1, front = Math.max(...ys) + 1;
  const width = right - left + 1, height = front - back + 1, size = width * height;
  const mask = new Uint8Array(size), exterior = new Uint8Array(size);
  const heights = new Float32Array(size), creases = new Uint8Array(size);
  const regions = new Uint8Array(size), greenRegions = new Uint8Array(size);
  const local = (x: number, y: number): number => (y - back) * width + x - left;
  for (const point of points) mask[local(point % PATCH_SIZE.width, Math.floor(point / PATCH_SIZE.width))] = 1;
  const pending = [0]; exterior[0] = 1;
  while (pending.length) {
    const i = pending.pop()!;
    for (const next of [i - width, i + width, i % width ? i - 1 : -1, i % width < width - 1 ? i + 1 : -1]) {
      if (next >= 0 && next < size && !mask[next] && !exterior[next]) { exterior[next] = 1; pending.push(next); }
    }
  }
  // Preserve crown-shaped outer edges, but fill enclosed gaps into one opaque foliage mass.
  for (let i = 0; i < size; i++) {
    mask[i] = Number(!exterior[i]);
  }
  const regionRandom = seededRandom(seed ^ 0x5ade);
  const centers = [members[Math.floor(regionRandom() * members.length)]];
  const regionCount = Math.min(3, Math.max(2, Math.round(members.length / 20)));
  while (centers.length < regionCount && centers.length < members.length) {
    const candidates = members.filter(bush => !centers.includes(bush));
    candidates.sort((a, b) => Math.min(...centers.map(c => Math.hypot(b.x - c.x, b.y - c.y)))
      - Math.min(...centers.map(c => Math.hypot(a.x - c.x, a.y - c.y))));
    centers.push(candidates[0]);
  }
  // Few colour masses share crowns; foreground foliage cuts their boundaries instead of a geometric stencil.
  for (const [bush, pixels] of artwork) {
    const nearest = centers.map((c, region) => ({ region, distance: Math.hypot(bush.x - c.x, bush.y - c.y) }))
      .sort((a, b) => a.distance - b.distance)[0].region;
    pixels.forEach((row, y) => row.forEach((tone, x) => {
      if (!tone) return;
      const i = local(x + bush.x - 30, y + bush.y - MOUND_BASE);
      greenRegions[i] = nearest;
      regions[i] = bush.palette === 'warm' ? 3 : nearest;
    }));
  }
  const distance = inwardDistance(mask, width, height);
  const regionDistance = inwardDistance(mask, width, height, regions);
  const crowns: PatchBush[] = [];
  const count = Math.min(8, Math.max(2, Math.round(members.length / 7)));
  for (let attempt = 0; attempt < 128 && crowns.length < count; attempt++) {
    const bush = members[Math.floor(random() * members.length)];
    if (crowns.some(crown => Math.hypot(bush.x - crown.x, bush.y - crown.y) < 11)) continue;
    crowns.push(bush);
    const lobe = bush.lobes[0], pixels = artwork.get(bush)!;
    pixels.forEach((row, y) => row.forEach((tone, x) => {
      if (!tone || y >= lobe.y - lobe.ry * 0.4 || x > lobe.x + lobe.rx * 0.3) return;
      if (pixels[y - 1]?.[x] && row[x - 1]) return;
      const i = local(x + bush.x - 30, y + bush.y - MOUND_BASE);
      if (distance[i] > 1.4) creases[i] = 1;
    }));
  }
  const phase = random() * Math.PI * 2, bottom = new Int16Array(width);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    if (mask[y * width + x]) bottom[x] = y;
  }
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x;
    if (!mask[i]) continue;
    const rise = crowns.slice(0, 3).reduce((sum, crown) => sum + 1.2 * Math.exp(-(((x + left - crown.x) / 16) ** 2
      + ((y + back - crown.y + 5) / 12) ** 2)), 0);
    const regionalRise = 1.8 * (1 - Math.exp(-Math.max(0, regionDistance[i] - 1) / 2));
    heights[i] = Math.min(bottom[x] - y, 1.5 + 5.5 * (1 - Math.exp(-distance[i] / 2.3)) + rise + regionalRise);
  }
  const depth = members.reduce((sum, bush) => sum + bush.depth, 0) / members.length;
  const green = color(bushTones(depth, patch.seed ^ cluster)[2]), warm = members.filter(bush => bush.palette === 'warm');
  const warmColor = color(bushTones(depth, warm[0]?.seed ?? patch.seed, 'warm')[2]);
  const surface: CanopyPoint[] = [];
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x;
    if (!mask[i]) continue;
    const gx = x + left, gy = y + back, z = heights[i];
    const nx = (heights[i - 1] - heights[i + 1]) * 0.5, ny = (heights[i - width] - heights[i + width]) * 0.5;
    const length = Math.hypot(nx, ny, 1);
    let variation = [1, 0.93, 1.04][greenRegions[i]];
    const leaf = (Math.imul(Math.floor(gx / 4), 73856093) ^ Math.imul(Math.floor(gy / 3), 19349663) ^ seed) >>> 0;
    if (distance[i] > 2 && leaf % 13 === 0 && gx % 4 < 2 && gy % 3 === 1) variation *= 0.92;
    const inWarm = regions[i] === 3;
    surface.push({ x: gx, y: gy, groundY: gy + z, height: z, normal: [nx / length, ny / length, 1 / length],
      rgb: (inWarm ? warmColor : green).map(c => Math.round(c * variation)),
      green: green.map(c => Math.round(c * variation)), crease: Boolean(creases[i]), region: regions[i], greenRegion: greenRegions[i] });
  }
  const baseY = front - 1, top = back + 1;
  return {
    baseY, creaseCount: crowns.length,
    draw(seconds, wind) {
      validateTreeMotion(seconds, wind);
      const sway = wind.mode === 0 ? 0 : treeSwayAngle(seconds, seed, wind);
      const flutter = wind.mode === 1 || wind.preset === 0 ? 0 : wind.direction * wind.strength * 0.12
        * (Math.sin(seconds * wind.speed * 1.7 + phase) - Math.sin(phase));
      const moving = surface.map(point => ({ ...point,
        x: point.x + Math.round((sway * 20 + flutter) * (baseY - point.y) / Math.max(1, baseY - top)) }));
      return { surface: moving, tops: moving };
    },
  };
}
