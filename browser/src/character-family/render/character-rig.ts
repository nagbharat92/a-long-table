import Phaser from 'phaser';
import type { Point, Rectangle } from '../core/contracts';
import {
  auditRig, buildRigLayers, hitRigPart, rigParts, rigPose, rigTransform, RIG_HEIGHT, RIG_WIDTH, rigBounds, rigPoint, transformRig,
  type CharacterRigState, type RigAudit, type RigLayer, type RigNodeId,
} from '../core/character-rig';
import { readRabbitPixels, SOURCE_PIXEL_SCALE } from './rabbit-texture';
import type { CharacterArtwork } from '../core/character-definition';

export class CharacterRigDrawing {
  private readonly layers: RigLayer[];
  private readonly source: Uint8ClampedArray;
  private readonly images = new Map<string, Phaser.GameObjects.Image>();
  private readonly pads = new Map<string, Phaser.GameObjects.Image>();
  private readonly guides: Phaser.GameObjects.Graphics;
  private state: CharacterRigState | null = null;
  private signature = '';
  private audit: RigAudit | null = null;
  private readonly accent: number;

  constructor(private readonly scene: Phaser.Scene, artwork?: CharacterArtwork) {
    this.source = artwork?.source ?? readRabbitPixels(scene);
    this.layers = artwork?.layers ?? buildRigLayers(this.source);
    this.accent = Phaser.Display.Color.HexStringToColor(getComputedStyle(document.documentElement).getPropertyValue('--cp-accent').trim()).color;
    for (const [index, layer] of this.layers.entries()) {
      for (const kind of ['part', 'padding'] as const) {
        const key = `rig-${kind}-${layer.attachment ?? layer.id}`;
        const textureCanvas = document.createElement('canvas');
        textureCanvas.width = RIG_WIDTH;
        textureCanvas.height = RIG_HEIGHT;
        const ctx = textureCanvas.getContext('2d');
        if (!ctx) throw new Error(`Could not prepare the ${layer.id} rig texture.`);
        const data = ctx.createImageData(RIG_WIDTH, RIG_HEIGHT);
        data.data.set(kind === 'part' ? layer.pixels : layer.padding);
        ctx.putImageData(data, 0, 0);
        const texture = scene.textures.addCanvas(key, textureCanvas);
        if (!texture) throw new Error(`Could not register the ${layer.id} rig texture.`);
        texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
        const image = scene.add.image(0, 0, key).setDepth(kind === 'part' ? index : 20 + index).setVisible(false);
        if (kind === 'padding') image.setTint(this.accent).setAlpha(0.7);
        (kind === 'part' ? this.images : this.pads).set(layer.attachment ?? layer.id, image);
      }
    }
    this.guides = scene.add.graphics().setDepth(40);
  }

  setState(state: CharacterRigState | null): void {
    this.state = state ? structuredClone(state) : null;
    this.signature = '';
    if (state) this.audit = auditRig(state, this.layers, this.source);
    else {
      for (const image of [...this.images.values(), ...this.pads.values()]) image.setVisible(false);
      this.guides.clear();
    }
  }

  getAudit(): RigAudit {
    if (!this.audit) throw new Error('The character rig has not been checked yet.');
    return { ...this.audit, uncoveredJoints: [...this.audit.uncoveredJoints] };
  }

  getBounds(): Rectangle {
    if (!this.state) throw new Error('The character rig is not active.');
    return rigBounds(this.state, this.layers);
  }

  hit(point: Point, foot: Point): RigNodeId | null {
    if (!this.state) return null;
    return hitRigPart(this.state, this.layers, {
      x: (point.x - foot.x) / SOURCE_PIXEL_SCALE + RIG_WIDTH / 2,
      y: (point.y - foot.y) / SOURCE_PIXEL_SCALE + RIG_HEIGHT,
    });
  }

  render(foot: Point, zoom: number): void {
    const state = this.state;
    if (!state) return;
    const signature = `${foot.x}:${foot.y}:${zoom}`;
    if (this.signature === signature) return;
    this.signature = signature;
    const transforms = transformRig(state);
    const world = (point: Point): Point => ({
      x: foot.x + (point.x - RIG_WIDTH / 2) * SOURCE_PIXEL_SCALE,
      y: foot.y + (point.y - RIG_HEIGHT) * SOURCE_PIXEL_SCALE,
    });
    const guides = this.guides.clear();
    const lineWidth = 1 / zoom;
    for (const layer of this.layers) {
      const key = layer.attachment ?? layer.id;
      const pose = rigPose(state, layer.id);
      const transform = rigTransform(transforms, layer.id);
      const position = world(transform.position);
      for (const image of [this.images.get(key)!, this.pads.get(key)!]) {
        image.setPosition(position.x, position.y).setOrigin(pose.pivot.x / RIG_WIDTH, pose.pivot.y / RIG_HEIGHT)
          .setRotation(transform.angle).setScale(SOURCE_PIXEL_SCALE * transform.scale.x, SOURCE_PIXEL_SCALE * transform.scale.y);
      }
      this.images.get(key)!.setVisible(true);
      this.pads.get(key)!.setVisible(state.padding);
      if (layer.attachment) continue;
      const part = rigParts(state).find(candidate => candidate.id === layer.id)!;
      if (state.joints) {
        if (part.parent) {
          const parentPosition = world(transforms[part.parent].position);
          guides.lineStyle(lineWidth, this.accent, 0.5).lineBetween(parentPosition.x, parentPosition.y, position.x, position.y);
        }
        guides.fillStyle(this.accent).fillCircle(position.x, position.y, 2.5 / zoom);
      }
      if (layer.id === state.selected) {
        const b = layer.bounds;
        const corners = [
          { x: b.x - 0.5, y: b.y - 0.5 }, { x: b.x + b.width + 0.5, y: b.y - 0.5 },
          { x: b.x + b.width + 0.5, y: b.y + b.height + 0.5 }, { x: b.x - 0.5, y: b.y + b.height + 0.5 },
        ].map(point => {
          const p = world(rigPoint(state, transforms, layer.id, point));
          return new Phaser.Math.Vector2(p.x, p.y);
        });
        guides.lineStyle(lineWidth, this.accent, 0.8).strokePoints(corners, true)
          .lineBetween(position.x - 4 / zoom, position.y, position.x + 4 / zoom, position.y)
          .lineBetween(position.x, position.y - 4 / zoom, position.x, position.y + 4 / zoom);
      }
    }
  }

  destroy(): void {
    for (const image of [...this.images.values(), ...this.pads.values()]) image.destroy();
    for (const layer of this.layers) {
      this.scene.textures.remove(`rig-part-${layer.attachment ?? layer.id}`);
      this.scene.textures.remove(`rig-padding-${layer.attachment ?? layer.id}`);
    }
    this.guides.destroy();
  }
}
