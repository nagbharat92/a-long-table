import FastNoiseLite from 'fastnoise-lite';
import type { World } from './contracts';
import { ISLAND_HEIGHT_PALETTE, ISLAND_MAX_CLIFF_RISE } from './island-heights';
import { seededRandom } from './random';
import {
  BEACH_LEVEL, cleanIslandMask, connectIslandElevations, generateWorld, islandCoastDistance,
} from './world';

export const V2_TERRACE_GENERATOR: string = 'browser-seeded-terraces-v2-masses-v2';
const ATTEMPTS = 96;

function compositions(tiers: number, prefix: number[] = [0]): number[][] {
  if (prefix.length === tiers) return [prefix];
  return ISLAND_HEIGHT_PALETTE.flatMap(height =>
    height > prefix[prefix.length - 1] && height - prefix[prefix.length - 1] <= ISLAND_MAX_CLIFF_RISE
      ? compositions(tiers, [...prefix, height]) : []);
}

/**
 * Select the composition before searching topology. Retries move and reshape the
 * same nested masses; they never reduce the chosen number or height of terraces.
 */
export function generateTerracedIslandWorld(seed: number): World {
  const world = generateWorld(seed);
  const grass = Uint8Array.from(world.cells, (land, i) => Number(land && world.heights[i] > BEACH_LEVEL));
  const shore = islandCoastDistance(grass);
  const depth = shore.reduce((max, value, i) => grass[i] ? Math.max(max, value) : max, 0);
  const rng = seededRandom(seed ^ 0x4267ab19);
  const capacity = depth >= 27 ? 4 : depth >= 19 ? 3 : depth >= 12 ? 2 : 1;
  const choice = rng();
  const tiers = capacity === 1 || choice < 0.06 ? 1
    : 2 + Math.floor(((choice - 0.06) / 0.94) * (capacity - 1));
  const choices = compositions(tiers);
  world.elevationHeights = Object.freeze(choices[Math.floor(rng() * choices.length)]);
  const coverage = rng();
  const anchors: number[] = [];
  const foothills: number[] = [];
  const requiredDepth = tiers === 4 ? 27 : tiers === 3 ? 19 : 12;
  for (let i = 0; i < grass.length; i++) {
    if (!grass[i]) continue;
    if (shore[i] >= requiredDepth) anchors.push(i);
    if (shore[i] >= 12) foothills.push(i);
  }
  const spatial = seededRandom(seed ^ 0x7ab361e);
  const character = spatial();
  const massCount = character < 0.3 ? 1 : character < 0.75 ? 2 + Math.floor(spatial() * 2) : 2;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const levels = new Uint8Array(world.cells.length);
    if (tiers > 1) {
      const random = seededRandom(seed ^ 0x53b1249 ^ Math.imul(attempt + 1, 104729));
      const anchor = anchors[Math.floor(random() * anchors.length)];
      const x = anchor % world.width, y = Math.floor(anchor / world.width);
      const angle = random() * Math.PI * 2;
      const minimumRadius = 6 + (tiers - 2) * 8;
      const radius = minimumRadius + Math.max(0, shore[anchor] - 5 - minimumRadius) * (0.25 + coverage * 0.75);
      const masses = [{
        x, y, radius, cosine: Math.cos(angle), sine: Math.sin(angle),
        aspect: 1.1 + random() * (tiers === 2 ? 1.5 : 0.65),
      }];
      for (let mass = 1; mass < massCount; mass++) {
        const direction = angle + (mass === 1 ? 0 : Math.PI) + (random() - 0.5) * 0.9;
        const separation = radius * (1.0 + random() * 0.7);
        const targetX = x + Math.cos(direction) * separation;
        const targetY = y + Math.sin(direction) * separation;
        const candidates = character >= 0.75
          ? foothills.filter(i => masses.every(other =>
            Math.hypot(i % world.width - other.x, Math.floor(i / world.width) - other.y)
              > other.radius * other.aspect + 13))
          : foothills;
        if (!candidates.length) continue;
        const other = character >= 0.75 ? candidates[Math.floor(random() * candidates.length)]
          : candidates.reduce((best, i) => {
            const distance = (cell: number) => (cell % world.width - targetX) ** 2
              + (Math.floor(cell / world.width) - targetY) ** 2;
            return distance(i) < distance(best) ? i : best;
          });
        const orientation = direction + (random() - 0.5);
        masses.push({
          x: other % world.width, y: Math.floor(other / world.width),
          radius: 6 + Math.min(5, Math.max(0, shore[other] - 11)) * random(),
          cosine: Math.cos(orientation), sine: Math.sin(orientation), aspect: 1 + random() * 0.8,
        });
      }
      const noise = new FastNoiseLite((seed ^ Math.imul(attempt + 1, 7919)) & 0x7fffffff);
      noise.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2S);
      noise.SetFrequency(0.055);
      const field = Float32Array.from(levels, (_, i) => {
        const px = i % world.width, py = Math.floor(i / world.width);
        let value = -Infinity;
        for (const mass of masses) {
          const dx = px - mass.x, dy = py - mass.y;
          const along = (dx * mass.cosine + dy * mass.sine) / mass.aspect;
          const across = -dx * mass.sine + dy * mass.cosine;
          value = Math.max(value, mass.radius - Math.hypot(along, across));
        }
        return value + noise.GetNoise(px, py) * 1.3;
      });
      let parent: Uint8Array = grass;
      let interior = shore;
      for (let tier = 1; tier < tiers; tier++) {
        const boundary = (tier - 1) * 8;
        const mask = cleanIslandMask(Uint8Array.from(levels, (_, i) =>
          Number(parent[i] && interior[i] >= 5 && field[i] >= boundary)), tier === 1 ? 100 : 40);
        for (let i = 0; i < levels.length; i++) if (mask[i]) levels[i] = tier;
        parent = mask;
        if (tier < tiers - 1) interior = islandCoastDistance(mask);
      }
      const counts = new Uint32Array(tiers);
      for (let i = 0; i < levels.length; i++) if (world.cells[i]) counts[levels[i]]++;
      if (counts.some(count => count < 40)) continue;
    }
    if (!connectIslandElevations(world, levels, attempt)) continue;
    world.generatorVersion = V2_TERRACE_GENERATOR;
    world.provenance = 'browser-generated';
    return world;
  }
  throw new Error(`V2 terraces could not connect seed ${seed}, composition [${world.elevationHeights.join(', ')}], after ${ATTEMPTS} topology attempts (interior depth ${depth}).`);
}
