import FastNoiseLite from 'fastnoise-lite';
import type { World } from '../core/contracts';
import { SHALLOW_LEVEL } from '../core/world';
import { islandMaterials } from './island-materials';

type Surface = Pick<CanvasRenderingContext2D, 'fillStyle' | 'fillRect'>;
const OCEAN = '#2698ee';
const WATER = ['#48b9cf', '#42b3d2', '#3badd6', '#35a7da', '#2fa2df', '#2b9ee4', '#289be9', OCEAN];
const FOAM = ['', '#6cc7d3', '#92d8db', '#bae9e3', '#d0f0e5', '#e5f5e9'];
const CLIFF = ['#7b6344', '#d0ae7a', '#b28b60', '#4f573a', '#2387c7'];

export interface ShorelineAnimation {
  drawWater(context: Surface, seconds: number): void;
}

function distanceField(materials: Uint8Array, width: number, height: number, target: 0 | 1 | 2): Float32Array {
  const distances = new Float32Array(materials.length);
  for (let i = 0; i < materials.length; i++) {
    const matches = target === 1 ? materials[i] !== 0 : materials[i] === target;
    distances[i] = matches ? 0 : 32;
  }
  // Two chamfer passes keep the water bands aligned to the visual land mask.
  for (const step of [1, -1]) {
    const neighbors = [[step, 0], [0, step], [-1, step], [1, step]];
    for (let y = step === 1 ? 0 : height - 1; y >= 0 && y < height; y += step) {
      for (let x = step === 1 ? 0 : width - 1; x >= 0 && x < width; x += step) {
        const i = y * width + x;
        for (const [dx, dy] of neighbors) {
          const nx = x - dx;
          const ny = y - dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          distances[i] = Math.min(distances[i], distances[ny * width + nx] + (dx && dy ? Math.SQRT2 : 1));
        }
      }
    }
  }
  return distances;
}

export function drawIslandShoreline(
  context: Surface, world: World, materials = islandMaterials(world),
): ShorelineAnimation {
  const tile = world.tileSize;
  const width = world.width * tile;
  const height = world.height * tile;
  const protectedWater = new Uint8Array(width * height);
  for (let i = 0; i < materials.length; i++) {
    if (materials[i] !== 3) continue;
    for (let d = 1; d <= CLIFF.length && i + d * width < materials.length; d++) {
      const next = i + d * width;
      if (materials[next]) break;
      protectedWater[next] = d;
    }
  }
  const landDistance = distanceField(materials, width, height, 1);
  const waterDistance = distanceField(materials, width, height, 0);
  const beachDistance = distanceField(materials, width, height, 2);
  const noise = new FastNoiseLite(world.seed ^ 0x4ab73c);
  noise.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2S);
  noise.SetFrequency(1 / 24);
  type WaterPixel = { x: number; y: number; distance: number; beach: number; offset: number };
  const pixels: WaterPixel[] = [];
  const waterColor = ({ x, y, distance, beach, offset }: WaterPixel, seconds: number): string => {
    const sx = Math.floor(x / 2) * 2;
    const sy = Math.floor(y / 2) * 2;
    const broad = noise.GetNoise(sx + seconds * 0.6, sy - seconds * 0.3);
    const detail = noise.GetNoise(sx * 3 + 71 - seconds * 0.4, sy * 3 - 47 + seconds * 0.2);
    const depth = distance / (12 + broad * 9) + detail * 0.3 + broad * 0.18;
    const color = WATER[Math.max(0, Math.min(7, Math.floor(depth * 7)))];
    const phase = seconds / (5.5 + offset * 0.7) + offset * 0.8;
    const cycle = ((phase % 1) + 1) % 1;
    const crest = 5.5 - cycle * 4.5 + broad * 0.5;
    if (beach < 7 && distance > crest - 0.8 && distance < crest + 0.6 && broad + detail > -0.1) {
      return FOAM[Math.round(5 * Math.sin(Math.PI * cycle) ** 2)] || color;
    }
    return color;
  };
  for (let y = 0; y < height; y++) {
    let previous = '';
    let start = 0;
    for (let x = 0; x <= width; x++) {
      const i = y * width + x;
      let color = '';
      if (x < width && materials[i] === 0 && protectedWater[i]) {
        color = CLIFF[protectedWater[i] - 1];
      } else if (x < width && materials[i] === 0) {
        const distance = landDistance[i];
        const cell = Math.floor(y / tile) * world.width + Math.floor(x / tile);
        if (distance < 20) {
          const pixel = { x, y, distance, beach: beachDistance[i], offset: noise.GetNoise(x, y) };
          pixels.push(pixel);
          color = waterColor(pixel, 0);
        } else if (world.heights[cell] > world.seaLevel + SHALLOW_LEVEL) {
          color = OCEAN;
        }
      } else if (x < width && materials[i] === 2) {
        const wetWidth = 2.6 + noise.GetNoise(x, y) * 0.65;
        const distance = waterDistance[i];
        if (distance <= wetWidth) color = '#bca66c';
        else if (distance <= wetWidth + 1) color = '#d4bb79';
        else if (distance <= tile) color = '#e7cf85';
      } else if (x < width && materials[i] === 3 && waterDistance[i] <= tile) {
        color = '#85cc49';
        if (!materials[i - width] || !materials[i + width]) color = '#577337';
        else if (!materials[i - 1]) color = '#6d913f';
        else if (!materials[i + 1]) color = '#52723b';
        else if (!materials[i - 2 * width] || !materials[i + 2 * width]) color = '#b2e279';
      }
      if (color === previous) continue;
      if (previous) {
        context.fillStyle = previous;
        context.fillRect(start, y, x - start, 1);
      }
      previous = color;
      start = x;
    }
  }
  return {
    drawWater(surface, seconds) {
      for (const pixel of pixels) {
        surface.fillStyle = waterColor(pixel, seconds);
        surface.fillRect(pixel.x, pixel.y, 1, 1);
      }
    },
  };
}
