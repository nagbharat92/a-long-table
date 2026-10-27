import Phaser from 'phaser';
import type { Point } from '../core/contracts';
import { buildMotionArtwork, type FaceFeature } from '../core/character-face';
import { RIG_HEIGHT, RIG_WIDTH, rigPoint, transformRig, type RigPartId } from '../core/character-rig';
import type { RabbitMotionPose } from '../core/character-motion';
import { BLINK_TEXTURE, readRabbitPixels, SOURCE_PIXEL_SCALE } from './rabbit-texture';
import { configureCharacterImage } from './character-image';

export class RabbitMotionDrawing {
  private readonly parts = new Map<RigPartId, Phaser.GameObjects.Image>();
  private readonly face: { feature: FaceFeature; image: Phaser.GameObjects.Image }[] = [];
  private readonly textureKeys: string[] = [];
  private blinking = false;

  constructor(private readonly scene: Phaser.Scene) {
    const artwork = buildMotionArtwork(readRabbitPixels(scene), readRabbitPixels(scene, BLINK_TEXTURE));
    for (const layer of artwork.layers) {
      this.parts.set(layer.id, configureCharacterImage(scene.add.image(0, 0, this.texture(`part-${layer.id}`, layer.pixels))));
    }
    for (const layer of artwork.face) {
      const key = this.texture(`face-${layer.feature.id}`, layer.pixels);
      this.texture(`face-${layer.feature.id}-blink`, layer.blink);
      this.face.push({ feature: layer.feature, image: configureCharacterImage(scene.add.image(0, 0, key)) });
    }
  }

  private texture(id: string, pixels: Uint8ClampedArray): string {
    const key = `motion-${id}`;
    const canvas = document.createElement('canvas');
    canvas.width = RIG_WIDTH;
    canvas.height = RIG_HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) throw new Error(`Could not prepare the ${id} motion texture.`);
    const data = context.createImageData(RIG_WIDTH, RIG_HEIGHT);
    data.data.set(pixels);
    context.putImageData(data, 0, 0);
    const texture = this.scene.textures.addCanvas(key, canvas);
    if (!texture) throw new Error(`Could not register the ${id} motion texture.`);
    texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.textureKeys.push(key);
    return key;
  }

  setVisible(visible: boolean): void {
    for (const image of this.parts.values()) image.setVisible(visible);
    for (const { image } of this.face) image.setVisible(visible);
  }

  render(pose: RabbitMotionPose, foot: Point, depth: number): void {
    const transforms = transformRig(pose.rig);
    const world = (point: Point): Point => ({
      x: foot.x + (point.x - RIG_WIDTH / 2) * SOURCE_PIXEL_SCALE,
      y: foot.y - pose.hop + (point.y - RIG_HEIGHT) * SOURCE_PIXEL_SCALE,
    });
    let index = 0;
    for (const [id, image] of this.parts) {
      const transform = transforms[id];
      const pivot = pose.rig.parts[id].pivot;
      const point = world(transform.position);
      image.setPosition(point.x, point.y).setDepth(depth + index++ * 0.0001)
        .setOrigin(pivot.x / RIG_WIDTH, pivot.y / RIG_HEIGHT).setRotation(transform.angle)
        .setScale(SOURCE_PIXEL_SCALE * transform.scale.x, SOURCE_PIXEL_SCALE * transform.scale.y);
    }
    const head = transforms.head;
    for (const { feature, image } of this.face) {
      const scale = feature.id === 'nose' ? pose.face.noseScale : pose.face.eyeScale;
      const offset = feature.id === 'nose' ? pose.face.noseOffset : pose.face.eyeOffset;
      const point = world(rigPoint(pose.rig, transforms, 'head', {
        x: feature.pivot.x + offset.x, y: feature.pivot.y + offset.y,
      }));
      if (pose.face.blink !== this.blinking) {
        image.setTexture(`motion-face-${feature.id}${pose.face.blink ? '-blink' : ''}`);
      }
      image.setPosition(point.x, point.y).setDepth(depth + index++ * 0.0001)
        .setOrigin(feature.pivot.x / RIG_WIDTH, feature.pivot.y / RIG_HEIGHT).setRotation(head.angle)
        .setScale(SOURCE_PIXEL_SCALE * head.scale.x * scale.x, SOURCE_PIXEL_SCALE * head.scale.y * scale.y);
    }
    this.blinking = pose.face.blink;
  }

  destroy(): void {
    for (const image of this.parts.values()) image.destroy();
    for (const { image } of this.face) image.destroy();
    for (const key of this.textureKeys) this.scene.textures.remove(key);
  }
}
