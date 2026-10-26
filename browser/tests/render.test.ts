import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import type { BushState } from '../src/core/contracts';
import { createCharacter } from '../src/core/game';
import { ActorDrawing, BLINK_TEXTURE, RABBIT_TEXTURE } from '../src/render/actors';
import { TerrainDrawing } from '../src/render/terrain';

vi.mock('phaser', () => ({
  default: {
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

  it('changes rabbit textures only at blink boundaries', () => {
    const { actors, character, images } = actorFixture(true);
    const rabbit = images[0];
    actors.render(character, [], 2);
    expect(rabbit.setTexture).not.toHaveBeenCalled();
    character.animationTime = 4.57;
    actors.render(character, [], 2);
    expect(rabbit.setTexture).toHaveBeenCalledExactlyOnceWith(BLINK_TEXTURE);
    character.animationTime = 4.6;
    actors.render(character, [], 2);
    expect(rabbit.setTexture).toHaveBeenCalledOnce();
    character.animationTime = 4.7;
    actors.render(character, [], 2);
    expect(rabbit.setTexture).toHaveBeenLastCalledWith(RABBIT_TEXTURE);
    expect(rabbit.setTexture).toHaveBeenCalledTimes(2);
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
});
