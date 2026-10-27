import { describe, expect, it } from 'vitest';
import {
  auditRig, buildRigLayers, createCharacterRig, exportCharacterRig, hitRigPart, RABBIT_PARTS,
  RIG_PART_SHAPE, RIG_HEIGHT, RIG_POSITION_LIMIT, RIG_WIDTH, rigBounds, rigPixelAt, rigPoint, sourceOwner, transformRig, validateRigState,
} from '../src/core/character-rig';

function sourceFixture(): Uint8ClampedArray {
  const source = new Uint8ClampedArray(RIG_WIDTH * RIG_HEIGHT * 4);
  for (let y = 0; y < RIG_HEIGHT; y++) {
    for (let x = 0; x < RIG_WIDTH; x++) {
      source.set([x * 12, y * 8, 100, 255], (y * RIG_WIDTH + x) * 4);
    }
  }
  return source;
}

describe('character rig recipe', () => {
  it('partitions every source pixel once and preserves the assembled source exactly', () => {
    const source = sourceFixture();
    const before = source.slice();
    const layers = buildRigLayers(source);
    const counts = new Map<string, number>();
    for (let y = 0; y < RIG_HEIGHT; y++) {
      for (let x = 0; x < RIG_WIDTH; x++) {
        const id = sourceOwner(x, y);
        counts.set(id, (counts.get(id) ?? 0) + 1);
        const layer = layers.find(layer => layer.id === id)!;
        const index = (y * RIG_WIDTH + x) * 4;
        expect(layer.pixels.slice(index, index + 4)).toEqual(source.slice(index, index + 4));
      }
    }
    expect(counts.size).toBe(8);
    expect(auditRig(createCharacterRig(), layers, source).restDifferencePixels).toBe(0);
    expect(source).toEqual(before);
  });

  it('does not turn transparent background pixels into invented silhouette', () => {
    const source = sourceFixture();
    const holes = [{ x: 6, y: 16 }, { x: 4, y: 22 }, { x: 8, y: 26 }];
    for (const { x, y } of holes) source.fill(0, (y * RIG_WIDTH + x) * 4, (y * RIG_WIDTH + x) * 4 + 4);
    const layers = buildRigLayers(source);
    for (const { x, y } of holes) {
      expect(layers.every(layer => layer.pixels[(y * RIG_WIDTH + x) * 4 + 3] === 0)).toBe(true);
    }
    expect(auditRig(createCharacterRig(), layers, source).restDifferencePixels).toBe(0);
  });

  it('keeps the full forehead outline in the head, not in rigid ear cutouts', () => {
    const source = sourceFixture();
    const layers = buildRigLayers(source);
    const head = layers.find(layer => layer.id === 'head')!;
    const fillIndex = (10 * RIG_WIDTH + 7) * 4;
    const fill = source.slice(fillIndex, fillIndex + 4);
    for (let x = 3; x <= 14; x++) {
      expect(sourceOwner(x, 6)).toBe('head');
      const index = (6 * RIG_WIDTH + x) * 4;
      expect(head.pixels.slice(index, index + 4)).toEqual(source.slice(index, index + 4));
      for (const id of ['left-ear', 'right-ear'] as const) {
        const ear = layers.find(layer => layer.id === id)!;
        const pixel = ear.pixels.slice(index, index + 4);
        if (pixel[3]) expect(pixel).toEqual(fill);
      }
    }
    expect(sourceOwner(4, 5)).toBe('left-ear');
    expect(sourceOwner(13, 5)).toBe('right-ear');
    for (const part of RABBIT_PARTS.filter(part => part.parent === 'head')) {
      expect(part.pivot.y).toBe(6);
      expect(part.regions.every(region => region.y + region.height <= 6)).toBe(true);
    }
  });

  it('keeps all source coordinates registered at rest', () => {
    const state = createCharacterRig();
    const transforms = transformRig(state);
    for (const part of RABBIT_PARTS) {
      expect(rigPoint(state, transforms, part.id, { x: 2.5, y: 12.5 })).toEqual({ x: 2.5, y: 12.5 });
    }
  });

  it('keeps the torso side and hip outline behind the arm and foot cutouts', () => {
    const source = sourceFixture();
    const fill = source.slice((10 * RIG_WIDTH + 7) * 4, (10 * RIG_WIDTH + 7) * 4 + 4);
    const stroke = source.slice(10 * RIG_WIDTH * 4, 10 * RIG_WIDTH * 4 + 4);
    for (let y = 19; y <= 26; y++) {
      for (let x = 4; x <= 13; x++) {
        const border = x === 4 || x === 13 || y === 26;
        source.set(border ? stroke : fill, (y * RIG_WIDTH + x) * 4);
      }
    }
    const layers = buildRigLayers(source);
    const body = layers.find(layer => layer.id === 'body')!;
    for (let y = 19; y <= 26; y++) {
      for (let x = 4; x <= 13; x++) {
        const index = (y * RIG_WIDTH + x) * 4;
        expect(body.pixels.slice(index, index + 4)).toEqual(x === 4 || x === 13 || y === 26 ? stroke : fill);
      }
    }
    expect(auditRig(createCharacterRig(), layers, source).restDifferencePixels).toBe(0);
    expect(sourceOwner(12, 20)).toBe('body');
    expect(sourceOwner(12, 25)).toBe('body');
    expect(sourceOwner(3, 25)).toBe('left-arm');
    expect(sourceOwner(14, 25)).toBe('right-arm');
    expect(sourceOwner(4, 26)).toBe('left-foot');
    expect(sourceOwner(13, 26)).toBe('right-foot');
  });

  it('exports the authored hidden outline recipe without changing the source or limb pivots', () => {
    const state = createCharacterRig();
    const result = JSON.parse(exportCharacterRig(state));
    const body = result.layers.find((part: { id: string }) => part.id === 'body');
    expect(body.underpainting).toEqual(RABBIT_PARTS.find(part => part.id === 'body')!.underpainting);
    for (const part of RABBIT_PARTS) expect(state.parts[part.id].pivot).toEqual(part.pivot);
    const source = sourceFixture();
    source.fill(0, 10 * RIG_WIDTH * 4, 10 * RIG_WIDTH * 4 + 4);
    expect(() => buildRigLayers(source)).toThrow('body underpainting sample must be opaque');
  });

  it('reaches exaggerated endpoints exactly while keeping Neutral unchanged', () => {
    const state = createCharacterRig();
    const neutral = transformRig(state);
    for (const part of RABBIT_PARTS) {
      state.parts[part.id].squashStretch = -1;
      expect(transformRig(state)[part.id].scale).toEqual({ x: 2, y: 0.2 });
      state.parts[part.id].squashStretch = 1;
      expect(transformRig(state)[part.id].scale).toEqual({ x: 0.4, y: 2.5 });
      state.parts[part.id].squashStretch = 0;
    }
    expect(transformRig(state)).toEqual(neutral);
  });

  it('frames every transformed layer at combined extreme scales, angles and inspection offsets', () => {
    const state = createCharacterRig();
    state.explode = 1;
    RABBIT_PARTS.forEach((part, index) => {
      state.parts[part.id].squashStretch = index % 2 ? -1 : 1;
      state.parts[part.id].angle = part.limit;
      state.parts[part.id].offset = { x: -1.5, y: 2 };
    });
    const layers = buildRigLayers(sourceFixture());
    const bounds = rigBounds(state, layers);
    const transforms = transformRig(state);
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
    for (const layer of layers) {
      const b = layer.bounds;
      for (const x of [b.x, b.x + b.width]) {
        for (const y of [b.y, b.y + b.height]) {
          const point = rigPoint(state, transforms, layer.id, { x, y });
          expect(point.x).toBeGreaterThanOrEqual(bounds.x);
          expect(point.x).toBeLessThanOrEqual(bounds.x + bounds.width);
          expect(point.y).toBeGreaterThanOrEqual(bounds.y);
          expect(point.y).toBeLessThanOrEqual(bounds.y + bounds.height);
        }
      }
    }
    expect(() => rigBounds(state, [])).toThrow('no layers');
  });

  it('inherits parent rotations without tying hierarchy to draw order', () => {
    const state = createCharacterRig();
    state.parts.body.angle = 6;
    state.parts.head.angle = 12;
    const transforms = transformRig(state);
    expect(transforms.head.angle).toBeCloseTo(18 * Math.PI / 180);
    expect(transforms['left-ear'].angle).toBeCloseTo(transforms.head.angle);
    expect(transforms['left-arm'].angle).toBeCloseTo(transforms.body.angle);
    const expected = rigPoint(state, transforms, 'head', state.parts['left-ear'].pivot);
    expect(transforms['left-ear'].position.x).toBeCloseTo(expected.x);
    expect(transforms['left-ear'].position.y).toBeCloseTo(expected.y);
  });

  it('always applies and exports position offsets without changing joint angles', () => {
    const state = createCharacterRig();
    state.parts.body.angle = 4;
    state.parts.head.angle = 6;
    const transforms = transformRig(state);
    const exported = exportCharacterRig(state);
    for (const part of RABBIT_PARTS) state.parts[part.id].offset = { x: 2, y: -1.5 };
    const moved = transformRig(state);
    expect(moved).not.toEqual(transforms);
    expect(exportCharacterRig(state)).not.toBe(exported);
    for (const part of RABBIT_PARTS) {
      expect(moved[part.id].angle).toBe(transforms[part.id].angle);
      expect(JSON.parse(exportCharacterRig(state)).pose[part.id].offset).toEqual({ x: 2, y: -1.5 });
    }
  });

  it('moves the head and ears without moving siblings or changing setup pivots', () => {
    const state = createCharacterRig();
    const original = transformRig(state);
    const pivots = RABBIT_PARTS.map(part => ({ ...state.parts[part.id].pivot }));
    state.parts.head.offset = { x: 1.5, y: -2 };
    const moved = transformRig(state);
    for (const id of ['head', 'left-ear', 'right-ear'] as const) {
      expect(moved[id].position).toEqual({ x: original[id].position.x + 1.5, y: original[id].position.y - 2 });
      expect(moved[id].angle).toBe(original[id].angle);
    }
    for (const id of ['body', 'left-arm', 'right-arm', 'left-foot', 'right-foot'] as const) {
      expect(moved[id]).toEqual(original[id]);
    }
    expect(RABBIT_PARTS.map(part => state.parts[part.id].pivot)).toEqual(pivots);
    state.parts.head.offset = { x: 0, y: 0 };
    expect(transformRig(state)).toEqual(original);
  });

  it('applies child offsets in parent axes, independently of their own rotation and explode', () => {
    const state = createCharacterRig();
    state.parts.body.angle = 6;
    state.parts.head.angle = 12;
    state.parts.head.offset = { x: 2, y: -1 };
    state.parts['left-ear'].offset = { x: -0.5, y: 1 };
    for (const explode of [0, 1]) {
      state.explode = explode;
      const transforms = transformRig(state);
      for (const id of ['head', 'left-ear'] as const) {
        const part = RABBIT_PARTS.find(part => part.id === id)!;
        const pose = state.parts[id];
        const expected = rigPoint(state, transforms, part.parent!, {
          x: pose.pivot.x + pose.offset.x + part.explode.x * explode,
          y: pose.pivot.y + pose.offset.y + part.explode.y * explode,
        });
        expect(transforms[id].position.x).toBeCloseTo(expected.x);
        expect(transforms[id].position.y).toBeCloseTo(expected.y);
      }
      const headPivot = rigPoint(state, transforms, 'head', state.parts.head.pivot);
      expect(headPivot).toEqual(transforms.head.position);
    }
  });

  it('moves the entire hierarchy with the body offset', () => {
    const state = createCharacterRig();
    const original = transformRig(state);
    state.parts.body.offset = { x: 2, y: -1 };
    const transforms = transformRig(state);
    for (const part of RABBIT_PARTS) {
      expect(transforms[part.id].position).toEqual({
        x: original[part.id].position.x + 2, y: original[part.id].position.y - 1,
      });
    }
  });

  it('squashes and stretches only the torso while rigid attachments follow and feet stay planted', () => {
    const state = createCharacterRig();
    const setup = structuredClone(state.parts);
    const neutral = transformRig(state);
    for (let step = -100; step <= 100; step++) {
      state.parts.body.squashStretch = step / 100;
      const transforms = transformRig(state);
      const scale = transforms.body.scale;
      expect(scale.y).toBeCloseTo(1 + state.parts.body.squashStretch * (step < 0 ? 0.8 : 1.5));
      expect(scale.x).toBeCloseTo(1 - state.parts.body.squashStretch * (step < 0 ? 1 : 0.6));
      expect(rigPoint(state, transforms, 'body', state.parts.body.pivot)).toEqual(neutral.body.position);
      expect(transforms.body.position).toEqual(neutral.body.position);
      for (const id of ['left-foot', 'right-foot'] as const) expect(transforms[id]).toEqual(neutral[id]);
      for (const part of RABBIT_PARTS.filter(part => part.id !== 'body')) {
        expect(transforms[part.id].scale).toEqual({ x: 1, y: 1 });
        expect(transforms[part.id].angle).toBe(neutral[part.id].angle);
      }
      const headShift = transforms.head.position.y - neutral.head.position.y;
      expect(headShift).toBeCloseTo((state.parts.head.pivot.y - state.parts.body.pivot.y) * (scale.y - 1));
      for (const id of ['left-ear', 'right-ear'] as const) {
        expect(transforms[id].position.y - neutral[id].position.y).toBeCloseTo(headShift);
        expect(transforms[id].position.x).toBe(neutral[id].position.x);
      }
    }
    state.parts.body.squashStretch = 0;
    expect(state.parts).toEqual(setup);
    expect(transformRig(state)).toEqual(neutral);
  });

  it('holds posed feet and the body anchor through shaping with edited pivots, rotations and offsets', () => {
    const state = createCharacterRig();
    state.parts.body.pivot = { x: 8.5, y: 22 };
    state.parts.body.angle = 6;
    state.parts.body.offset = { x: 2, y: -1 };
    state.parts.head.angle = 10;
    state.parts.head.offset = { x: 1.5, y: -2 };
    state.parts['left-foot'].angle = -8;
    state.parts['left-foot'].offset = { x: -0.5, y: 1 };
    state.parts['right-foot'].pivot = { x: 11.5, y: 24.5 };
    for (const explode of [0, 1]) {
      state.explode = explode;
      state.parts.body.squashStretch = 0;
      const neutral = transformRig(state);
      const anchor = rigPoint(state, neutral, 'body', state.parts.body.pivot);
      for (const amount of [-1, -0.5, 0.5, 1]) {
        state.parts.body.squashStretch = amount;
        const shaped = transformRig(state);
        const shapedAnchor = rigPoint(state, shaped, 'body', state.parts.body.pivot);
        expect(shapedAnchor.x).toBeCloseTo(anchor.x);
        expect(shapedAnchor.y).toBeCloseTo(anchor.y);
        expect(shaped.body.position).toEqual(neutral.body.position);
        for (const id of ['left-foot', 'right-foot'] as const) expect(shaped[id]).toEqual(neutral[id]);
        for (const id of ['head', 'left-arm', 'right-arm'] as const) {
          const attachment = rigPoint(state, shaped, 'body', state.parts[id].pivot);
          const angle = shaped.body.angle;
          const part = RABBIT_PARTS.find(part => part.id === id)!;
          const x = state.parts[id].offset.x + part.explode.x * explode;
          const y = state.parts[id].offset.y + part.explode.y * explode;
          expect(shaped[id].position.x).toBeCloseTo(attachment.x + x * Math.cos(angle) - y * Math.sin(angle));
          expect(shaped[id].position.y).toBeCloseTo(attachment.y + x * Math.sin(angle) + y * Math.cos(angle));
        }
      }
    }
  });

  it('inverts scaled pixels for picking and preserves rigid child dimensions', () => {
    const state = createCharacterRig();
    const layers = buildRigLayers(sourceFixture());
    state.parts.body.angle = 6;
    state.parts.head.angle = 12;
    for (const squashStretch of [-1, -0.5, 0, 0.5, 1]) {
      state.parts.body.squashStretch = squashStretch;
      const transforms = transformRig(state);
      for (const layer of layers) {
        for (const point of [{ x: 7.5, y: 21.5 }, { x: 9.5, y: 24.5 }]) {
          const world = rigPoint(state, transforms, layer.id, point);
          expect(rigPixelAt(state, transforms[layer.id], layer, world)).toBe(
            (Math.floor(point.y) * RIG_WIDTH + Math.floor(point.x)) * 4,
          );
        }
        if (layer.id === 'body') continue;
        const a = rigPoint(state, transforms, layer.id, { x: 0, y: 0 });
        const b = rigPoint(state, transforms, layer.id, { x: 18, y: 29 });
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(Math.hypot(18, 29));
      }
    }
  });

  it('reshapes the head without reshaping the torso or siblings, and keeps ear artwork independent', () => {
    const state = createCharacterRig();
    const neutral = transformRig(state);
    const saved = structuredClone(state.parts);
    for (const amount of [-1, -0.5, 0.5, 1]) {
      state.parts.head.squashStretch = amount;
      const shaped = transformRig(state);
      const endpoint = amount < 0 ? RIG_PART_SHAPE.squash : RIG_PART_SHAPE.stretch;
      expect(shaped.head.scale.x).toBeCloseTo(1 + (endpoint.x - 1) * Math.abs(amount));
      expect(shaped.head.scale.y).toBeCloseTo(1 + (endpoint.y - 1) * Math.abs(amount));
      expect(shaped.head.position).toEqual(neutral.head.position);
      for (const id of ['body', 'left-arm', 'right-arm', 'left-foot', 'right-foot'] as const) {
        expect(shaped[id]).toEqual(neutral[id]);
        expect(state.parts[id]).toEqual(saved[id]);
      }
      for (const id of ['left-ear', 'right-ear'] as const) {
        expect(shaped[id].scale).toEqual({ x: 1, y: 1 });
        const attachment = rigPoint(state, shaped, 'head', state.parts[id].pivot);
        expect(shaped[id].position.x).toBeCloseTo(attachment.x);
        expect(shaped[id].position.y).toBeCloseTo(attachment.y);
        expect(state.parts[id]).toEqual(saved[id]);
      }
    }
    state.parts['left-ear'].squashStretch = -1;
    const ear = transformRig(state);
    expect(ear['left-ear'].scale).toEqual(RIG_PART_SHAPE.squash);
    expect(ear['right-ear'].scale).toEqual({ x: 1, y: 1 });
    expect(ear.body).toEqual(neutral.body);
  });

  it('keeps every part shape independent and uses its scale for point/pixel conversion', () => {
    const layers = buildRigLayers(sourceFixture());
    for (const part of RABBIT_PARTS) {
      const state = createCharacterRig();
      const neutral = transformRig(state);
      state.parts[part.id].angle = part.limit;
      state.parts[part.id].offset = { x: 1, y: -0.5 };
      state.parts[part.id].squashStretch = -1;
      const shaped = transformRig(state);
      expect(shaped[part.id].scale).toEqual(RIG_PART_SHAPE.squash);
      for (const other of RABBIT_PARTS.filter(candidate => candidate.id !== part.id)) {
        expect(state.parts[other.id].squashStretch).toBe(0);
        expect(shaped[other.id].scale).toEqual(neutral[other.id].scale);
      }
      const layer = layers.find(layer => layer.id === part.id)!;
      const point = { x: 8.5, y: 22.5 };
      const world = rigPoint(state, shaped, part.id, point);
      expect(rigPixelAt(state, shaped[part.id], layer, world)).toBe((22 * RIG_WIDTH + 8) * 4);
    }
  });

  it('uses positioned transforms for pixel picking and the joint-center audit', () => {
    const state = createCharacterRig();
    const source = sourceFixture();
    const layers = buildRigLayers(source);
    expect(hitRigPart(state, layers, { x: 9.5, y: -2.5 })).toBeNull();
    state.parts.head.offset.y = -3;
    expect(hitRigPart(state, layers, { x: 9.5, y: -2.5 })).toBe('head');
    expect(auditRig(state, layers, source).uncoveredJoints).not.toContain('left-ear');
    state.parts['left-ear'].pivot = { x: 0, y: 0 };
    expect(auditRig(state, layers, source).uncoveredJoints).toContain('left-ear');
  });

  it('explodes only the inspection view, leaving authored pivots and the export unchanged', () => {
    const state = createCharacterRig();
    const setup = structuredClone(state.parts);
    const exported = exportCharacterRig(state);
    state.explode = 1;
    const transforms = transformRig(state);
    expect(transforms.head.position).toEqual({ x: 9, y: 8 });
    expect(transforms['left-ear'].position).toEqual({ x: -1, y: -13 });
    expect(state.parts).toEqual(setup);
    expect(exportCharacterRig(state)).toBe(exported);
  });

  it('picks the visible foreground part and rejects empty space', () => {
    const state = createCharacterRig();
    const layers = buildRigLayers(sourceFixture());
    expect(hitRigPart(state, layers, { x: 9.5, y: 10.5 })).toBe('head');
    expect(hitRigPart(state, layers, { x: -20, y: -20 })).toBeNull();
    state.explode = 1;
    expect(hitRigPart(state, layers, { x: -9.5, y: 22.5 })).toBe('left-arm');
  });

  it('flags a disconnected pivot instead of reporting every rig as covered', () => {
    const state = createCharacterRig();
    const source = sourceFixture();
    state.parts['left-ear'].pivot = { x: 0, y: 0 };
    expect(auditRig(state, buildRigLayers(source), source).uncoveredJoints).toContain('left-ear');
  });

  it('exports source registration, ownership priority, hierarchy, limits and padding', () => {
    const state = createCharacterRig();
    state.parts.head.pivot.y = 17.5;
    state.parts.head.angle = 4;
    const result = JSON.parse(exportCharacterRig(state));
    expect(result.schemaVersion).toBe(5);
    expect(result.source).toEqual({ file: 'rabbit.png', width: 18, height: 29 });
    expect(result.layers).toHaveLength(8);
    expect(result.layers.find((layer: { id: string }) => layer.id === 'head')).toMatchObject({
      parent: 'body', pivot: { x: 9, y: 17.5 }, limit: 12,
    });
    expect(result.pose.head.angle).toBe(4);
    expect(result.partitionOrder.at(-1)).toBe('body');
    state.stress = 1;
    expect(JSON.parse(exportCharacterRig(state)).pose.head.angle).toBe(12);
  });

  it('exports independent part shaping as version 5 without baking edits into pivots or explode', () => {
    const state = createCharacterRig();
    state.parts.head.squashStretch = -0.75;
    state.parts.head.offset = { x: 1, y: -2 };
    const exported = exportCharacterRig(state);
    const result = JSON.parse(exported);
    expect(result.schemaVersion).toBe(5);
    expect(result.bodyShape).toBeUndefined();
    expect(result.partShape).toEqual({ ...RIG_PART_SHAPE, space: 'part-local', childArtwork: 'independent' });
    expect(result.pose.head.scale.x).toBeCloseTo(1.75);
    expect(result.pose.head.scale.y).toBeCloseTo(0.4);
    expect(result.positioning).toEqual({ space: 'parent', limit: RIG_POSITION_LIMIT });
    expect(result.pose.head).toMatchObject({
      angle: 0, pivot: { x: 9, y: 18 }, offset: { x: 1, y: -2 }, squashStretch: -0.75,
    });
    expect(result.layers.find((part: { id: string }) => part.id === 'head').pivot).toEqual({ x: 9, y: 18 });
    state.explode = 1;
    expect(exportCharacterRig(state)).toBe(exported);
    expect(result.pose.body.offset).toEqual({ x: 0, y: 0 });
    expect(result.pose.body.squashStretch).toBe(0);
    expect(result.pose.body.scale).toEqual({ x: 1, y: 1 });
  });

  it('rejects non-finite, missing and out-of-range offsets', () => {
    const state = createCharacterRig();
    for (const axis of ['x', 'y'] as const) {
      for (const value of [NaN, Infinity, -Infinity, RIG_POSITION_LIMIT + 0.5, -RIG_POSITION_LIMIT - 0.5]) {
        state.parts.head.offset[axis] = value;
        expect(() => validateRigState(state)).toThrow('head position');
      }
      state.parts.head.offset[axis] = 0;
    }
    Reflect.deleteProperty(state.parts.head, 'offset');
    expect(() => validateRigState(state)).toThrow('head position');
  });

  it('rejects non-finite, missing and out-of-range shaping for every part', () => {
    for (const part of RABBIT_PARTS) {
      const state = createCharacterRig();
      for (const amount of [NaN, Infinity, -Infinity, -1.01, 1.01]) {
        state.parts[part.id].squashStretch = amount;
        expect(() => transformRig(state)).toThrow(`${part.name.toLowerCase()} squash / stretch`);
        expect(() => exportCharacterRig(state)).toThrow(`${part.name.toLowerCase()} squash / stretch`);
      }
      Reflect.deleteProperty(state.parts[part.id], 'squashStretch');
      expect(() => validateRigState(state)).toThrow(`${part.name.toLowerCase()} squash / stretch`);
    }
  });
  it('rejects invalid image data and out-of-range or non-finite authoring state', () => {
    expect(() => buildRigLayers(new Uint8ClampedArray(4))).toThrow('18 by 29');
    const state = createCharacterRig();
    state.parts.head.angle = 13;
    expect(() => validateRigState(state)).toThrow('head');
    state.parts.head.angle = 0;
    state.parts.head.pivot.x = NaN;
    expect(() => transformRig(state)).toThrow('head');
    state.parts.head.pivot.x = 9;
    state.explode = 2;
    expect(() => transformRig(state)).toThrow('view settings');
  });
});
