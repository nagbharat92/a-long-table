import type { Point, Rectangle } from './contracts';

export const RIG_WIDTH = 18;
export const RIG_HEIGHT = 29;
export const RIG_POSITION_LIMIT = 3;
export const RIG_PART_SHAPE = {
  squash: { x: 2, y: 0.2 },
  stretch: { x: 0.4, y: 2.5 },
  fixedBodyAttachments: ['left-foot', 'right-foot'],
} as const;
export type RigPartId = 'body' | 'head' | 'left-ear' | 'right-ear' | 'left-arm' | 'right-arm' | 'left-foot' | 'right-foot';
export interface JointPad extends Point { radius: number }
export interface RigUnderpainting {
  regions: Rectangle[];
  sample: Point;
}

export interface RigPart {
  id: RigPartId;
  name: string;
  parent: RigPartId | null;
  pivot: Point;
  regions: Rectangle[];
  padding: JointPad[];
  underpainting?: RigUnderpainting[];
  explode: Point;
  limit: number;
}

const rect = (x: number, y: number, width: number, height: number): Rectangle => ({ x, y, width, height });
const pad = (x: number, y: number, radius: number): JointPad => ({ x, y, radius });

// Draw order is independent of the bone hierarchy. Padding is authored, not recovered art.
export const RABBIT_PARTS: readonly RigPart[] = [
  { id: 'body', name: 'Body', parent: null, pivot: { x: 9, y: 23 }, regions: [rect(0, 0, 18, 29)],
    padding: [pad(9, 19, 3)],
    underpainting: [
      { regions: [rect(4, 19, 10, 8)], sample: { x: 7, y: 10 } },
      { regions: [rect(4, 19, 1, 8), rect(13, 19, 1, 8), rect(4, 26, 10, 1)], sample: { x: 0, y: 10 } },
    ], explode: { x: 0, y: 0 }, limit: 6 },
  { id: 'left-foot', name: 'Left foot', parent: 'body', pivot: { x: 6, y: 25 }, regions: [rect(0, 26, 7, 3)],
    padding: [pad(6, 25, 2)], explode: { x: -6, y: 10 }, limit: 12 },
  { id: 'right-foot', name: 'Right foot', parent: 'body', pivot: { x: 12, y: 25 }, regions: [rect(11, 26, 7, 3)],
    padding: [pad(12, 25, 2)], explode: { x: 6, y: 10 }, limit: 12 },
  { id: 'left-arm', name: 'Left arm', parent: 'body', pivot: { x: 5, y: 21 },
    regions: [rect(3, 20, 2, 2), rect(2, 22, 3, 3), rect(3, 25, 2, 1)],
    padding: [pad(5, 21.5, 2.5)], explode: { x: -13, y: 0 }, limit: 18 },
  { id: 'right-arm', name: 'Right arm', parent: 'body', pivot: { x: 12, y: 21 },
    regions: [rect(13, 20, 2, 1), rect(12, 21, 3, 1), rect(12, 22, 4, 3), rect(13, 25, 2, 1)],
    padding: [pad(12, 21.5, 2.5)], explode: { x: 13, y: 0 }, limit: 18 },
  { id: 'left-ear', name: 'Left ear', parent: 'head', pivot: { x: 6, y: 6 }, regions: [rect(4, 0, 4, 6)],
    padding: [pad(6, 6.5, 2)], explode: { x: -7, y: -9 }, limit: 22 },
  { id: 'right-ear', name: 'Right ear', parent: 'head', pivot: { x: 12, y: 6 }, regions: [rect(10, 0, 4, 6)],
    padding: [pad(12, 6.5, 2)], explode: { x: 7, y: -9 }, limit: 22 },
  { id: 'head', name: 'Head', parent: 'body', pivot: { x: 9, y: 18 }, regions: [rect(0, 0, 18, 19)],
    padding: [], explode: { x: 0, y: -10 }, limit: 12 },
];

const PARTITION_ORDER: readonly RigPartId[] = [
  'left-ear', 'right-ear', 'head', 'left-foot', 'right-foot', 'left-arm', 'right-arm', 'body',
];

export interface RigPartPose {
  pivot: Point;
  angle: number;
  offset: Point;
  squashStretch: number;
}

export interface CharacterRigState {
  parts: Record<RigPartId, RigPartPose>;
  selected: RigPartId;
  explode: number;
  stress: number;
  joints: boolean;
  padding: boolean;
}

export interface RigLayer {
  id: RigPartId;
  pixels: Uint8ClampedArray;
  padding: Uint8ClampedArray;
  bounds: Rectangle;
}

export interface RigTransform {
  position: Point;
  angle: number;
  scale: Point;
}

export interface RigAudit {
  restDifferencePixels: number;
  jointCount: number;
  uncoveredJoints: RigPartId[];
}

export function createCharacterRig(): CharacterRigState {
  return {
    parts: Object.fromEntries(RABBIT_PARTS.map(part => [part.id, {
      pivot: { ...part.pivot }, angle: 0, offset: { x: 0, y: 0 }, squashStretch: 0,
    }])) as Record<RigPartId, RigPartPose>,
    selected: 'head', explode: 0, stress: 0, joints: true, padding: false,
  };
}

const contains = (r: Rectangle, x: number, y: number): boolean =>
  x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height;

export function sourceOwner(x: number, y: number): RigPartId {
  for (const id of PARTITION_ORDER) {
    const part = RABBIT_PARTS.find(candidate => candidate.id === id)!;
    if (part.regions.some(region => contains(region, x, y))) return id;
  }
  throw new RangeError('The source pixel is outside the rabbit rig.');
}

export function buildRigLayers(source: Uint8ClampedArray): RigLayer[] {
  if (source.length !== RIG_WIDTH * RIG_HEIGHT * 4) throw new Error('The rig source must be 18 by 29 RGBA pixels.');
  const fill = source.slice((10 * RIG_WIDTH + 7) * 4, (10 * RIG_WIDTH + 7) * 4 + 4);
  if (fill[3] !== 255) throw new Error('The rabbit joint fill sample must be opaque.');
  return RABBIT_PARTS.map((part, layerIndex) => {
    const pixels = new Uint8ClampedArray(source.length);
    const padding = new Uint8ClampedArray(source.length);
    const underpainting = (part.underpainting ?? []).map(paint => {
      const index = (paint.sample.y * RIG_WIDTH + paint.sample.x) * 4;
      const color = source.slice(index, index + 4);
      if (color.length !== 4 || color[3] !== 255) throw new Error(`The ${part.name.toLowerCase()} underpainting sample must be opaque.`);
      return { ...paint, color };
    });
    let left = RIG_WIDTH, top = RIG_HEIGHT, right = 0, bottom = 0;
    for (let y = 0; y < RIG_HEIGHT; y++) {
      for (let x = 0; x < RIG_WIDTH; x++) {
        const index = (y * RIG_WIDTH + x) * 4;
        if (!source[index + 3]) continue;
        const owner = sourceOwner(x, y);
        const ownerIndex = RABBIT_PARTS.findIndex(candidate => candidate.id === owner);
        const matchesFill = fill.every((value, channel) => value === source[index + channel]);
        // Never repaint a foreground source pixel or expand the setup silhouette.
        if (part.padding.some(pad => Math.hypot(x + 0.5 - pad.x, y + 0.5 - pad.y) <= pad.radius)
          && (ownerIndex >= layerIndex || matchesFill)) {
          pixels.set(fill, index);
          padding.set(fill, index);
        }
        // Complete the torso behind limbs; foreground source pixels still win at rest.
        for (const paint of underpainting) {
          if (paint.regions.some(region => contains(region, x, y))) {
            pixels.set(paint.color, index);
            padding.set(fill, index);
          }
        }
        if (owner === part.id) pixels.set(source.subarray(index, index + 4), index);
        if (pixels[index + 3]) {
          left = Math.min(left, x); top = Math.min(top, y);
          right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
        }
      }
    }
    if (right <= left || bottom <= top) throw new Error(`The ${part.name.toLowerCase()} has no source pixels.`);
    return { id: part.id, pixels, padding, bounds: rect(left, top, right - left, bottom - top) };
  });
}

export function validateRigState(state: CharacterRigState): void {
  if (!Number.isFinite(state.explode) || state.explode < 0 || state.explode > 1
    || !Number.isFinite(state.stress) || Math.abs(state.stress) > 1) throw new RangeError('The rig view settings are out of range.');
  if (!RABBIT_PARTS.some(part => part.id === state.selected)) throw new Error('The selected rig part does not exist.');
  for (const part of RABBIT_PARTS) {
    const pose = state.parts[part.id];
    if (!pose || !Number.isFinite(pose.angle) || Math.abs(pose.angle) > part.limit
      || !Number.isFinite(pose.pivot.x) || pose.pivot.x < 0 || pose.pivot.x > RIG_WIDTH
      || !Number.isFinite(pose.pivot.y) || pose.pivot.y < 0 || pose.pivot.y > RIG_HEIGHT) {
      throw new RangeError(`The ${part.name.toLowerCase()} angle or pivot is out of range.`);
    }
    if (!pose.offset || !Number.isFinite(pose.offset.x) || Math.abs(pose.offset.x) > RIG_POSITION_LIMIT
      || !Number.isFinite(pose.offset.y) || Math.abs(pose.offset.y) > RIG_POSITION_LIMIT) {
      throw new RangeError(`The ${part.name.toLowerCase()} position must be within ${RIG_POSITION_LIMIT} source pixels of its setup.`);
    }
    if (!Number.isFinite(pose.squashStretch) || Math.abs(pose.squashStretch) > 1) {
      throw new RangeError(`The ${part.name.toLowerCase()} squash / stretch must be between -100% and 100%.`);
    }
  }
}

function rotate(point: Point, angle: number): Point {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: point.x * c - point.y * s, y: point.x * s + point.y * c };
}

export function localRigAngle(state: CharacterRigState, part: RigPart): number {
  const limit = part.limit;
  const stressSign = part.id.startsWith('right') ? -1 : 1;
  return Math.max(-limit, Math.min(limit, state.parts[part.id].angle + state.stress * limit * stressSign));
}

function partShapeScale(amount: number): Point {
  const end = amount < 0 ? RIG_PART_SHAPE.squash : RIG_PART_SHAPE.stretch;
  const weight = Math.abs(amount);
  return { x: 1 - weight + end.x * weight, y: 1 - weight + end.y * weight };
}

export function transformRig(state: CharacterRigState): Record<RigPartId, RigTransform> {
  validateRigState(state);
  const result = {} as Record<RigPartId, RigTransform>;
  function resolve(part: RigPart): RigTransform {
    if (result[part.id]) return result[part.id];
    const pose = state.parts[part.id];
    const angle = localRigAngle(state, part) * Math.PI / 180;
    const translation = pose.offset;
    if (!part.parent) {
      return result[part.id] = {
        position: { x: pose.pivot.x + translation.x, y: pose.pivot.y + translation.y },
        angle, scale: partShapeScale(pose.squashStretch),
      };
    }
    const parent = RABBIT_PARTS.find(candidate => candidate.id === part.parent)!;
    const parentTransform = resolve(parent);
    const parentPivot = state.parts[parent.id].pivot;
    // Shape attachment locations, not child artwork, manual offsets, or inspection spacing.
    const fixedAttachment = parent.id === 'body' && RIG_PART_SHAPE.fixedBodyAttachments.some(id => id === part.id);
    const attachmentScale = fixedAttachment ? { x: 1, y: 1 } : parentTransform.scale;
    const offset = rotate({
      x: (pose.pivot.x - parentPivot.x) * attachmentScale.x + translation.x + part.explode.x * state.explode,
      y: (pose.pivot.y - parentPivot.y) * attachmentScale.y + translation.y + part.explode.y * state.explode,
    }, parentTransform.angle);
    return result[part.id] = {
      position: { x: parentTransform.position.x + offset.x, y: parentTransform.position.y + offset.y },
      angle: parentTransform.angle + angle,
      scale: partShapeScale(pose.squashStretch),
    };
  }
  RABBIT_PARTS.forEach(resolve);
  return result;
}

export function rigPoint(state: CharacterRigState, transforms: Record<RigPartId, RigTransform>, id: RigPartId, point: Point): Point {
  const pivot = state.parts[id].pivot;
  const transform = transforms[id];
  const offset = rotate({
    x: (point.x - pivot.x) * transform.scale.x,
    y: (point.y - pivot.y) * transform.scale.y,
  }, transform.angle);
  return { x: transforms[id].position.x + offset.x, y: transforms[id].position.y + offset.y };
}

export function rigBounds(state: CharacterRigState, layers: readonly RigLayer[]): Rectangle {
  if (!layers.length) throw new Error('The rig has no layers to frame.');
  const transforms = transformRig(state);
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const layer of layers) {
    const b = layer.bounds;
    for (const x of [b.x - 0.5, b.x + b.width + 0.5]) {
      for (const y of [b.y - 0.5, b.y + b.height + 0.5]) {
        const point = rigPoint(state, transforms, layer.id, { x, y });
        left = Math.min(left, point.x); right = Math.max(right, point.x);
        top = Math.min(top, point.y); bottom = Math.max(bottom, point.y);
      }
    }
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function rigPixelAt(state: CharacterRigState, transform: RigTransform, layer: RigLayer, point: Point): number {
  const local = rotate({ x: point.x - transform.position.x, y: point.y - transform.position.y }, -transform.angle);
  const x = Math.floor(local.x / transform.scale.x + state.parts[layer.id].pivot.x + 1e-9);
  const y = Math.floor(local.y / transform.scale.y + state.parts[layer.id].pivot.y + 1e-9);
  return x < 0 || y < 0 || x >= RIG_WIDTH || y >= RIG_HEIGHT ? -1 : (y * RIG_WIDTH + x) * 4;
}

export function hitRigPart(state: CharacterRigState, layers: readonly RigLayer[], point: Point): RigPartId | null {
  const transforms = transformRig(state);
  for (const layer of [...layers].reverse()) {
    const index = rigPixelAt(state, transforms[layer.id], layer, point);
    if (index >= 0 && layer.pixels[index + 3]) return layer.id;
  }
  return null;
}

export function auditRig(state: CharacterRigState, layers: readonly RigLayer[], source: Uint8ClampedArray): RigAudit {
  let restDifferencePixels = 0;
  for (let index = 0; index < source.length; index += 4) {
    const top = [...layers].reverse().find(layer => layer.pixels[index + 3]);
    if ([0, 1, 2, 3].some(channel => (top?.pixels[index + channel] ?? 0) !== (source[index + 3] ? source[index + channel] : 0))) {
      restDifferencePixels++;
    }
  }
  const assembled = { ...state, explode: 0 };
  const transforms = transformRig(assembled);
  const joints = RABBIT_PARTS.filter(part => part.parent);
  const uncoveredJoints = joints.filter(part => {
    const center = transforms[part.id].position;
    for (const dx of [-0.5, 0, 0.5]) {
      for (const dy of [-0.5, 0, 0.5]) {
        const point = { x: center.x + dx, y: center.y + dy };
        if (!layers.some(layer => {
          const index = rigPixelAt(assembled, transforms[layer.id], layer, point);
          return index >= 0 && layer.pixels[index + 3] > 0;
        })) return true;
      }
    }
    return false;
  }).map(part => part.id);
  return { restDifferencePixels, jointCount: joints.length, uncoveredJoints };
}

export function exportCharacterRig(state: CharacterRigState): string {
  validateRigState(state);
  return JSON.stringify({
    schemaVersion: 5,
    positioning: { space: 'parent', limit: RIG_POSITION_LIMIT },
    partShape: { ...RIG_PART_SHAPE, space: 'part-local', childArtwork: 'independent' },
    source: { file: 'rabbit.png', width: RIG_WIDTH, height: RIG_HEIGHT },
    padding: 'Authored joint fill and torso outlines, sampled from the source palette; not recovered hidden artwork.',
    partitionOrder: PARTITION_ORDER,
    layers: RABBIT_PARTS.map(part => ({ ...part, pivot: state.parts[part.id].pivot })),
    pose: Object.fromEntries(RABBIT_PARTS.map(part => [part.id, {
      pivot: state.parts[part.id].pivot, angle: localRigAngle(state, part),
      offset: state.parts[part.id].offset,
      squashStretch: state.parts[part.id].squashStretch,
      scale: partShapeScale(state.parts[part.id].squashStretch),
    }])),
  }, null, 2);
}
