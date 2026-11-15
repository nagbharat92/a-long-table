import type { Point, World } from './contracts';
import type { IslandAscent } from './island-ascents';
import type { IslandProceduralCoast } from './island-coast-profile';
import { planOpposingShores } from './island-coast-budget';
import { seededRandom } from './random';

export interface IslandCoastStats {
  candidates: number;
  rejectedProtected: number;
  rejectedWidth: number;
  rejectedConnectivity: number;
  rejectedOverlap: number;
  coves: number;
  beaches: number;
  carvedCells: number;
  sandyCells: number;
}

interface Strand {
  shore: Point;
  inward: Point;
  tangent: Point;
  halfLength: number;
}

const GRADE = 24;
const DRY = 16;
const NORMALS: readonly Point[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

function connected(world: World, removed: ReadonlySet<number>): boolean {
  const first = world.cells.findIndex((land, i) => !!land && !removed.has(i));
  if (first < 0) return false;
  const seen = new Uint8Array(world.cells.length), queue = [first];
  seen[first] = 1;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const i = queue[cursor], x = i % world.width, y = Math.floor(i / world.width);
    for (const n of NORMALS) {
      const nx = x + n.x, ny = y + n.y, next = ny * world.width + nx;
      if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height
        || seen[next] || !world.cells[next] || removed.has(next)) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }
  return queue.length === world.cells.reduce((sum, land) => sum + Number(!!land), 0) - removed.size;
}

/** Excavates shallow bays only where an entire beach and an inland dry route fit. */
export function generateIslandCoasts(
  original: World, ascents: readonly IslandAscent[],
): { world: World; coast: IslandProceduralCoast; stats: IslandCoastStats } {
  if (!original.elevations || !original.rampIds || !original.cliffCells
    || original.tileSize <= 0 || !Number.isFinite(original.tileSize)) {
    throw new Error('Procedural coasts require a generated terraced island.');
  }
  const world: World = {
    ...original, cells: original.cells.slice(), heights: original.heights.slice(),
    cliffCells: original.cliffCells.slice(),
    generatorVersion: `${original.generatorVersion}-procedural-coasts-v1`,
  };
  const { width, height, tileSize: size } = world;
  const grade = Math.ceil(GRADE / size), dry = Math.ceil(DRY / size);
  const stats: IslandCoastStats = {
    candidates: 0, rejectedProtected: 0, rejectedWidth: 0, rejectedConnectivity: 0,
    rejectedOverlap: 0, coves: 0, beaches: 0, carvedCells: 0, sandyCells: 0,
  };
  const indexAt = (x: number, y: number) => x < 0 || y < 0 || x >= width || y >= height ? -1 : y * width + x;
  const land = (x: number, y: number) => !!world.cells[indexAt(x, y)];
  const protectedCells = new Uint8Array(world.cells.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (!world.cells[i]) continue;
    const highland = [-2, -1, 0, 1, 2].some(dy => [-2, -1, 0, 1, 2].some(dx => {
      const next = indexAt(x + dx, y + dy);
      return next >= 0 && world.cells[next] && (original.elevations![next] > 0 || original.rampIds![next] >= 0);
    }));
    const stair = ascents.some(({ bounds }) =>
      (x + 1) * size > bounds.x - size * 2 && x * size < bounds.x + bounds.width + size * 2
      && (y + 1) * size > bounds.y - size * 2 && y * size < bounds.y + bounds.height + size * 2);
    protectedCells[i] = Number(highland || stair || original.cliffCells![i]);
  }
  const rng = seededRandom(original.seed ^ 0x24c0a57);
  const candidates: Strand[] = [];
  for (let y = 2; y < height - 2; y++) for (let x = 2; x < width - 2; x++) {
    if (!land(x, y)) continue;
    for (const inward of NORMALS) {
      if (land(x - inward.x, y - inward.y)) continue;
      if (protectedCells[y * width + x]) {
        stats.candidates++; stats.rejectedProtected++;
        continue;
      }
      candidates.push({
        shore: { x, y }, inward, tangent: { x: -inward.y, y: inward.x },
        halfLength: 8 + Math.floor(rng() * 5),
      });
    }
  }
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const claimed = new Uint8Array(world.cells.length);
  const regions: IslandProceduralCoast['regions'][number][] = [];
  const accepted: { strand: Strand; shores: number[]; sand: Set<number> }[] = [];
  const target = 2 + Math.floor(rng() * 2);
  // Search all possible bays before assigning remaining room to open beaches.
  search: for (const depth of [5, 3, 0]) {
    for (const strand of candidates.slice(0, 360)) {
      if (regions.length >= target) break search;
      const { shore, inward, tangent, halfLength } = strand;
      const phase = shore.x * 0.37 + shore.y * 0.61 + original.seed % 97;
      const at = (t: number, d: number) => ({
        x: shore.x + tangent.x * t + inward.x * d,
        y: shore.y + tangent.y * t + inward.y * d,
      });
      stats.candidates++;
      const removed = new Set<number>(), sand = new Set<number>(), reserve = new Set<number>();
      const shores: number[] = [];
      let rejection: 'Protected' | 'Width' | 'Overlap' | undefined;
      for (let t = -halfLength; t <= halfLength && !rejection; t++) {
        let start: number | undefined;
        for (let d = -4; d <= 4; d++) {
          const p = at(t, d), outside = at(t, d - 1);
          if (land(p.x, p.y) && !land(outside.x, outside.y)) { start = d; break; }
        }
        if (start === undefined) { rejection = 'Width'; break; }
        const cut = Math.round(depth * Math.cos(t / halfLength * Math.PI / 2) ** 2
          * (1 + 0.1 * Math.sin(t * 0.31 + phase)));
        const end = start + cut;
        const sandyDepth = Math.ceil((grade + 2 + 0.6 * Math.sin(t * 0.71 + phase))
          * smooth((halfLength - Math.abs(t)) / 3));
        shores.push(end);
        // A whole six-tile grade, four-tile dry connection and opposite
        // original three-unit shore must fit; neither shore is steepened.
        let run = 0;
        while (run < cut + grade + dry + 2) {
          const p = at(t, start + run);
          if (!land(p.x, p.y)) break;
          run++;
        }
        if (run <= cut || planOpposingShores((run - cut) * size, { width: GRADE, priority: 2 },
          { width: size, priority: 1 }, DRY).first !== GRADE) { rejection = 'Width'; break; }
        for (let d = start; d < end + grade + dry + 1; d++) {
          const p = at(t, d), i = indexAt(p.x, p.y);
          if (i < 0 || !world.cells[i]) { rejection = 'Width'; break; }
          if (claimed[i]) { rejection = 'Overlap'; break; }
          if (protectedCells[i]) { rejection = 'Protected'; break; }
          reserve.add(i);
          if (d < end) removed.add(i);
          else if (d < end + sandyDepth) sand.add(i);
        }
      }
      if (rejection) { stats[`rejected${rejection}`]++; continue; }
      // Check both axes, including oblique/sideways necks missed by normal rays.
      for (const i of removed) {
        const x = i % width, y = Math.floor(i / width);
        for (const n of NORMALS.slice(0, 2)) {
          for (const sign of [-1, 1]) {
            const dx = n.x * sign, dy = n.y * sign;
            let px = x + dx, py = y + dy, remaining = 0;
            while (land(px, py) && removed.has(indexAt(px, py))) { px += dx; py += dy; }
            while (land(px, py) && !removed.has(indexAt(px, py))) { remaining++; px += dx; py += dy; }
            if (remaining > 0 && remaining < dry) rejection = 'Width';
          }
        }
      }
      if (rejection) { stats.rejectedWidth++; continue; }
      if (removed.size && !connected(world, removed)) { stats.rejectedConnectivity++; continue; }
      if (depth && removed.size < 24) { stats.rejectedWidth++; continue; }
      for (const i of reserve) claimed[i] = 1;
      for (const i of removed) {
        world.cells[i] = 0;
        world.heights[i] = world.seaLevel - 0.1;
        world.cliffCells![i] = 0;
      }
      for (const i of sand) {
        if (world.heights[i] !== Math.fround(world.seaLevel + 0.06)) stats.sandyCells++;
        world.heights[i] = world.seaLevel + 0.06;
        world.cliffCells![i] = 0;
      }
      stats.carvedCells += removed.size;
      stats[depth ? 'coves' : 'beaches']++;
      const middle = at(0, shores[halfLength]);
      regions.push({
        kind: depth ? 'cove' : 'beach',
        center: { x: (middle.x + 0.5 - inward.x * 0.5) * size, y: (middle.y + 0.5 - inward.y * 0.5) * size },
        normal: { x: -inward.x, y: -inward.y }, length: (halfLength * 2 + 1) * size, depth: depth * size,
      });
      accepted.push({ strand, shores, sand });
    }
  }
  const spacing = 2, padding = 56, shelf = 52 / size;
  const maskWidth = Math.ceil((width * size + padding * 2) / spacing) + 1;
  const maskHeight = Math.ceil((height * size + padding * 2) / spacing) + 1;
  const weights = new Float32Array(maskWidth * maskHeight);
  const beachCells = new Uint8Array(world.cells.length);
  for (const { strand, shores, sand } of accepted) {
    for (const index of sand) beachCells[index] = 1;
    const { shore, inward, tangent, halfLength } = strand;
    const phase = shore.x * 0.37 + shore.y * 0.61 + original.seed % 97;
    for (let y = 0; y < maskHeight; y++) for (let x = 0; x < maskWidth; x++) {
      const dx = (x * spacing - padding) / size - shore.x - 0.5;
      const dy = (y * spacing - padding) / size - shore.y - 0.5;
      const t = dx * tangent.x + dy * tangent.y, d = dx * inward.x + dy * inward.y;
      if (Math.abs(t) > halfLength - 0.5) continue;
      const ray = Math.max(0, Math.min(shores.length - 1, Math.round(t) + halfLength));
      const inland = d - shores[ray] + 0.5;
      if (inland > grade + 1 || inland < -shelf - 1) continue;
      const cell = indexAt(Math.floor((x * spacing - padding) / size), Math.floor((y * spacing - padding) / size));
      if (cell >= 0 && world.cells[cell] && !sand.has(cell)) continue;
      const offshoreDistance = Math.max(0, -inland);
      const offshoreFraction = Math.min(1, offshoreDistance / shelf);
      const bend = 1.5 * Math.sin(offshoreFraction * Math.PI) * Math.sin(phase);
      const halfWidth = (halfLength - 0.5) * Math.sqrt(1 - offshoreFraction ** 2)
        * (1 + 0.06 * Math.sin(t * 0.22 + phase) * Math.sin(offshoreFraction * Math.PI));
      const ends = smooth((halfWidth - Math.abs(t - bend)) / 2.5);
      // Ownership is constant across the COMPLETE inland grade, not selected
      // from the nearest shore (which might be the opposing side of a neck).
      // Round the offshore footprint and meet the ordinary deep seabed over a
      // broad smooth falloff, rather than clipping a bright rectangular shelf.
      const offshore = 1 - smooth((offshoreDistance * size - 16) / 36);
      const i = y * maskWidth + x;
      weights[i] = Math.max(weights[i], ends * offshore);
    }
  }
  const focus = regions[0]?.center ?? { x: width * size / 2, y: height * size / 2 };
  return {
    world, stats,
    coast: { kind: 'procedural', gradeWidth: GRADE, shelfWidth: 52, shelfDepth: 2, focus, beachCells,
      mask: { origin: { x: -padding, y: -padding }, spacing, width: maskWidth, height: maskHeight, weights }, regions },
  };
}
