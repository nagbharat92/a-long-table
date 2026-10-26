import Phaser from 'phaser';
import type { BushPhase, BushState, CharacterState } from '../core/contracts';
import { characterPose } from '../core/game';

export const SOURCE_PIXEL_SCALE = 12 / 29;
export const RABBIT_TEXTURE = 'rabbit';
export const BLINK_TEXTURE = 'rabbit-blink';

const CONTOUR = [
  [-6, -2], [-7, -4], [-7, -6], [-5, -6], [-5, -9], [-2, -9],
  [-2, -11], [2, -11], [2, -9], [5, -9], [5, -7], [7, -7],
  [7, -3], [5, -3], [5, -1], [-3, -1], [-3, -2],
];

export function createBushTextures(scene: Phaser.Scene): void {
  for (const phase of ['ripe', 'depleted', 'growing'] satisfies BushPhase[]) {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create the berry bush texture.');
    context.imageSmoothingEnabled = false;
    context.translate(8, 12);
    const rect = (x: number, y: number, width: number, height: number, color: string) => {
      context.fillStyle = color;
      context.fillRect(x, y, width, height);
    };
    rect(-1, -3, 2, 4, '#254b37');
    context.fillStyle = '#254b37';
    context.beginPath();
    CONTOUR.forEach(([x, y], index) => index === 0 ? context.moveTo(x, y) : context.lineTo(x, y));
    context.closePath();
    context.fill();
    rect(-5, -6, 10, 3, '#44864b');
    rect(-3, -8, 6, 5, '#44864b');
    rect(-1, -9, 3, 3, '#44864b');
    rect(3, -6, 3, 2, '#44864b');
    if (phase !== 'depleted') {
      rect(-3, -8, 3, 2, '#79b958');
      rect(0, -9, 2, 2, '#79b958');
      rect(2, -6, 3, 1, '#79b958');
    }
    if (phase === 'ripe') {
      for (const [x, y] of [[-4, -5], [0, -7], [3, -4]]) {
        rect(x, y + 1, 2, 2, '#254b37');
        rect(x, y, 2, 2, '#c84962');
        rect(x, y, 1, 1, '#f0a18a');
      }
    } else if (phase === 'growing') {
      rect(-3, -5, 1, 1, '#b0cd79');
      rect(2, -4, 1, 1, '#b0cd79');
    }
    const texture = scene.textures.addCanvas(`bush-${phase}`, canvas);
    if (!texture) throw new Error(`Could not register the ${phase} berry bush texture.`);
    texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
  }
}

export class ActorDrawing {
  private readonly rabbit: Phaser.GameObjects.Image;
  private readonly shadow: Phaser.GameObjects.Graphics;
  private readonly selection: Phaser.GameObjects.Graphics;
  private readonly marker: Phaser.GameObjects.Graphics;
  private readonly route: Phaser.GameObjects.Graphics;
  private readonly markerPoints = [
    new Phaser.Math.Vector2(), new Phaser.Math.Vector2(),
    new Phaser.Math.Vector2(), new Phaser.Math.Vector2(),
  ];
  private blinking = false;
  private selected = false;
  private readonly bushes = new Map<string, {
    image: Phaser.GameObjects.Image;
    shadow: Phaser.GameObjects.Graphics;
    ring: Phaser.GameObjects.Graphics;
    x: number;
    y: number;
    phase: BushPhase;
    highlighted: boolean;
    progress: number;
  }>();

  constructor(private readonly scene: Phaser.Scene, private readonly characterLab: boolean) {
    this.shadow = scene.add.graphics();
    this.selection = scene.add.graphics()
      .lineStyle(0.5, 0xffe6a0, 0.7).strokeCircle(0, 0, 3).setVisible(false);
    this.rabbit = scene.add.image(0, 0, RABBIT_TEXTURE).setOrigin(0.5, 1);
    this.marker = scene.add.graphics();
    this.route = scene.add.graphics().setDepth(-100);
  }

  replaceBushes(states: BushState[]): void {
    for (const drawing of this.bushes.values()) {
      drawing.image.destroy();
      drawing.shadow.destroy();
      drawing.ring.destroy();
    }
    this.bushes.clear();
    if (this.characterLab) return;
    for (const state of states) {
      const { x, y } = state.position;
      const shadow = this.scene.add.graphics()
        .fillStyle(0x203630, 0.25).fillEllipse(0, 0.5, 14, 14 * 0.35)
        .setPosition(x, y).setDepth(y - 0.03);
      this.bushes.set(state.id, {
        image: this.scene.add.image(x, y, `bush-${state.state}`).setOrigin(0.5, 0.75).setDepth(y),
        shadow,
        ring: this.scene.add.graphics().setPosition(x, y).setDepth(y + 0.01),
        x,
        y,
        phase: state.state,
        highlighted: false,
        progress: 0,
      });
    }
  }

  render(character: CharacterState, bushes: BushState[], zoom: number): void {
    for (const bush of bushes) {
      const drawing = this.bushes.get(bush.id);
      if (!drawing) continue;
      const { x, y } = bush.position;
      if (drawing.phase !== bush.state) {
        drawing.image.setTexture(`bush-${bush.state}`);
        drawing.phase = bush.state;
      }
      if (drawing.x !== x || drawing.y !== y) {
        drawing.image.setPosition(x, y).setDepth(y);
        drawing.shadow.setPosition(x, y).setDepth(y - 0.03);
        drawing.ring.setPosition(x, y).setDepth(y + 0.01);
        drawing.x = x;
        drawing.y = y;
      }
      const highlighted = bush.hovered || bush.targeted;
      const progress = bush.gatherProgress > 0 ? Math.min(1, bush.gatherProgress) : 0;
      if (drawing.highlighted !== highlighted || drawing.progress !== progress) {
        drawing.ring.clear();
        if (highlighted) drawing.ring.lineStyle(0.65, 0xffe6a0, 0.7).strokeCircle(0, -1, 8);
        if (progress > 0) {
          drawing.ring.lineStyle(1, 0xffe6a0, 1).beginPath()
            .arc(0, -1, 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress, false, 0.04)
            .strokePath();
        }
        drawing.highlighted = highlighted;
        drawing.progress = progress;
      }
    }
    const pose = characterPose(character);
    const { x, y } = character.position;
    const lift = pose.hop / 2;
    if (pose.blink !== this.blinking) {
      this.rabbit.setTexture(pose.blink ? BLINK_TEXTURE : RABBIT_TEXTURE);
      this.blinking = pose.blink;
    }
    this.rabbit.setPosition(x, y - pose.hop).setDepth(y + 0.001)
      .setScale(SOURCE_PIXEL_SCALE * pose.scaleX, SOURCE_PIXEL_SCALE * pose.scaleY)
      .setRotation(pose.rotation);
    this.shadow.clear().setPosition(x, y).setDepth(y - 0.03)
      .fillStyle(0x1f3629, 0.27 - lift * 0.09)
      .fillEllipse(0, 0.2, 4.7 * (1 - lift * 0.18), 4.7 * (0.36 - lift * 0.04));
    this.selection.setPosition(x, y).setDepth(y - 0.02);
    this.marker.clear().setPosition(x, y).setDepth(y + 0.002);
    this.route.clear();
    if (this.characterLab) return;
    if (character.selected !== this.selected) {
      this.selection.setVisible(character.selected);
      this.selected = character.selected;
    }
    const radius = Math.max(1.5, 3 / zoom);
    const markerY = -15 - radius - 2 / zoom + Math.sin(character.animationTime * 2.5) * 0.45;
    const points = this.markerPoints;
    points[0].y = markerY + radius;
    points[1].x = -radius;
    points[1].y = markerY;
    points[2].y = markerY - radius;
    points[3].x = radius;
    points[3].y = markerY;
    this.marker.fillStyle(0xffe6a0).fillPoints(points, true)
      .lineStyle(Math.max(0.25, 0.65 / zoom), 0x23312e).strokePoints(points, true);
    if (character.routeIndex >= character.route.length) return;
    let start = character.position;
    let spacing = 0;
    for (let index = character.routeIndex; index < character.route.length; index++) {
      const end = character.route[index];
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      if (length > 0) {
        while (spacing < length) {
          const px = start.x + (end.x - start.x) * spacing / length;
          const py = start.y + (end.y - start.y) * spacing / length;
          this.route.fillStyle(0x203630, 0.4).fillCircle(px, py + 0.35, 0.65)
            .fillStyle(0xfff1cb, 0.85).fillCircle(px, py, 0.45);
          spacing += 3.5;
        }
        spacing -= length;
      }
      start = end;
    }
    const destination = character.route[character.route.length - 1];
    this.route.lineStyle(0.5, 0xffe6a0).strokeCircle(destination.x, destination.y, 1.5);
  }

  destroy(): void {
    this.replaceBushes([]);
    this.rabbit.destroy();
    this.shadow.destroy();
    this.selection.destroy();
    this.marker.destroy();
    this.route.destroy();
  }
}
