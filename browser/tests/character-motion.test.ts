import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import type { CharacterState } from '../src/core/contracts';
import {
  buildRigLayers, createCharacterRig, RABBIT_PARTS, rigPoint, transformRig, validateRigState,
  type RigLayer, type RigPartId,
} from '../src/core/character-rig';
import {
  HOP_CONTACT_PHASE, HOP_DISTANCE, HOP_TAKEOFF_PHASE, IDLE_BOB_SECONDS, RABBIT_MOTION_FRAME, motionSourceBounds,
  sampleRabbitMotion, type RabbitMotionPose,
} from '../src/core/character-motion';
import { advanceCharacterAnimation } from '../src/core/game';

function character(overrides: Partial<CharacterState> = {}): CharacterState {
  return {
    position: { x: 20, y: 30 }, direction: { x: 0, y: 0 }, route: [], routeIndex: 0,
    selected: false, gaitDistance: 0, animationTime: 0, motionWeight: 0, facing: 0,
    hop: { phase: 0, speed: 0, active: false },
    ...overrides,
  };
}

function at(phase: number, overrides: Partial<CharacterState> = {}): RabbitMotionPose {
  return sampleRabbitMotion(character({
    gaitDistance: phase * HOP_DISTANCE, motionWeight: 1, facing: 1,
    hop: { phase: (phase % 1 + 1) % 1, speed: 22, active: true }, ...overrides,
  }));
}

function numericValues(value: unknown): number[] {
  if (typeof value === 'number') return [value];
  if (typeof value !== 'object' || value === null) return [];
  return Object.values(value).flatMap(numericValues);
}

function expectNumbersClose(actual: unknown, expected: unknown, digits = 9): void {
  const values = numericValues(actual), other = numericValues(expected);
  expect(values.length).toBe(other.length);
  values.forEach((value, index) => expect(value).toBeCloseTo(other[index], digits));
}

function approvedRabbitSource(): Uint8ClampedArray {
  const png = readFileSync(new URL('../public/assets/rabbit.png', import.meta.url));
  expect([...png.subarray(16, 29)]).toEqual([0, 0, 0, 18, 0, 0, 0, 29, 8, 6, 0, 0, 0]);
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const encoded = inflateSync(Buffer.concat(chunks));
  const pixels = new Uint8ClampedArray(18 * 29 * 4), stride = 18 * 4;
  for (let y = 0; y < 29; y++) {
    const filter = encoded[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x;
      const a = x >= 4 ? pixels[index - 4] : 0, b = y ? pixels[index - stride] : 0;
      const c = x >= 4 && y ? pixels[index - stride - 4] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = [0, a, b, Math.floor((a + b) / 2), pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      if (predictor === undefined) throw new Error('Unsupported PNG row filter.');
      pixels[index] = (encoded[y * (stride + 1) + x + 1] + predictor) % 256;
    }
  }
  return pixels;
}

function silhouetteAudit(pose: RabbitMotionPose, layers: RigLayer[]): {
  components: number[];
  joins: Record<string, number>;
  inkJoins: Record<string, number>;
} {
  const bounds = motionSourceBounds(pose), transforms = transformRig(pose.rig);
  const left = Math.floor(bounds.x * 4) - 1, top = Math.floor(bounds.y * 4) - 1;
  const width = Math.ceil((bounds.x + bounds.width) * 4) - left + 1;
  const height = Math.ceil((bounds.y + bounds.height) * 4) - top + 1;
  const ink = new Uint8Array(width * height);
  const masks: Record<string, Uint8Array> = {};
  const outlines: Record<string, Uint8Array> = {};
  for (const layer of layers) {
    const mask = masks[layer.id] = new Uint8Array(ink.length);
    const outline = outlines[layer.id] = new Uint8Array(ink.length);
    const transform = transforms[layer.id], pivot = pose.rig.parts[layer.id].pivot;
    const cosine = Math.cos(transform.angle), sine = Math.sin(transform.angle);
    for (let y = 0; y < height; y++) {
      const dy = (top + y + 0.5) / 4 - transform.position.y;
      for (let x = 0; x < width; x++) {
        const dx = (left + x + 0.5) / 4 - transform.position.x;
        const sx = Math.floor((dx * cosine + dy * sine) / transform.scale.x + pivot.x + 1e-9);
        const sy = Math.floor((-dx * sine + dy * cosine) / transform.scale.y + pivot.y + 1e-9);
        if (sx >= 0 && sx < 18 && sy >= 0 && sy < 29 && layer.pixels[(sy * 18 + sx) * 4 + 3]) {
          ink[y * width + x] = 1; mask[y * width + x] = 1;
          if (layer.pixels[(sy * 18 + sx) * 4] < 60) outline[y * width + x] = 1;
        }
      }
    }
  }
  const joins: Record<string, number> = {}, inkJoins: Record<string, number> = {};
  for (const part of RABBIT_PARTS) {
    if (!part.parent) continue;
    joins[part.id] = masks[part.id].reduce((count, value, index) => count + (value && masks[part.parent!][index] ? 1 : 0), 0);
    inkJoins[part.id] = outlines[part.id].reduce((count, value, index) => count + (value && masks[part.parent!][index] ? 1 : 0), 0);
  }
  const sizes: number[] = [], queue = new Int32Array(ink.length);
  for (let index = 0; index < ink.length; index++) {
    if (!ink[index]) continue;
    let count = 1, cursor = 0;
    queue[0] = index; ink[index] = 0;
    while (cursor < count) {
      const current = queue[cursor++], x = current % width, y = Math.floor(current / width);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy, neighbor = ny * width + nx;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height && ink[neighbor]) {
            ink[neighbor] = 0; queue[count++] = neighbor;
          }
        }
      }
    }
    sizes.push(count);
  }
  return { components: sizes.sort((a, b) => b - a), joins, inkJoins };
}

describe('expressive elapsed-time rabbit motion', () => {
  it('retains the follow-through head articulation and shaping without changing Creation limits', () => {
    const pose = at(0.28);
    expect(pose.rig.parts.head.angle).toBeCloseTo(6.8);
    expect(pose.rig.parts.head.squashStretch).toBeCloseTo(0.055);
    expect(at(0.71).rig.parts.head.squashStretch).toBeCloseTo(-0.055);
    expect(pose).not.toHaveProperty('style');
    const creation = createCharacterRig();
    creation.parts['left-ear'].angle = 23;
    expect(() => validateRigState(creation)).toThrow(RangeError);
    expect(RABBIT_PARTS.find(part => part.id === 'left-arm')!.limit).toBe(18);
  });

  it('carries nonzero continuous head-path tangents through its curved pose keys', () => {
    const epsilon = 1e-6;
    for (const phase of [0.14, 0.28, 0.44, 0.58, 0.71, 0.84]) {
      const before = at(phase - epsilon).rig.parts.head.offset;
      const point = at(phase).rig.parts.head.offset;
      const after = at(phase + epsilon).rig.parts.head.offset;
      const left = { x: (point.x - before.x) / epsilon, y: (point.y - before.y) / epsilon };
      const right = { x: (after.x - point.x) / epsilon, y: (after.y - point.y) / epsilon };
      expect(Math.hypot(left.x, left.y)).toBeGreaterThan(0.05);
      expect(left.x).toBeCloseTo(right.x, 3);
      expect(left.y).toBeCloseTo(right.y, 3);
    }
  });

  it('remains valid, closes smoothly, keeps pairs coherent and holds floor contacts', () => {
    expectNumbersClose(at(1 - 1e-6).rig, at(0).rig, 6);
    expectNumbersClose(at(1e-6).rig, at(0).rig, 6);
    expectNumbersClose(at(0.33, { motionWeight: 0 }).rig, at(0).rig, 10);
    for (const facing of [-1, 0, 1]) {
      for (const motionWeight of [0.25, 0.5, 1]) {
        for (let index = 0; index < 200; index++) {
          const pose = at(index / 200, { facing, motionWeight });
          const transforms = transformRig(pose.rig);
          expect(numericValues(pose).every(Number.isFinite)).toBe(true);
          expect(transforms['left-ear'].angle * transforms['right-ear'].angle).toBeGreaterThanOrEqual(-1e-10);
          expect(Math.abs(transforms['left-ear'].angle - transforms['right-ear'].angle) * 180 / Math.PI).toBeLessThan(0.75);
          expect(transforms['left-arm'].angle).toBeCloseTo(transforms['right-arm'].angle, 10);
          for (const [id, x] of [['left-foot', 5], ['right-foot', 13]] as const) {
            const sole = rigPoint(pose.rig, transforms, id, { x, y: 29 });
            expect(sole.y - pose.hop * 29 / 12).toBeLessThanOrEqual(29 + 1e-9);
            if (pose.hop === 0) {
              expect(sole.x).toBeCloseTo(x, 10);
              expect(sole.y).toBeCloseTo(29, 10);
              expect(transforms[id].angle).toBeCloseTo(0, 10);
            }
          }
        }
      }
    }
  });

  it('fits the stable motion frame including lift at varied cadences', () => {
    const frame = RABBIT_MOTION_FRAME;
    for (const facing of [-1, -0.5, 0, 0.5, 1]) {
      for (const motionWeight of [0, 0.25, 0.5, 0.75, 1]) {
        for (const speed of [0, 9.9, 22, 44]) {
          for (let index = 0; index < 100; index++) {
            const phase = index / 100;
            const pose = at(phase, { facing, motionWeight, hop: { phase, speed, active: true } });
            const bounds = motionSourceBounds(pose), lift = pose.hop * 29 / 12;
            expect(bounds.x).toBeGreaterThan(frame.x);
            expect(bounds.x + bounds.width).toBeLessThan(frame.x + frame.width);
            expect(bounds.y - lift).toBeGreaterThan(frame.y);
            expect(bounds.y + bounds.height - lift).toBeLessThan(frame.y + frame.height);
          }
        }
      }
    }
  }, 30_000);

  it('starts exactly neutral without changing the approved Creation defaults', () => {
    const creation = createCharacterRig();
    const pose = sampleRabbitMotion(character());
    expect(pose.summary).toEqual({ hop: 0, scaleX: 1, scaleY: 1, rotation: 0, blink: false });
    expect(pose.phase).toBe(0);
    expect(pose.beat).toBe('rest');
    expect(pose.face).toEqual({
      eyeScale: { x: 1, y: 1 }, eyeOffset: { x: 0, y: 0 },
      noseScale: { x: 1, y: 1 }, noseOffset: { x: 0, y: 0 }, blink: false,
    });
    expect(pose.rig).toMatchObject({ joints: false, padding: false, explode: 0, stress: 0 });
    expect(pose.rig.parts.body.pivot).toEqual({ x: 9, y: 29 });
    const transforms = transformRig(pose.rig);
    for (const part of RABBIT_PARTS) {
      expect(rigPoint(pose.rig, transforms, part.id, { x: 7, y: 14 })).toEqual({ x: 7, y: 14 });
      expect(pose.rig.parts[part.id].angle).toBe(0);
      expect(pose.rig.parts[part.id].squashStretch).toBe(0);
    }
    expect(createCharacterRig()).toEqual(creation);
    expect(creation.joints).toBe(true);
    expect(creation.parts.body.pivot).toEqual({ x: 9, y: 23 });
  });

  it('bobs through translation with a stable head, planted soles and a connected silhouette', () => {
    const state = character(), initial = structuredClone(state);
    const layers = buildRigLayers(approvedRabbitSource());
    const tops: number[] = [], headCenters: number[] = [], headScales: number[] = [], bodyScales: number[] = [];
    const bodyOffsets: number[] = [];
    expect(IDLE_BOB_SECONDS).toBe(0.8);
    for (let index = 0; index <= 120; index++) {
      state.animationTime = IDLE_BOB_SECONDS + index / 120 * IDLE_BOB_SECONDS;
      const pose = sampleRabbitMotion(state), transforms = transformRig(pose.rig);
      tops.push(rigPoint(pose.rig, transforms, 'left-ear', { x: 6, y: 0 }).y);
      headCenters.push(transforms.head.position.y);
      headScales.push(transforms.head.scale.y);
      bodyScales.push(transforms.body.scale.y);
      bodyOffsets.push(pose.rig.parts.body.offset.y);
      expect(transforms.head.scale).toEqual({ x: 1, y: 1 });
      expect(transforms['left-ear'].scale).toEqual({ x: 1, y: 1 });
      expect(transforms['right-ear'].scale).toEqual({ x: 1, y: 1 });
      expect(pose.hop).toBe(0);
      expect(() => validateRigState(pose.rig)).not.toThrow();
      expect(numericValues(pose).every(Number.isFinite)).toBe(true);
      for (const [id, x] of [['left-foot', 5], ['right-foot', 13]] as const) {
        expectNumbersClose(rigPoint(pose.rig, transforms, id, { x, y: 29 }), { x, y: 29 });
        expect(transforms[id].angle).toBeCloseTo(0, 10);
      }
      expect(transforms['left-ear'].angle).toBeCloseTo(transforms['right-ear'].angle, 10);
      const audit = silhouetteAudit(pose, layers);
      expect(audit.components).toHaveLength(1);
      expect(Object.values(audit.joins).every(count => count >= 64)).toBe(true);
      expect(['left-foot', 'right-foot', 'left-arm', 'right-arm'].every(id => audit.inkJoins[id] > 0)).toBe(true);
      const bounds = motionSourceBounds(pose);
      expect(bounds.y).toBeGreaterThan(RABBIT_MOTION_FRAME.y);
      expect(bounds.y + bounds.height).toBeLessThan(RABBIT_MOTION_FRAME.y + RABBIT_MOTION_FRAME.height);
    }
    expect(Math.max(...tops) - Math.min(...tops)).toBeGreaterThan(2.3);
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(3);
    expect(Math.max(...headCenters)).toBeGreaterThan(20);
    expect(Math.min(...headCenters)).toBeCloseTo(18, 1);
    expect(new Set(headScales)).toEqual(new Set([1]));
    expect(Math.max(...bodyOffsets) - Math.min(...bodyOffsets)).toBeCloseTo(1.95);
    expect(Math.max(...bodyScales)).toBe(1);
    expect(Math.min(...bodyScales)).toBeGreaterThan(0.99);
    state.animationTime = initial.animationTime;
    expect(state).toEqual(initial);
  });

  it('lets the body reverse before the head, with delayed shape-stable head and ear wobble', () => {
    const poses = Array.from({ length: 801 }, (_, index) => {
      const pose = sampleRabbitMotion(character({ animationTime: IDLE_BOB_SECONDS + index / 1000 }));
      return { rig: pose.rig, transforms: transformRig(pose.rig) };
    });
    const peak = (values: number[], direction: 1 | -1) =>
      values.indexOf(direction === 1 ? Math.max(...values) : Math.min(...values)) / 1000;
    const bodies = poses.map(pose => pose.rig.parts.body.offset.y);
    const heads = poses.map(pose => pose.transforms.head.position.y);
    const angles = poses.map(pose => pose.rig.parts.head.angle);
    const earAngles = poses.map(pose => pose.transforms['left-ear'].angle);
    for (const direction of [1, -1] as const) {
      const lag = (peak(heads, direction) - peak(bodies, direction) + IDLE_BOB_SECONDS) % IDLE_BOB_SECONDS;
      expect(lag).toBeGreaterThan(0.09);
      expect(lag).toBeLessThan(0.13);
      const earLag = (peak(earAngles, direction) - peak(angles, direction) + IDLE_BOB_SECONDS) % IDLE_BOB_SECONDS;
      expect(earLag).toBeCloseTo(0.05, 2);
    }
    for (const bodyTurn of [0.44, 0.8]) {
      const before = poses[Math.round((bodyTurn - 0.02) * 1000)];
      const turn = poses[Math.round(bodyTurn * 1000)];
      const after = poses[Math.round(((bodyTurn === 0.8 ? 0 : bodyTurn) + 0.02) * 1000)];
      if (bodyTurn === 0.44) {
        expect(after.rig.parts.body.offset.y).toBeLessThan(turn.rig.parts.body.offset.y);
        expect(after.transforms.head.position.y).toBeGreaterThan(before.transforms.head.position.y);
      } else {
        expect(after.rig.parts.body.offset.y).toBeGreaterThan(turn.rig.parts.body.offset.y);
        expect(after.transforms.head.position.y).toBeLessThan(before.transforms.head.position.y);
      }
    }
    expect(Math.max(...angles)).toBeGreaterThan(2);
    expect(Math.min(...angles)).toBeLessThan(-2);
    expect(poses.every(pose => pose.transforms.head.scale.x === 1 && pose.transforms.head.scale.y === 1)).toBe(true);
  });

  it('loops the idle smoothly, preserves the neutral start and blends continuously into locomotion', () => {
    const rest = (time: number, motionWeight = 0) => sampleRabbitMotion(character({ animationTime: time, motionWeight }));
    expectNumbersClose(rest(0).rig, sampleRabbitMotion(character()).rig);
    const epsilon = 1e-6;
    for (const phase of [0, 0.0625, 0.1375, 0.2, 0.55, 0.6125, 0.6875, 0.75, 1]) {
      const time = IDLE_BOB_SECONDS * (1 + phase);
      expectNumbersClose(rest(time).rig, rest(time + IDLE_BOB_SECONDS).rig);
      const before = numericValues(rest(time - epsilon).rig), middle = numericValues(rest(time).rig);
      const after = numericValues(rest(time + epsilon).rig);
      before.forEach((value, index) => {
        expect((middle[index] - value) / epsilon).toBeCloseTo((after[index] - middle[index]) / epsilon, 3);
      });
    }
    for (const time of [0, 0.05, 0.11, 0.16]) {
      const before = numericValues(rest(Math.max(0, time - epsilon)).rig), middle = numericValues(rest(time).rig);
      const after = numericValues(rest(time + epsilon).rig);
      before.forEach((value, index) => {
        expect((middle[index] - value) / epsilon).toBeCloseTo((after[index] - middle[index]) / epsilon, 3);
      });
    }
    for (const weight of [0, 0.1, 0.5, 0.9, 1 - 1e-7]) {
      expectNumbersClose(rest(3.35, weight).rig, rest(3.35, weight + 1e-7).rig, 5);
    }
    expectNumbersClose(rest(3.35, 1).rig, rest(0, 1).rig);
  });

  it('keeps the silhouette connected while the idle bob blends into the hop', () => {
    const layers = buildRigLayers(approvedRabbitSource());
    const detached: unknown[] = [];
    for (const facing of [-1, 0, 1]) {
      for (const motionWeight of [0.1, 0.25, 0.5, 0.75, 0.9]) {
        for (let index = 0; index < 60; index++) {
          const phase = index / 60;
          for (const idlePhase of [phase, 0, 0.575, 0.8]) {
            const pose = at(phase, { facing, motionWeight, animationTime: (idlePhase + 1) * IDLE_BOB_SECONDS });
            const audit = silhouetteAudit(pose, layers);
            if (audit.components.length !== 1 || Object.values(audit.joins).some(count => count < 64)
              || ['left-foot', 'right-foot', 'left-arm', 'right-arm'].some(id => audit.inkJoins[id] < 1)) {
              detached.push({ phase, idlePhase, facing, motionWeight, ...audit });
            }
          }
        }
      }
    }
    expect(detached.slice(0, 12), `${detached.length} disconnected blend poses`).toEqual([]);
  }, 15_000);

  it('keeps idle and stop-to-idle timing equivalent at 15 through 144 Hz and irregular intervals', () => {
    const run = (steps: number[], movingSeconds: number, restingSeconds: number) => {
      const state = character();
      let index = 0;
      for (const [duration, speed] of [[movingSeconds, 22], [restingSeconds, 0]]) {
        let elapsed = 0;
        while (elapsed < duration - 1e-12) {
          const delta = Math.min(steps[index++ % steps.length], duration - elapsed);
          advanceCharacterAnimation(state, delta, delta * speed, { x: 1, y: 0 }, speed > 0);
          elapsed += delta;
        }
      }
      return { state, pose: sampleRabbitMotion(state) };
    };
    for (const moving of [0, 0.38, 0.72]) {
      for (const resting of [0.2, 0.9, 3.35]) {
        const reference = run([1 / 60], moving, resting);
        for (const steps of [[1 / 15], [1 / 30], [1 / 120], [1 / 144], [0.013, 0.028, 0.007, 0.049]]) {
          const result = run(steps, moving, resting);
          expectNumbersClose(result, reference, 7);
          expect(result.state.position).toEqual({ x: 20, y: 30 });
        }
      }
    }
  });

  it('stages grounded windup/contact around a single nonnegative 2.4-world-unit apex', () => {
    expect(HOP_DISTANCE).toBe(14);
    for (let index = 0; index < 1000; index++) {
      const phase = index / 1000;
      const pose = at(phase);
      expect(pose.hop).toBeGreaterThanOrEqual(0);
      expect(pose.hop).toBeLessThanOrEqual(2.4);
      expect(pose.summary.hop).toBe(pose.hop);
      if (phase <= HOP_TAKEOFF_PHASE || phase >= HOP_CONTACT_PHASE) expect(pose.hop).toBe(0);
    }
    expect(at(0.42).hop).toBeCloseTo(2.4, 12);
    expect(at(0.1).rig.parts.body.squashStretch).toBeCloseTo(-0.19);
    expect(at(0.22).rig.parts.body.squashStretch).toBeCloseTo(0.11);
    expect(at(0.65).rig.parts.body.squashStretch).toBeCloseTo(-0.21);
    expect([0.1, 0.22, 0.42, 0.55, 0.65, 0.8, 0.95].map(phase => at(phase).beat))
      .toEqual(['windup', 'push', 'float', 'reach', 'contact', 'rebound', 'settle']);
  });

  it('softens fast shape impulses continuously while retaining Shallows and the flight path', () => {
    const pose = (phase: number, speed: number) => at(phase, { hop: { phase, speed, active: true } });
    for (let index = 0; index < 100; index++) {
      const phase = index / 100, shallow = pose(phase, 9.9), fast = pose(phase, 22);
      expect(fast.hop).toBe(shallow.hop);
      expect(fast.face).toEqual(shallow.face);
      for (const id of ['body', 'head'] as const) {
        expect(fast.rig.parts[id].angle).toBe(shallow.rig.parts[id].angle);
        expectNumbersClose(fast.rig.parts[id].offset, shallow.rig.parts[id].offset);
        expect(fast.rig.parts[id].squashStretch)
          .toBeCloseTo(shallow.rig.parts[id].squashStretch * (id === 'body' ? 0.5 : 1), 12);
        for (const speed of [0, 4, 9.9]) {
          expect(pose(phase, speed).rig.parts[id].squashStretch).toBe(shallow.rig.parts[id].squashStretch);
        }
      }
    }
    expect(pose(0.1, 9.9).rig.parts.body.squashStretch).toBeCloseTo(-0.38);
    expect(pose(0.22, 9.9).rig.parts.body.squashStretch).toBeCloseTo(0.22);
    expect(pose(0.65, 9.9).rig.parts.body.squashStretch).toBeCloseTo(-0.42);
    expect(pose(0.28, 9.9).rig.parts.head.squashStretch).toBeCloseTo(0.055);
    for (const speed of [9.9, 12, 16, 20, 22]) {
      expectNumbersClose(pose(0.22, speed), pose(0.22, speed + 1e-7), 5);
    }
  });

  it('bounds full-speed pose displacement and acceleration between 60 Hz frames', () => {
    for (const facing of [-1, 0, 1]) {
      for (let offset = 0; offset < 20; offset++) {
        const samples = Array.from({ length: 42 }, (_, frame) => {
          const pose = at((offset / 20 + frame / 60 * 22 / HOP_DISTANCE) % 1, { facing });
          const transforms = transformRig(pose.rig);
          return {
            height: transforms.body.scale.y,
            points: ([
              ['left-ear', { x: 6, y: 0 }], ['head', { x: 9, y: 14 }], ['body', { x: 9, y: 20 }],
            ] as const).map(([id, point]) => {
              const world = rigPoint(pose.rig, transforms, id, point);
              return { x: world.x, y: world.y - pose.hop * 29 / 12 };
            }),
          };
        });
        for (let index = 1; index < samples.length; index++) {
          const before = samples[index - 1], current = samples[index];
          expect(Math.abs(current.height - before.height)).toBeLessThan(0.125);
          current.points.forEach((point, part) => {
            const previous = before.points[part];
            expect(Math.hypot(point.x - previous.x, point.y - previous.y)).toBeLessThan(3);
            if (index < 2) return;
            const earlier = samples[index - 2].points[part];
            expect(Math.hypot(point.x - 2 * previous.x + earlier.x, point.y - 2 * previous.y + earlier.y))
              .toBeLessThan(1.6);
          });
        }
      }
    }
  });

  it('closes every numeric track smoothly across the gait seam', () => {
    const epsilon = 1e-6;
    const before = at(1 - epsilon), seam = at(1), after = at(1 + epsilon);
    expect(seam.phase).toBe(0);
    expectNumbersClose(before.rig, seam.rig, 7);
    expectNumbersClose(after.rig, seam.rig, 7);
    expectNumbersClose(before.face, seam.face, 7);
    expectNumbersClose(after.face, seam.face, 7);
    expectNumbersClose(before.summary, after.summary, 7);
    const left = numericValues(before.rig), middle = numericValues(seam.rig), right = numericValues(after.rig);
    left.forEach((value, index) => {
      expect(Math.abs((middle[index] - value) / epsilon)).toBeLessThan(0.3);
      expect(Math.abs((right[index] - middle[index]) / epsilon)).toBeLessThan(0.3);
    });
    expectNumbersClose(at(0.37), at(12.37), 10);
  });

  it('preserves a long, low-velocity world-space recovery without late counter-snaps', () => {
    expect((1 - HOP_CONTACT_PHASE) * HOP_DISTANCE / 22).toBeGreaterThan(0.24);
    for (const part of RABBIT_PARTS) {
      const worldAngle = (phase: number) => transformRig(at(phase).rig)[part.id].angle * 180 / Math.PI;
      const bound = Math.abs(worldAngle(0.82)) + (part.id.endsWith('arm') ? 0.3 : 0.05);
      for (let index = 821; index < 1000; index++) {
        const phase = index / 1000;
        const angle = worldAngle(phase);
        const velocity = (worldAngle(phase + 1e-5) - angle) / 1e-5 * 22 / HOP_DISTANCE;
        expect(Math.abs(angle)).toBeLessThanOrEqual(bound);
        expect(Math.abs(velocity)).toBeLessThan(180);
      }
      expect(at(1).rig.parts[part.id].angle).toBe(0);
      expect(at(1).rig.parts[part.id].squashStretch).toBe(0);
    }
  });

  it('retains primary impulses while appendages follow their parents instead of mirrored wave tracks', () => {
    const samples = Array.from({ length: 1001 }, (_, index) => at(index / 1000));
    const peak = (id: RigPartId, start: number, end: number): number => {
      let best = start;
      for (let index = Math.round(start * 1000); index <= Math.round(end * 1000); index++) {
        if (transformRig(samples[index].rig)[id].angle > transformRig(samples[Math.round(best * 1000)].rig)[id].angle) best = index / 1000;
      }
      return best;
    };
    for (const part of RABBIT_PARTS) {
      const poses = samples.map(pose => pose.rig.parts[part.id]);
      const angles = poses.map(pose => pose.angle);
      expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(6);
      expect(new Set(poses.map(pose => pose.squashStretch)).size).toBeGreaterThan(100);
      expect(Math.max(...poses.map(pose => Math.hypot(pose.offset.x, pose.offset.y)))).toBeLessThan(1.5);
    }
    expect(peak('body', 0.18, 0.4)).toBeCloseTo(0.22, 3);
    const headPeak = peak('head', 0.18, 0.4), earPeak = peak('left-ear', 0.2, 0.45);
    expect(earPeak).toBeGreaterThan(headPeak);
    expect(earPeak - headPeak).toBeLessThan(0.15);
    expect(peak('left-ear', 0.65, 0.94)).toBeGreaterThan(peak('head', 0.65, 0.94));
    expect(at(0.28).rig.parts.head.angle).toBeCloseTo(6.8);
    expect(at(0.71).rig.parts.head.angle).toBeCloseTo(6.5);
  });

  it('keeps rigs and face scales valid across phases, facings, and fade weights', () => {
    for (const facing of [-1, -0.4, 0, 0.4, 1]) {
      for (const motionWeight of [0, 0.05, 0.35, 0.7, 1]) {
        for (let index = 0; index <= 100; index++) {
          const pose = at(index / 100, { facing, motionWeight });
          expect(() => validateRigState(pose.rig)).not.toThrow();
          expect(numericValues(pose).every(Number.isFinite)).toBe(true);
          const transforms = transformRig(pose.rig);
          expect(pose.summary.scaleX).toBe(transforms.body.scale.x);
          expect(pose.summary.scaleY).toBe(transforms.body.scale.y);
          expect(pose.summary.rotation).toBe(transforms.body.angle);
          for (const transform of Object.values(transforms)) {
            expect(transform.scale.x).toBeGreaterThan(0);
            expect(transform.scale.y).toBeGreaterThan(0);
          }
          for (const scale of [pose.face.eyeScale, pose.face.noseScale]) {
            expect(scale.x).toBeGreaterThan(0);
            expect(scale.y).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('fades articulation continuously to neutral and steers lean without resetting phase', () => {
    const moving = at(0.24), fading = at(0.24, { motionWeight: 0.5 });
    expect(fading.phase).toBe(moving.phase);
    expect(fading.hop).toBeCloseTo(moving.hop / 2);
    for (const id of ['body', 'head'] as const) {
      expect(fading.rig.parts[id].angle).toBeCloseTo(moving.rig.parts[id].angle / 2);
      expect(fading.rig.parts[id].squashStretch).toBeCloseTo(moving.rig.parts[id].squashStretch / 2);
    }
    expectNumbersClose(at(0.24, { motionWeight: 1e-6 }).rig, at(0.24, { motionWeight: 0 }).rig, 4);
    for (const weight of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      expectNumbersClose(at(0.24, { motionWeight: weight }).rig, at(0.24, { motionWeight: weight + 1e-7 }).rig, 4);
    }
    expect(at(0.24, { facing: -1 }).summary.rotation).toBeCloseTo(-moving.summary.rotation);
    expect(at(0.24, { facing: -1 }).hop).toBe(moving.hop);
    const stopped = at(0.49, { motionWeight: 0 });
    expect(stopped.summary).toEqual({ hop: 0, scaleX: 1, scaleY: 1, rotation: 0, blink: false });
  });

  it('gives eyes their own squint/open beat and a later, tiny nose recovery', () => {
    expect(at(0.12).face.eyeScale.y).toBeCloseTo(0.62);
    expect(at(0.24).face.eyeScale.y).toBeCloseTo(1.16);
    expect(at(0.67).face.eyeScale.y).toBeCloseTo(0.6);
    expect(at(0.76).face.noseOffset.y).toBeCloseTo(0.22);
    expect(at(0.76).face.eyeOffset.y).toBeCloseTo(0.04);
    for (let index = 0; index <= 100; index++) {
      const { face } = at(index / 100);
      expect(Math.hypot(face.eyeOffset.x, face.eyeOffset.y)).toBeLessThan(0.3);
      expect(Math.hypot(face.noseOffset.x, face.noseOffset.y)).toBeLessThan(0.3);
      // Even scaling around each feature's center leaves the original ink inside the head.
      for (const centerX of [2.5, 11.5]) {
        expect(centerX + face.eyeOffset.x - face.eyeScale.x / 2).toBeGreaterThan(0);
        expect(centerX + face.eyeOffset.x + face.eyeScale.x / 2).toBeLessThan(18);
      }
      expect(14 + face.eyeOffset.y + face.eyeScale.y).toBeLessThan(19);
      expect(16 + face.noseOffset.y + face.noseScale.y).toBeLessThan(19);
    }
  });

  it('preserves the strict 4.7 second timed blink independently of distance and expression', () => {
    for (const animationTime of [0, 4.55, 4.56, 4.56001, 4.699, 4.7, 9.27, 18.79]) {
      for (const motionWeight of [0, 0.5, 1]) {
        const pose = at(0.15, { animationTime, motionWeight });
        expect(pose.face.blink).toBe(animationTime % 4.7 > 4.56);
        expect(pose.summary.blink).toBe(pose.face.blink);
      }
    }
    expect(at(0.84).face.blink).toBe(false);
  });

  it('samples the explicit eased hop clock independently of raw distance and blink time', () => {
    const still = character({
      gaitDistance: 3.7, motionWeight: 1, facing: 0.4, hop: { phase: 0.37, speed: 22, active: true },
    });
    const before = sampleRabbitMotion(still);
    still.animationTime = 123;
    const after = sampleRabbitMotion(still);
    expect(after.phase).toBe(before.phase);
    expect(after.rig).toEqual(before.rig);
    expect(after.hop).toBe(before.hop);
    still.gaitDistance = 100;
    expect(sampleRabbitMotion(still).rig).toEqual(before.rig);
  });

  it('samples equivalent travel identically at 30, 60, and irregular fps', () => {
    const run = (steps: number[], duration: number, speed: number): RabbitMotionPose => {
      const state = character();
      let elapsed = 0, index = 0;
      while (elapsed < duration - 1e-12) {
        const delta = Math.min(steps[index++ % steps.length], duration - elapsed);
        advanceCharacterAnimation(state, delta, delta * speed, { x: 0.6, y: 0.8 }, true);
        elapsed += delta;
      }
      return sampleRabbitMotion(state);
    };
    for (const speed of [22, 9]) {
      for (const duration of [0.11, 0.409, 0.8, 2.31]) {
        const fps30 = run([1 / 30], duration, speed);
        const fps60 = run([1 / 60], duration, speed);
        const irregular = run([0.013, 0.028, 0.007, 0.049], duration, speed);
        expectNumbersClose(fps30, fps60, 8);
        expectNumbersClose(fps30, irregular, 8);
        expect(fps30.beat).toBe(fps60.beat);
        expect(fps30.beat).toBe(irregular.beat);
      }
    }
  });

  it('encloses transformed authored regions, padding, and underpainting without adding hop', () => {
    for (const facing of [-1, 0, 1]) {
      for (let index = 0; index <= 100; index++) {
        const pose = at(index / 100, { facing });
        const bounds = motionSourceBounds(pose);
        const transforms = transformRig(pose.rig);
        expect(numericValues(bounds).every(Number.isFinite)).toBe(true);
        expect(bounds.width).toBeGreaterThan(0);
        expect(bounds.height).toBeGreaterThan(0);
        for (const part of RABBIT_PARTS) {
          const regions = [
            ...part.regions,
            ...part.padding.map(pad => ({
              x: pad.x - pad.radius, y: pad.y - pad.radius, width: pad.radius * 2, height: pad.radius * 2,
            })),
            ...(part.underpainting ?? []).flatMap(paint => paint.regions),
          ];
          for (const rect of regions) {
            for (const x of [rect.x, rect.x + rect.width]) {
              for (const y of [rect.y, rect.y + rect.height]) {
                const point = rigPoint(pose.rig, transforms, part.id, { x, y });
                expect(point.x).toBeGreaterThanOrEqual(bounds.x);
                expect(point.x).toBeLessThanOrEqual(bounds.x + bounds.width);
                expect(point.y).toBeGreaterThanOrEqual(bounds.y);
                expect(point.y).toBeLessThanOrEqual(bounds.y + bounds.height);
              }
            }
          }
        }
        expect(motionSourceBounds({ ...pose, hop: pose.hop + 100 })).toEqual(bounds);
      }
    }
  });

  it('keeps the actual approved-source silhouette connected on a 4x grid throughout the hop', () => {
    const layers = buildRigLayers(approvedRabbitSource());
    const detached: unknown[] = [];
    for (const facing of [-1, 0, 1]) {
      for (const motionWeight of [0.25, 0.5, 1]) {
        for (let index = 0; index <= 200; index++) {
          const { components, joins, inkJoins } = silhouetteAudit(at(index / 200, { facing, motionWeight }), layers);
          if (components.length !== 1 || Object.values(joins).some(count => count < 64)
            || ['left-foot', 'right-foot', 'left-arm', 'right-arm'].some(id => inkJoins[id] < 1)) {
            detached.push({ phase: index / 200, facing, motionWeight, components, joins, inkJoins });
          }
        }
      }
    }
    expect(detached.slice(0, 12), `${detached.length} disconnected or unseated-ink poses`).toEqual([]);
  }, 30_000);

  it('seats airborne ankles and solves planted, flat soles through grounded body lean', () => {
    for (const phase of [0.22, 0.55, 0.56, 0.58]) {
      for (const facing of [-1, 0, 1]) {
        const pose = at(phase, { facing }), transforms = transformRig(pose.rig);
        for (const id of ['left-foot', 'right-foot'] as const) {
          const ankle = pose.rig.parts[id].pivot;
          expect(ankle.y).toBe(26);
          const bodyPoint = rigPoint(pose.rig, transforms, 'body', ankle);
          const footPoint = rigPoint(pose.rig, transforms, id, ankle);
          expect(Math.hypot(bodyPoint.x - footPoint.x, bodyPoint.y - footPoint.y)).toBeLessThan(0.4);
        }
      }
    }
    for (const facing of [-1, 0, 1]) {
      for (const motionWeight of [0.25, 0.5, 1]) {
        for (let index = 0; index <= 100; index++) {
          const pose = at(index / 100, { facing, motionWeight }), transforms = transformRig(pose.rig);
          for (const [id, x] of [['left-foot', 5], ['right-foot', 13]] as const) {
            const sole = rigPoint(pose.rig, transforms, id, { x, y: 29 });
            expect(sole.y - pose.hop * 29 / 12).toBeLessThanOrEqual(29 + 1e-9);
            if (pose.hop === 0) {
              expect(sole.x).toBeCloseTo(x, 10);
              expect(sole.y).toBeCloseTo(29, 10);
              expect(transforms[id].angle).toBeCloseTo(0, 10);
            }
          }
        }
      }
    }
  });

  it('keeps paired ears and arms coherent in world space without pinching the ear tips inward', () => {
    for (const facing of [-1, 0, 1]) {
      for (const speed of [9.9, 22]) {
        for (let index = 0; index <= 200; index++) {
          const phase = index / 200;
          const pose = at(phase, { facing, hop: { phase: phase % 1, speed, active: true } });
          const transforms = transformRig(pose.rig);
          const left = transforms['left-ear'].angle, right = transforms['right-ear'].angle;
          expect(left * right).toBeGreaterThanOrEqual(-1e-10);
          expect(Math.abs(left - right) * 180 / Math.PI).toBeLessThan(0.75);
          expect(transforms['left-arm'].angle).toBeCloseTo(transforms['right-arm'].angle, 10);
          const leftTip = rigPoint(pose.rig, transforms, 'left-ear', { x: 6, y: 0 });
          const rightTip = rigPoint(pose.rig, transforms, 'right-ear', { x: 12, y: 0 });
          const axis = { x: Math.cos(transforms.head.angle), y: Math.sin(transforms.head.angle) };
          const gap = (rightTip.x - leftTip.x) * axis.x + (rightTip.y - leftTip.y) * axis.y;
          const bases = transforms['right-ear'].position.x - transforms['left-ear'].position.x;
          const baseY = transforms['right-ear'].position.y - transforms['left-ear'].position.y;
          expect(gap).toBeGreaterThan(bases * axis.x + baseY * axis.y - 0.1);
        }
      }
    }
    expect(transformRig(at(0.3, { hop: { phase: 0.3, speed: 9.9, active: true } }).rig)['left-ear'].angle)
      .not.toBeCloseTo(transformRig(at(0.3).rig)['left-ear'].angle, 2);
  });

  it('is stateless and never mutates input, authored definitions, or another sampled pose', () => {
    const state = character({ gaitDistance: 2.4, motionWeight: 0.8, facing: -0.7 });
    state.route = [{ x: 22, y: 31 }];
    const before = structuredClone(state), definitions = structuredClone(RABBIT_PARTS);
    const first = sampleRabbitMotion(state), original = structuredClone(first);
    const next = sampleRabbitMotion(state);
    expect(first).toEqual(next);
    first.rig.parts.head.pivot.x = 1;
    first.rig.parts['left-ear'].offset.y = 2;
    first.face.eyeScale.y = 0.4;
    expect(next).toEqual(original);
    expect(sampleRabbitMotion(state)).toEqual(original);
    expect(state).toEqual(before);
    expect(RABBIT_PARTS).toEqual(definitions);
  });

  it('rejects invalid motion inputs explicitly rather than producing a broken rig', () => {
    for (const key of ['gaitDistance', 'animationTime', 'motionWeight', 'facing'] as const) {
      for (const value of [NaN, Infinity, -Infinity]) {
        expect(() => sampleRabbitMotion(character({ [key]: value }))).toThrow(RangeError);
      }
    }
    for (const overrides of [
      { gaitDistance: -1 }, { animationTime: -1 }, { motionWeight: -0.1 },
      { motionWeight: 1.1 }, { facing: -1.1 }, { facing: 1.1 },
    ]) {
      expect(() => sampleRabbitMotion(character(overrides))).toThrow(RangeError);
    }
    expect(() => sampleRabbitMotion(character({ gaitDistance: Number.MAX_VALUE, animationTime: Number.MAX_VALUE }))).not.toThrow();
    const broken = at(0.3);
    broken.rig.parts.head.angle = Infinity;
    expect(() => motionSourceBounds(broken)).toThrow(RangeError);
  });
});
