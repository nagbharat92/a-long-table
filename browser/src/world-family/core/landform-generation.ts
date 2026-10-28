import {
  RABBIT_WORLD_FOOTPRINT, containsLandPoint, landHeightAt, landformTriangles,
  type LandMass, type LandPoint, type LandVertex,
} from './landform-study';
import { seededRandom } from './random';

export const LANDFORM_GENERATOR = 'landform-contrast-v3';
export const MAX_LANDFORM_SEED = 999999;
export const LANDFORM_ATTEMPT_LIMIT = 64;
export interface LandformMetrics {
  openGround: number;
  exposedShelf: number;
  shoulderOffset: number;
  heights: readonly number[];
}
export interface LandformSample {
  seed: number;
  masses: readonly LandMass[];
  placements: readonly LandVertex[];
  probe: LandVertex;
  junction: LandVertex;
  attempts: number;
  rejected: readonly string[];
  metrics: LandformMetrics;
}

export function landPolygonArea(points: readonly LandPoint[]): number {
  return points.reduce((area, a, i) => {
    const b = points[(i + 1) % points.length];
    return area + a.x * b.y - a.y * b.x;
  }, 0) / 2;
}

export function distanceToLandBoundary(point: LandPoint, boundary: readonly LandPoint[]): number {
  return Math.min(...boundary.map((a, i) => {
    const b = boundary[(i + 1) % boundary.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
    return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
  }));
}

function orientation(a: LandPoint, b: LandPoint, c: LandPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsTouch(a: LandPoint, b: LandPoint, c: LandPoint, d: LandPoint): boolean {
  if (Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.max(c.x, d.x) < Math.min(a.x, b.x)
    || Math.max(a.y, b.y) < Math.min(c.y, d.y) || Math.max(c.y, d.y) < Math.min(a.y, b.y)) return false;
  return orientation(a, b, c) * orientation(a, b, d) <= 0
    && orientation(c, d, a) * orientation(c, d, b) <= 0;
}

function supportedBoundary(lower: readonly LandPoint[], upper: readonly LandPoint[], clearance: number): boolean {
  if (!upper.every(p => containsLandPoint(lower, p)
    && distanceToLandBoundary(p, lower) + 1e-8 >= clearance)) return false;
  if (clearance > 0 && lower.some(p => distanceToLandBoundary(p, upper) < clearance)) return false;
  return upper.every((a, i) => {
    const b = upper[(i + 1) % upper.length];
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const splits = [0, 1];
    for (const [j, c] of lower.entries()) {
      const d = lower[(j + 1) % lower.length];
      if (orientation(a, b, c) * orientation(a, b, d) < -1e-8
        && orientation(c, d, a) * orientation(c, d, b) < -1e-8) return false;
      if (Math.abs(orientation(a, b, c)) < 1e-7) {
        const t = ((c.x - a.x) * dx + (c.y - a.y) * dy) / length;
        if (t > 0 && t < 1) splits.push(t);
      }
    }
    splits.sort((a, b) => a - b);
    return splits.slice(1).every((end, j) => {
      const t = (splits[j] + end) / 2;
      return containsLandPoint(lower, { x: a.x + dx * t, y: a.y + dy * t });
    });
  });
}

export function validateLandform(masses: readonly LandMass[]): string[] {
  const failures: string[] = [];
  if (masses.length !== 3) return ['Expected exactly three elevation regions.'];
  for (const [level, mass] of masses.entries()) {
    const points = mass.boundary;
    if (points.length < 3 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))
      || !Number.isFinite(mass.height) || !Number.isFinite(mass.floor)
      || mass.floor !== (level === 0 ? -4 : masses[level - 1].height)
      || (level === 0 && mass.height !== 0)
      || (level === 1 && (mass.height < 8 || mass.height > 26))
      || (level === 2 && (mass.height < 24 || mass.height > 56 || mass.height - mass.floor < 8 || mass.height - mass.floor > 34))) {
      failures.push(`${mass.id}: invalid coordinates or elevations.`);
      continue;
    }
    if (landPolygonArea(points) <= 0) failures.push(`${mass.id}: collapsed or reversed boundary.`);
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      if (Math.hypot(a.x - b.x, a.y - b.y) < 1) {
        failures.push(`${mass.id}: edge shorter than one source pixel.`);
      }
      for (let j = i + 2; j < points.length; j++) {
        if (i === 0 && j === points.length - 1) continue;
        if (segmentsTouch(a, b, points[j], points[(j + 1) % points.length])) {
          failures.push(`${mass.id}: self-intersecting boundary.`);
        }
      }
    }
    if (level > 0) {
      const lower = masses[level - 1].boundary;
      if (!supportedBoundary(lower, points, 0)) {
        failures.push(`${mass.id}: unsupported receiving-surface boundary.`);
      }
      const ratio = landPolygonArea(points) / landPolygonArea(lower);
      if (ratio < 0.18 || ratio > 0.70) {
        failures.push(`${mass.id}: mass hierarchy outside study bounds (${ratio.toFixed(3)}).`);
      }
      if (landPolygonArea(lower) - landPolygonArea(points) < (level === 1 ? 1800 : 500)
        || landPolygonArea(points) < (level === 1 ? 1800 : 450)) {
        failures.push(`${mass.id}: insufficient usable area or exposed receiving surface.`);
      }
    }
  }
  if (!failures.length) {
    try { landformTriangles(masses); }
    catch (cause) { failures.push(cause instanceof Error ? cause.message : String(cause)); }
  }
  return [...new Set(failures)];
}

function placementsFor(masses: readonly LandMass[]): { placements: LandVertex[]; probe: LandVertex } {
  const placements: LandVertex[] = [];
  let probe: LandVertex | undefined;
  let probeScore = -Infinity;
  for (const mass of masses) {
    let best: LandVertex | undefined;
    let bestScore = -Infinity;
    for (let y = -68; y <= 64; y += 2) {
      for (let x = -88; x <= 76; x += 2) {
        const point = { x, y };
        if (landHeightAt(point, masses) !== mass.height) continue;
        const clearance = Math.min(...masses.filter(other => other.height >= mass.height)
          .map(other => distanceToLandBoundary(point, other.boundary)));
        const score = clearance + y * 0.22 + x * 0.12;
        if (clearance >= RABBIT_WORLD_FOOTPRINT && score > bestScore) {
          best = { x, y, z: mass.height };
          bestScore = score;
        }
        if (mass.height === 0 && clearance >= RABBIT_WORLD_FOOTPRINT / 2) {
          const score = -y - distanceToLandBoundary(point, masses[1].boundary);
          if (score > probeScore) { probe = { x, y, z: 0 }; probeScore = score; }
        }
      }
    }
    if (!best) throw new Error(`${mass.id}: no clear rabbit-scale placement.`);
    placements.push(best);
  }
  if (!probe) throw new Error('No supported rear probe placement.');
  return { placements, probe };
}

function generatedOutline(random: () => number): LandPoint[] {
  const between = (min: number, max: number): number => min + random() * (max - min);
  const count = Math.floor(between(11, 20));
  const rotation = between(0, Math.PI * 2);
  const aspect = between(1, 2.4);
  const phase = between(0, Math.PI * 2);
  const second = between(0.04, 0.18), third = between(0.03, 0.16);
  const bayAngle = between(0, Math.PI * 2), bayDepth = between(0.08, 0.36), bayWidth = between(0.35, 0.85);
  const start = between(0, Math.PI * 2);
  const cosine = Math.cos(rotation), sine = Math.sin(rotation);
  return Array.from({ length: count }, (_, i) => {
    const angle = start + (i + between(-0.15, 0.15)) * Math.PI * 2 / count;
    const bayDistance = Math.atan2(Math.sin(angle - bayAngle), Math.cos(angle - bayAngle));
    const radius = 1 + second * Math.cos(2 * angle + phase) + third * Math.sin(3 * angle - phase)
      - bayDepth * Math.exp(-0.5 * (bayDistance / bayWidth) ** 2);
    const x = Math.cos(angle) * radius * Math.sqrt(aspect);
    const y = Math.sin(angle) * radius / Math.sqrt(aspect);
    return { x: x * cosine - y * sine, y: x * sine + y * cosine };
  });
}

function polygonCenter(points: readonly LandPoint[]): LandPoint {
  let x = 0, y = 0, area = 0;
  for (const [i, a] of points.entries()) {
    const b = points[(i + 1) % points.length], cross = a.x * b.y - b.x * a.y;
    x += (a.x + b.x) * cross;
    y += (a.y + b.y) * cross;
    area += cross;
  }
  return { x: x / (3 * area), y: y / (3 * area) };
}

export function measureLandform(masses: readonly LandMass[]): LandformMetrics {
  const areas = masses.map(mass => landPolygonArea(mass.boundary));
  const base = polygonCenter(masses[0].boundary), shoulder = polygonCenter(masses[2].boundary);
  return {
    openGround: 1 - areas[1] / areas[0],
    exposedShelf: 1 - areas[2] / areas[1],
    shoulderOffset: Math.hypot(shoulder.x - base.x, shoulder.y - base.y) / Math.sqrt(areas[0] / Math.PI),
    heights: masses.map(mass => mass.height),
  };
}

function fitRaisedOutline(
  lower: readonly LandPoint[], outline: readonly LandPoint[], random: () => number, ratio: number, offset: number,
): LandPoint[] {
  const center = polygonCenter(lower);
  const direction = random() * Math.PI * 2;
  const distance = Math.sqrt(landPolygonArea(lower) / Math.PI) * offset;
  const anchor = { x: center.x + Math.cos(direction) * distance, y: center.y + Math.sin(direction) * distance };
  const maximum = Math.sqrt(landPolygonArea(lower) * ratio / landPolygonArea(outline));
  const clearance = RABBIT_WORLD_FOOTPRINT + 0.8 + random();
  const scaled = (scale: number): LandPoint[] => outline.map(p => ({ x: anchor.x + p.x * scale, y: anchor.y + p.y * scale }));
  let low = 0, high = maximum;
  // Fit the whole boundary, not just its vertices, into the receiving surface.
  for (let iteration = 0; iteration < 16; iteration++) {
    const mid = (low + high) / 2;
    if (supportedBoundary(lower, scaled(mid), clearance)) low = mid;
    else high = mid;
  }
  const result = scaled(low);
  while (result.length > 6) {
    const short = result.findIndex((p, i) => {
      const next = result[(i + 1) % result.length];
      return Math.hypot(p.x - next.x, p.y - next.y) < RABBIT_WORLD_FOOTPRINT + 0.3;
    });
    if (short < 0) break;
    result.splice(short, 1);
  }
  return result;
}

function clipOutline(points: readonly LandPoint[], normal: LandPoint, offset: number): LandPoint[] {
  const result: LandPoint[] = [];
  for (const [i, a] of points.entries()) {
    const b = points[(i + 1) % points.length];
    const da = a.x * normal.x + a.y * normal.y - offset;
    const db = b.x * normal.x + b.y * normal.y - offset;
    if (da >= 0) result.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return result;
}

function carveRaisedOutline(lower: readonly LandPoint[], random: () => number, ratio: number): LandPoint[] {
  let result = [...lower];
  const count = random() < 0.5 ? 1 : 2;
  const angle = random() * Math.PI * 2;
  const perCut = ratio ** (1 / count);
  for (let cut = 0; cut < count; cut++) {
    const direction = angle + cut * (0.8 + random() * 1.4);
    const normal = { x: Math.cos(direction), y: Math.sin(direction) };
    const dots = result.map(p => p.x * normal.x + p.y * normal.y);
    let low = Math.min(...dots), high = Math.max(...dots);
    const target = landPolygonArea(result) * perCut;
    for (let iteration = 0; iteration < 20; iteration++) {
      const mid = (low + high) / 2;
      if (landPolygonArea(clipOutline(result, normal, mid)) > target) low = mid;
      else high = mid;
    }
    result = clipOutline(result, normal, (low + high) / 2);
  }
  return result;
}

function stitchBoundaries(masses: readonly LandMass[]): LandMass[] {
  const points = masses.flatMap(mass => [...mass.boundary]);
  return masses.map(mass => ({
    ...mass,
    boundary: mass.boundary.flatMap((a, i) => {
      const b = mass.boundary[(i + 1) % mass.boundary.length];
      const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
      const splits = points.filter(p => Math.abs(orientation(a, b, p)) < 1e-7)
        .map(p => ({ p, t: ((p.x - a.x) * dx + (p.y - a.y) * dy) / length }))
        .filter(({ t }) => t > 1e-8 && t < 1 - 1e-8)
        .sort((a, b) => a.t - b.t);
      return [a, ...splits.filter((entry, j) => j === 0 || entry.t - splits[j - 1].t > 1e-8).map(entry => entry.p)];
    }),
  }));
}

export function generateLandform(seed: number, contours = true): LandformSample {
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_LANDFORM_SEED) {
    throw new Error(`Landform seed must be a whole number from 0 to ${MAX_LANDFORM_SEED}.`);
  }
  const random = seededRandom(seed);
  const between = (min: number, max: number): number => min + random() * (max - min);
  const rejected: string[] = [];
  for (let attempt = 1; attempt <= LANDFORM_ATTEMPT_LIMIT; attempt++) {
    const outline = generatedOutline(random);
    const size = between(0.91, 1);
    const extentX = Math.max(...outline.map(p => Math.abs(p.x)));
    const extentY = Math.max(...outline.map(p => Math.abs(p.y)));
    const diagonal = Math.max(...outline.map(p => Math.abs(p.x - p.y)));
    const scale = Math.min(78 / extentX, 62 / extentY, 110 / diagonal) * size;
    const base = outline.map(p => ({ x: p.x * scale - 4, y: p.y * scale - 2 }));
    const shelfCoverage = between(0.20, 0.68), shoulderCoverage = between(0.22, 0.68);
    const shelf = random() < 0.7 ? carveRaisedOutline(base, random, shelfCoverage)
      : fitRaisedOutline(base, generatedOutline(random), random, shelfCoverage, between(0.10, 0.48));
    const shoulder = random() < 0.6 ? carveRaisedOutline(shelf, random, shoulderCoverage)
      : fitRaisedOutline(shelf, generatedOutline(random), random, shoulderCoverage, between(0.05, 0.42));
    const height = Math.round(between(24, 56));
    const shelfHeight = Math.round(between(Math.max(8, height - 34), Math.min(26, height - 8)));
    const simple = stitchBoundaries([
      { id: 'low-base', floor: -4, height: 0, boundary: base },
      { id: 'middle-shelf', floor: 0, height: shelfHeight, boundary: shelf },
      { id: 'high-shoulder', floor: shelfHeight, height, boundary: shoulder },
    ]);
    const bendX = between(-2.2, 2.2), bendY = between(-2.2, 2.2), phase = between(0, Math.PI * 2);
    // A smooth, shared warp changes broad bends without per-vertex noise.
    const refined = simple.map(mass => ({
      ...mass,
      boundary: mass.boundary.map(({ x, y }) => ({
        x: x + bendX * Math.sin(y / 42 + phase),
        y: y + bendY * Math.sin(x / 48 + phase),
      })),
    }));
    // Both contour modes select the same composition and attempt.
    const failures = [...new Set([...validateLandform(simple), ...validateLandform(refined)])];
    if (failures.length) { rejected.push(`Attempt ${attempt}: ${failures.join(' ')}`); continue; }
    try {
      const simpleMarkers = placementsFor(simple);
      const refinedMarkers = placementsFor(refined);
      const masses = contours ? refined : simple;
      const markers = contours ? refinedMarkers : simpleMarkers;
      const front = masses[2].boundary.reduce((a, b) => a.x + a.y > b.x + b.y ? a : b);
      const junction = { ...front, z: shelfHeight };
      return { seed, masses, ...markers, junction, attempts: attempt, rejected, metrics: measureLandform(masses) };
    } catch (cause) {
      rejected.push(`Attempt ${attempt}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  throw new Error(`Seed ${seed}: no valid landform after ${LANDFORM_ATTEMPT_LIMIT} attempts. ${rejected.at(-1)}`);
}
