import { TREE_BASELINE, TREE_SIZE, treePixelLayers, type TreeAppearance } from './tree-assets';

export const TREE_MOTION_MODES = ['Foliage only', 'Whole tree', 'Combined'] as const;
export const TREE_WIND_PRESETS = ['Still', 'Breeze', 'Gusts'] as const;

export interface TreeWind {
  mode: number;
  preset: number;
  strength: number;
  speed: number;
  direction: number;
}

export const DEFAULT_TREE_WIND: Readonly<TreeWind> = { mode: 2, preset: 1, strength: 3, speed: 1, direction: 1 };

export function validateTreeMotion(seconds: number, wind: TreeWind): void {
  if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Tree wind time must be finite and non-negative.');
  for (const [value, count] of [[wind.mode, TREE_MOTION_MODES.length], [wind.preset, TREE_WIND_PRESETS.length]]) {
    if (!Number.isInteger(value) || value < 0 || value >= count) throw new RangeError('Invalid tree wind choice.');
  }
  if (!Number.isFinite(wind.strength) || wind.strength < 0 || wind.strength > 6
    || !Number.isFinite(wind.speed) || wind.speed < 0.2 || wind.speed > 2
    || (wind.direction !== -1 && wind.direction !== 1)) throw new RangeError('Invalid tree wind parameter.');
}

export function prepareTreeMotion(appearance: TreeAppearance): (seconds: number, wind: TreeWind) => number[][] {
  const layers = treePixelLayers(appearance).map(layer => {
    const points = layer.pixels.flatMap((row, y) => row.flatMap((tone, x) => tone ? [{ x, y }] : []));
    return {
      ...layer,
      left: Math.min(...points.map(point => point.x)),
      right: Math.max(...points.map(point => point.x)) + 1,
      top: Math.min(...points.map(point => point.y)),
      bottom: Math.max(...points.map(point => point.y)) + 1,
    };
  });
  const phase = (appearance.seed % 997) / 997 * Math.PI * 2;
  const rootX = TREE_SIZE.width / 2;
  const rootY = TREE_BASELINE - 5;
  return (seconds, wind) => {
    validateTreeMotion(seconds, wind);
    const pixels = Array.from({ length: TREE_SIZE.height }, () => Array<number>(TREE_SIZE.width).fill(0));
    const time = seconds * wind.speed;
    const strength = wind.preset === 0 ? 0 : wind.strength * wind.direction;
    const sway = wind.mode === 0 ? 0 : treeSwayAngle(seconds, appearance.seed, wind);
    const cos = Math.cos(sway);
    const sin = Math.sin(sway);
    layers.forEach((layer, index) => {
      const leafAngle = wind.mode === 1 || index === 0 ? 0 : strength * 0.01
        * springResponse(time, wind.preset === 2 ? 0.73 : 0.48, phase + index * 0.6, 2.1, 0.65);
      const localCos = Math.cos(sway + leafAngle);
      const localSin = Math.sin(sway + leafAngle);
      const anchorX = rootX + (layer.anchorX - rootX) * cos - (layer.anchorY - rootY) * sin;
      const anchorY = rootY + (layer.anchorX - rootX) * sin + (layer.anchorY - rootY) * cos;
      // Arc length bounds displacement for both rotations, including vertical movement.
      const padding = Math.ceil((TREE_SIZE.width + TREE_SIZE.height) * (Math.abs(sway) + Math.abs(leafAngle)));
      const left = Math.max(0, layer.left - padding);
      const right = Math.min(TREE_SIZE.width, layer.right + padding);
      const top = Math.max(0, layer.top - padding);
      const bottom = Math.min(TREE_SIZE.height, layer.bottom + padding);
      // Inverse sampling keeps rigidly rotated pixel masses solid, without row shear or splat holes.
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
        let sx = x + 0.5;
        let sy = y + 0.5;
        if (index !== 0 || y < rootY) {
          const dx = sx - anchorX;
          const dy = sy - anchorY;
          sx = layer.anchorX + dx * localCos + dy * localSin;
          sy = layer.anchorY - dx * localSin + dy * localCos;
        }
        const tone = layer.pixels[Math.floor(sy)]?.[Math.floor(sx)];
        if (tone) pixels[y][x] = tone;
      }
    });
    return pixels;
  };
}

// Exact rest-start response of x'' + 2*zeta*omega*x' + omega^2*x = omega^2*cos(f*t + phase).
function springResponse(time: number, frequency: number, phase: number, omega: number, damping: number): number {
  const stiffness = omega * omega;
  const real = stiffness - frequency * frequency;
  const imaginary = 2 * damping * omega * frequency;
  const denominator = real * real + imaginary * imaginary;
  const a = stiffness * real / denominator;
  const b = stiffness * imaginary / denominator;
  const initial = a * Math.cos(phase) + b * Math.sin(phase);
  const velocity = frequency * (-a * Math.sin(phase) + b * Math.cos(phase));
  const decay = damping * omega;
  const damped = omega * Math.sqrt(1 - damping * damping);
  return a * Math.cos(frequency * time + phase) + b * Math.sin(frequency * time + phase)
    - Math.exp(-decay * time) * (initial * Math.cos(damped * time)
      + (velocity + decay * initial) / damped * Math.sin(damped * time));
}

export function treeSwayAngle(seconds: number, seed: number, wind: TreeWind): number {
  validateTreeMotion(seconds, wind);
  if (wind.preset === 0 || wind.strength === 0) return 0;
  const time = seconds * wind.speed;
  const phase = (seed % 997) / 997 * Math.PI * 2;
  const response = 0.45 * springResponse(time, 0, 0, 1.25, 0.55)
    + 0.4 * springResponse(time, 0.38, phase, 1.25, 0.55)
    + (wind.preset === 2 ? 0.4 * springResponse(time, 0.73, phase * 1.7, 1.25, 0.55) : 0);
  return wind.strength / 160 * response * wind.direction;
}
