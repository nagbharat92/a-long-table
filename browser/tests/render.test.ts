import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import type { BushState, World } from '../src/core/contracts';
import { createCharacter } from '../src/core/game';
import { ActorDrawing } from '../src/render/actors';
import { TerrainDrawing } from '../src/render/terrain';
import { drawIslandEdges } from '../src/render/island-edges';
import { drawIslandGround } from '../src/render/island-ground';
import { drawIslandShoreline } from '../src/render/island-shoreline';
import { islandMaterials } from '../src/render/island-materials';
import type { Point } from '../src/core/contracts';
import type { RabbitMotionPose } from '../src/core/character-motion';

const { motionRender } = vi.hoisted(() => ({ motionRender: vi.fn() }));

vi.mock('../src/render/island-edges', () => ({ drawIslandEdges: vi.fn() }));
vi.mock(import('../src/render/island-ground'), async importOriginal => ({
  ...await importOriginal(),
  drawIslandGround: vi.fn(),
}));
vi.mock('../src/render/island-shoreline', () => ({ drawIslandShoreline: vi.fn(() => ({ drawWater: vi.fn() })) }));

vi.mock('../src/render/rabbit-motion', () => ({
  RabbitMotionDrawing: class {
    private readonly image: Phaser.GameObjects.Image;
    constructor(scene: Phaser.Scene) { this.image = scene.add.image(0, 0, 'articulated-rabbit'); }
    setVisible(visible: boolean) { this.image.setVisible(visible); }
    render(pose: RabbitMotionPose, foot: Point, depth: number) { motionRender(pose, foot, depth); }
    destroy() { this.image.destroy(); }
  },
}));

vi.mock('phaser', () => ({
  default: {
    Textures: { FilterMode: { NEAREST: 0 } },
    Math: {
      Vector2: class {
        constructor(public x = 0, public y = 0) {}
      },
    },
  },
}));

function drawing() {
  return {
    setOrigin: vi.fn().mockReturnThis(),
    setDepth: vi.fn().mockReturnThis(),
    setPosition: vi.fn().mockReturnThis(),
    setTexture: vi.fn().mockReturnThis(),
    setScale: vi.fn().mockReturnThis(),
    setRotation: vi.fn().mockReturnThis(),
    setVisible: vi.fn().mockReturnThis(),
    clear: vi.fn().mockReturnThis(),
    fillStyle: vi.fn().mockReturnThis(),
    fillEllipse: vi.fn().mockReturnThis(),
    fillPoints: vi.fn().mockReturnThis(),
    fillCircle: vi.fn().mockReturnThis(),
    fillRect: vi.fn().mockReturnThis(),
    lineStyle: vi.fn().mockReturnThis(),
    strokeCircle: vi.fn().mockReturnThis(),
    strokePoints: vi.fn().mockReturnThis(),
    beginPath: vi.fn().mockReturnThis(),
    arc: vi.fn().mockReturnThis(),
    strokePath: vi.fn().mockReturnThis(),
    destroy: vi.fn(),
  };
}

function sceneFixture() {
  const graphics: ReturnType<typeof drawing>[] = [];
  const images: ReturnType<typeof drawing>[] = [];
  const scene = {
    add: {
      graphics: () => {
        const object = drawing();
        graphics.push(object);
        return object;
      },
      image: () => {
        const object = drawing();
        images.push(object);
        return object;
      },
    },
  } as unknown as Phaser.Scene;
  return { scene, graphics, images };
}

function actorFixture(characterLab = false) {
  motionRender.mockClear();
  const fixture = sceneFixture();
  const actors = new ActorDrawing(fixture.scene, characterLab);
  const character = createCharacter({ x: 24, y: 32 });
  const bush: BushState = {
    id: 'bush',
    position: { x: 48, y: 64 },
    state: 'ripe',
    regrowElapsed: 0,
    hovered: false,
    targeted: false,
    gatherProgress: 0,
  };
  actors.replaceBushes([bush]);
  return { ...fixture, actors, character, bush };
}

describe('retained actor drawing', () => {
  it('does not reset stationary bush textures, transforms or empty rings every frame', () => {
    const { actors, character, bush, images, graphics } = actorFixture();
    actors.render(character, [bush], 2);
    vi.clearAllMocks();
    bush.regrowElapsed = 0.1;
    actors.render(character, [bush], 2);
    const image = images[1];
    const [shadow, ring] = graphics.slice(4);
    for (const object of [image, shadow, ring]) {
      expect(object.setPosition).not.toHaveBeenCalled();
      expect(object.setDepth).not.toHaveBeenCalled();
      expect(object.clear).not.toHaveBeenCalled();
    }
    expect(image.setTexture).not.toHaveBeenCalled();
  });

  it('redraws rings only when their visible highlight or progress changes', () => {
    const { actors, character, bush, graphics } = actorFixture();
    const ring = graphics[5];
    actors.render(character, [bush], 2);
    bush.hovered = true;
    actors.render(character, [bush], 2);
    expect(ring.clear).toHaveBeenCalledTimes(1);
    expect(ring.strokeCircle).toHaveBeenLastCalledWith(0, -1, 8);
    bush.hovered = false;
    bush.targeted = true;
    actors.render(character, [bush], 2);
    expect(ring.clear).toHaveBeenCalledTimes(1);
    bush.gatherProgress = 0.25;
    actors.render(character, [bush], 2);
    expect(ring.clear).toHaveBeenCalledTimes(2);
    expect(ring.arc).toHaveBeenLastCalledWith(0, -1, 8, -Math.PI / 2, 0, false, 0.04);
    actors.render(character, [bush], 2);
    expect(ring.clear).toHaveBeenCalledTimes(2);
    bush.gatherProgress = 1;
    actors.render(character, [bush], 2);
    bush.gatherProgress = 2;
    actors.render(character, [bush], 2);
    expect(ring.clear).toHaveBeenCalledTimes(3);
    vi.clearAllMocks();
    bush.targeted = false;
    bush.gatherProgress = 0;
    actors.render(character, [bush], 2);
    expect(ring.clear).toHaveBeenCalledTimes(1);
    expect(ring.strokeCircle).not.toHaveBeenCalled();
    expect(ring.arc).not.toHaveBeenCalled();
  });

  it('updates bush phase and mutable positions and resets caches on replacement', () => {
    const { actors, character, bush, images, graphics } = actorFixture();
    actors.render(character, [bush], 2);
    vi.clearAllMocks();
    bush.state = 'depleted';
    bush.position.x = 60;
    bush.position.y = 70;
    actors.render(character, [bush], 2);
    expect(images[1].setTexture).toHaveBeenCalledExactlyOnceWith('bush-depleted');
    expect(images[1].setPosition).toHaveBeenCalledExactlyOnceWith(60, 70);
    expect(images[1].setDepth).toHaveBeenCalledExactlyOnceWith(70);
    expect(graphics[4].setPosition).toHaveBeenCalledExactlyOnceWith(60, 70);
    expect(graphics[4].setDepth).toHaveBeenCalledExactlyOnceWith(69.97);
    expect(graphics[5].setPosition).toHaveBeenCalledExactlyOnceWith(60, 70);
    expect(graphics[5].setDepth).toHaveBeenCalledExactlyOnceWith(70.01);
    bush.hovered = true;
    bush.gatherProgress = 0.5;
    actors.render(character, [bush], 2);
    actors.replaceBushes([bush]);
    expect(images[1].destroy).toHaveBeenCalledOnce();
    expect(graphics[4].destroy).toHaveBeenCalledOnce();
    expect(graphics[5].destroy).toHaveBeenCalledOnce();
    actors.render(character, [bush], 2);
    expect(graphics[7].strokeCircle).toHaveBeenCalledExactlyOnceWith(0, -1, 8);
    expect(graphics[7].arc).toHaveBeenCalledOnce();
  });

  it('keeps selection geometry and marker vertices while preserving zoom and animation', () => {
    const { actors, character, graphics } = actorFixture();
    const selection = graphics[1];
    const marker = graphics[2];
    actors.render(character, [], 2);
    expect(selection.strokeCircle).toHaveBeenCalledExactlyOnceWith(0, 0, 3);
    const points = marker.fillPoints.mock.calls[0][0];
    const vertices = [...points];
    expect(points.map(({ x, y }: { x: number; y: number }) => ({ x, y }))).toEqual([
      { x: 0, y: -16 }, { x: -1.5, y: -17.5 },
      { x: 0, y: -19 }, { x: 1.5, y: -17.5 },
    ]);
    character.selected = true;
    character.position = { x: 40, y: 50 };
    character.animationTime = 1;
    actors.render(character, [], 1);
    expect(selection.setVisible).toHaveBeenLastCalledWith(true);
    expect(selection.setPosition).toHaveBeenLastCalledWith(40, 50);
    expect(selection.clear).not.toHaveBeenCalled();
    expect(selection.strokeCircle).toHaveBeenCalledOnce();
    expect(marker.fillPoints.mock.calls[1][0]).toBe(points);
    points.forEach((point: object, index: number) => expect(point).toBe(vertices[index]));
    const middle = -20 + Math.sin(2.5) * 0.45;
    expect(points.map(({ x, y }: { x: number; y: number }) => ({ x, y }))).toEqual([
      { x: 0, y: middle + 3 }, { x: -3, y: middle },
      { x: 0, y: middle - 3 }, { x: 3, y: middle },
    ]);
    character.selected = false;
    actors.render(character, [], 1);
    expect(selection.setVisible).toHaveBeenLastCalledWith(false);
  });

  it('passes the same articulated pose and blink cadence to the retained motion renderer', () => {
    const { actors, character } = actorFixture(true);
    actors.render(character, [], 2);
    expect(motionRender).toHaveBeenLastCalledWith(
      expect.objectContaining({ face: expect.objectContaining({ blink: false }) }), character.position, 32.001,
    );
    character.animationTime = 4.57;
    actors.render(character, [], 2);
    expect(motionRender.mock.lastCall![0].face.blink).toBe(true);
    character.animationTime = 4.6;
    actors.render(character, [], 2);
    expect(motionRender.mock.lastCall![0].face.blink).toBe(true);
    character.animationTime = 4.7;
    actors.render(character, [], 2);
    expect(motionRender.mock.lastCall![0].face.blink).toBe(false);
    expect(motionRender).toHaveBeenCalledTimes(4);
  });

  it('never shows selection or marker in the character lab', () => {
    const { actors, character, graphics, images } = actorFixture(true);
    character.selected = true;
    actors.render(character, [], 2);
    expect(images).toHaveLength(1);
    expect(graphics[1].setVisible).toHaveBeenCalledExactlyOnceWith(false);
    expect(graphics[2].fillPoints).not.toHaveBeenCalled();
  });
});

describe('retained ocean drawing', () => {
  it('reuses waves inside a region and redraws at region/stride boundaries', () => {
    const { scene, graphics } = sceneFixture();
    const terrain = new TerrainDrawing(scene);
    const waves = graphics[0];
    terrain.updateOcean({ x: 1, y: 1, width: 100, height: 60 });
    const firstCommands = waves.fillRect.mock.calls.map((args) => [...args]);
    expect(waves.clear).toHaveBeenCalledOnce();
    terrain.updateOcean({ x: 2, y: 2, width: 100, height: 60 });
    expect(waves.clear).toHaveBeenCalledOnce();
    terrain.updateOcean({ x: 57, y: 2, width: 100, height: 60 });
    expect(waves.clear).toHaveBeenCalledTimes(2);
    vi.clearAllMocks();
    terrain.updateOcean({ x: 1, y: 1, width: 100, height: 60 });
    expect(waves.fillRect.mock.calls).toEqual(firstCommands);
    vi.clearAllMocks();
    terrain.updateOcean({ x: -10000, y: -10000, width: 20000, height: 20000 });
    expect(waves.clear).toHaveBeenCalledOnce();
    expect(waves.fillRect.mock.calls.length).toBeLessThanOrEqual(3200);
    terrain.destroy();
    expect(waves.destroy).toHaveBeenCalledOnce();
  });

  describe('terrain artwork scope', () => {
    it('keeps new edges opt-in and restores the original Levels view', () => {
      const context = { fillRect: vi.fn(), translate: vi.fn() };
      vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) });
      const world: World = {
        width: 3, height: 3, tileSize: 4, seed: 0, seaLevel: 0,
        generatorVersion: 'test', provenance: 'test-fixture',
        heights: new Float32Array(9).fill(0.35), cells: new Uint8Array(9).fill(1),
        elevations: new Uint8Array(9).fill(1),
      };
      const scene = {
        add: { graphics: () => drawing(), image: () => drawing() },
        textures: { addCanvas: () => ({ key: 'terrain', setFilter: vi.fn(), destroy: vi.fn(), refresh: vi.fn(), context }) },
      } as unknown as Phaser.Scene;
      vi.mocked(drawIslandEdges).mockClear();
      vi.mocked(drawIslandGround).mockClear();
      vi.mocked(drawIslandShoreline).mockClear();
      try {
        const standard = new TerrainDrawing(scene);
        standard.setWorld(world, new Float32Array(9).fill(1));
        expect(drawIslandEdges).not.toHaveBeenCalled();
        expect(drawIslandGround).not.toHaveBeenCalled();
        expect(drawIslandShoreline).not.toHaveBeenCalled();
        const island = new TerrainDrawing(scene, true);
        island.setWorld(world, new Float32Array(9).fill(1));
        expect(drawIslandEdges).toHaveBeenCalledExactlyOnceWith(
          context, world, ['#85cc49', '#99cf63', '#b5d982'], islandMaterials(world),
        );
        expect(drawIslandGround).toHaveBeenCalledExactlyOnceWith(context, world);
        expect(drawIslandShoreline).toHaveBeenCalledExactlyOnceWith(context, world, vi.mocked(drawIslandEdges).mock.calls[0][3]);
        const water = vi.mocked(drawIslandShoreline).mock.results[0].value!;
        expect(water.drawWater).toHaveBeenCalledExactlyOnceWith(context, 0);
        island.updateShoreline(0.04);
        expect(water.drawWater).toHaveBeenCalledOnce();
        island.updateShoreline(0.1);
        expect(water.drawWater).toHaveBeenCalledTimes(2);
        island.updateShoreline(0.1);
        expect(water.drawWater).toHaveBeenCalledTimes(2);
        island.setInspection(true);
        island.updateShoreline(2);
        expect(water.drawWater).toHaveBeenCalledTimes(2);
        expect(drawIslandEdges).toHaveBeenCalledOnce();
        expect(drawIslandGround).toHaveBeenCalledOnce();
        expect(drawIslandShoreline).toHaveBeenCalledOnce();
        island.setInspection(false);
        expect(drawIslandEdges).toHaveBeenCalledTimes(2);
        expect(drawIslandGround).toHaveBeenCalledTimes(2);
        expect(drawIslandShoreline).toHaveBeenCalledTimes(2);
        const restored = vi.mocked(drawIslandShoreline).mock.results[1].value!;
        expect(restored.drawWater).toHaveBeenCalledExactlyOnceWith(context, 2);
        standard.destroy();
        island.destroy();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
