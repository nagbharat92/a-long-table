import type { Point } from './contracts';
import { islandCoveInfluence, type IslandCove } from './island-cove';

export interface IslandProceduralCoast {
  kind: 'procedural';
  gradeWidth: number;
  shelfWidth: number;
  shelfDepth: number;
  focus: Point;
  /** Accepted coastal sand footprint, including its dry back above the grade. */
  beachCells?: Uint8Array;
  mask: { origin: Point; spacing: number; width: number; height: number; weights: Float32Array };
  regions: readonly {
    kind: 'cove' | 'beach';
    center: Point;
    normal: Point;
    length: number;
    depth: number;
  }[];
}

export type IslandCoastProfile = IslandCove | IslandProceduralCoast;

export function islandCoastInfluence(profile: IslandCoastProfile, x: number, y: number): number {
  if (!('kind' in profile)) return islandCoveInfluence(profile, x, y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError('Coastal queries require finite coordinates.');
  const mask = profile.mask;
  const gx = (x - mask.origin.x) / mask.spacing, gy = (y - mask.origin.y) / mask.spacing;
  if (gx < 0 || gy < 0 || gx >= mask.width - 1 || gy >= mask.height - 1) return 0;
  const ix = Math.floor(gx), iy = Math.floor(gy), tx = gx - ix, ty = gy - iy, i = iy * mask.width + ix;
  return (mask.weights[i] * (1 - tx) + mask.weights[i + 1] * tx) * (1 - ty)
    + (mask.weights[i + mask.width] * (1 - tx) + mask.weights[i + mask.width + 1] * tx) * ty;
}
