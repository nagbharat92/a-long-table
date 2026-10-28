import Phaser from 'phaser';
import type { Point, Ramp, Rectangle, World } from '../core/contracts';
import { isCoastalCliff, terrainAt } from '../core/world';
import { drawSandySteps } from './sandy-steps';
import { drawIslandSteps } from './island-steps';
import { drawIslandEdges } from './island-edges';
import { drawIslandGround, ISLAND_GRASS_COLORS } from './island-ground';
import { drawIslandShoreline, type ShorelineAnimation } from './island-shoreline';
import { islandMaterials } from './island-materials';

export const OCEAN = 0x2698ee;
const LEVELS = ISLAND_GRASS_COLORS;
const INSPECTION = ['#80ae78', '#d4c47c', '#e8dcb7'];
const EDGE = '#304a40';

function adjusted(color: string, amount: number): string {
  const value = Number.parseInt(color.slice(1), 16);
  const channel = (shift: number) => {
    const component = (value >> shift) & 255;
    return Math.round(amount > 0 ? component + (255 - component) * amount : component * (1 + amount));
  };
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
}

function mixed(from: string, to: string, progress: number): string {
  const a = Number.parseInt(from.slice(1), 16);
  const b = Number.parseInt(to.slice(1), 16);
  const channel = (shift: number) =>
    Math.round(((a >> shift) & 255) * (1 - progress) + ((b >> shift) & 255) * progress);
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
}

export class TerrainDrawing {
  private image?: Phaser.GameObjects.Image;
  private texture?: Phaser.Textures.CanvasTexture;
  private overlay?: Phaser.GameObjects.Image;
  private overlayTexture?: Phaser.Textures.CanvasTexture;
  private shoreline?: ShorelineAnimation;
  private shorelineImage?: Phaser.GameObjects.Image;
  private shorelineTexture?: Phaser.Textures.CanvasTexture;
  private shorelineSeconds = 0;
  private shorelineFrame = -1;
  private readonly waves: Phaser.GameObjects.Graphics;
  private readonly waveRegion = { left: NaN, top: NaN, right: NaN, bottom: NaN, stride: NaN };
  private inspection = false;
  private navigation = false;
  private world?: World;
  private speeds?: Float32Array;

  constructor(private readonly scene: Phaser.Scene, private readonly islandArtwork = false) {
    this.waves = scene.add.graphics().setDepth(-10000);
  }

  setWorld(world: World, speeds: Float32Array): void {
    this.world = world;
    this.speeds = speeds;
    this.shorelineSeconds = 0;
    this.redraw();
    this.redrawNavigation();
  }

  setInspection(enabled: boolean): void {
    if (enabled === this.inspection) return;
    this.inspection = enabled;
    this.redraw();
  }

  setNavigationOverlay(enabled: boolean): void {
    if (enabled === this.navigation) return;
    this.navigation = enabled;
    this.redrawNavigation();
  }

  private redraw(): void {
    const world = this.world;
    if (!world) return;
    const detailed = this.islandArtwork && !this.inspection;
    this.shorelineImage?.destroy();
    this.shorelineTexture?.destroy();
    this.shorelineImage = undefined;
    this.shorelineTexture = undefined;
    this.shoreline = undefined;
    this.shorelineFrame = -1;
    this.image?.destroy();
    this.image = undefined;
    this.texture?.destroy();
    this.texture = undefined;
    const canvas = document.createElement('canvas');
    canvas.width = world.width * world.tileSize + 2;
    canvas.height = world.height * world.tileSize + 8;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create the terrain texture.');
    context.imageSmoothingEnabled = false;
    context.translate(1, 1);
    const tile = world.tileSize;
    const rect = (x: number, y: number, width: number, height: number, color: string) => {
      context.fillStyle = color;
      context.fillRect(x, y, width, height);
    };
    const land = (x: number, y: number) => {
      const kind = terrainAt(world, { x, y });
      return kind === 'sand' || kind === 'grass';
    };
    const grassColor = (x: number, y: number) =>
      (this.inspection ? INSPECTION : LEVELS)[world.elevations?.[y * world.width + x] ?? 0];

    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        if (terrainAt(world, { x, y }) === 'shallow') rect(x * tile, y * tile, tile, tile, '#53b9e9');
      }
    }
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        if (detailed || !isCoastalCliff(world, { x, y })) continue;
        const bottom = (y + 1) * tile;
        rect(x * tile, bottom, tile, 5, '#2387c7');
        rect(x * tile, bottom, tile, 4, EDGE);
        rect(x * tile, bottom, tile, 3, '#b47747');
        rect(x * tile, bottom, tile, 1, '#d49b56');
      }
    }
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        if (!land(x, y)) continue;
        const px = x * tile;
        const py = y * tile;
        const rampId = world.rampIds?.[y * world.width + x] ?? -1;
        const grass = terrainAt(world, { x, y }) === 'grass'
          || (rampId >= 0 && world.ramps?.[rampId]?.surface === 'sand');
        const color = grassColor(x, y);
        rect(px, py, tile, tile, grass ? color : '#e7cf85');
        if (grass && !detailed) {
          const value = ((x * 73856093) ^ (y * 19349663) ^ world.seed) & 0x7fffffff;
          const relief = Boolean(world.elevations);
          if (value % 41 === 0) rect(px, py, tile, tile, relief ? adjusted(color, 0.035) : '#8bd04d');
          else if (value % 53 === 0) rect(px, py, tile, tile, relief ? adjusted(color, -0.025) : '#7fc645');
          if (value % 139 === 0 && land(x, y + 1) && land(x + 1, y)) {
            rect(px + 1, py + 2, 2, 1, relief ? adjusted(color, -0.15) : '#68ab3b');
          } else if (value % 173 === 0) {
            rect(px + 2, py + 2, 1, 1, relief ? adjusted(color, 0.15) : '#b1df6b');
          }
        }
        if (detailed) continue;
        const rim = grass ? EDGE : '#cdae63';
        if (!land(x, y - 1)) {
          rect(px, py, tile, 1, rim);
          rect(px + 1, py + 1, tile - 2, 1, grass ? '#bae879' : '#f7e3a2');
        }
        if (!land(x - 1, y)) rect(px, py, 1, tile, rim);
        if (!land(x + 1, y)) rect(px + tile - 1, py, 1, tile, rim);
        if (!land(x, y + 1)) {
          rect(px, py + tile - 1, tile, 1, rim);
          if (!grass) rect(px, py + tile, tile, 1, '#d9f2fb');
        }
      }
    }
    if (world.elevations && detailed) {
      drawIslandGround(context, world);
      const materials = islandMaterials(world);
      drawIslandEdges(context, world, LEVELS, materials);
      this.shoreline = drawIslandShoreline(context, world, materials);
    }
    if (world.elevations) {
      const directions: Point[] = [{ x: 0, y: -1 }, { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
      for (let y = 0; y < world.height; y++) {
        for (let x = 0; x < world.width; x++) {
          const index = y * world.width + x;
          const level = world.elevations[index];
          if (!level || detailed) continue;
          const px = x * tile;
          const py = y * tile;
          for (const direction of directions) {
            const nx = x + direction.x;
            const ny = y + direction.y;
            if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue;
            const neighbor = ny * world.width + nx;
            const lower = world.elevations[neighbor];
            if (lower >= level) continue;
            if (world.rampIds && world.rampIds[index] >= 0 && world.rampIds[index] === world.rampIds[neighbor]) continue;
            if (direction.y === -1) {
              rect(px, py, tile, 1, '#e1edb3');
              rect(px, py - 1, tile, 1, '#536c43');
            } else if (direction.x === -1) {
              rect(px, py, 1, tile, '#5f7d43');
            } else if (direction.x === 1) {
              rect(px + tile - 1, py, 1, tile, '#5f7d43');
            } else {
              const depth = 2 * (level - lower);
              for (let offset = 1; offset <= depth; offset++) {
                const below = y + offset;
                if (below >= world.height || !world.cliffCells?.[below * world.width + x]) continue;
                rect(px, below * tile, tile, tile, offset === 1 ? '#ad9870' : '#8b795d');
                if ((x * 17 + world.seed) % 7 === 0) rect(px + 1, below * tile, 1, tile, '#796b54');
                if (offset === depth) rect(px, below * tile + tile - 1, tile, 1, '#5b6146');
              }
              rect(px, py + tile - 1, tile, 1, '#597444');
              rect(px, py + tile - 2, tile, 1, adjusted(grassColor(x, y), 0.12));
            }
          }
        }
      }
      for (const ramp of world.ramps ?? []) this.drawRamp(context, world, ramp);
    }
    this.texture = this.addTexture('terrain', canvas);
    this.image = this.scene.add.image(-1, -1, this.texture.key).setOrigin(0).setDepth(-9000);
    if (this.shoreline) {
      const water = document.createElement('canvas');
      water.width = world.width * tile;
      water.height = world.height * tile;
      this.shorelineTexture = this.addTexture('shoreline', water);
      this.shorelineImage = this.scene.add.image(0, 0, this.shorelineTexture.key).setOrigin(0).setDepth(-8999);
      this.updateShoreline(this.shorelineSeconds);
    }
  }

  updateShoreline(seconds: number): void {
    this.shorelineSeconds = seconds;
    const frame = Math.floor(seconds * 12);
    if (!this.shoreline || !this.shorelineTexture || frame === this.shorelineFrame) return;
    this.shoreline.drawWater(this.shorelineTexture.context, frame / 12);
    this.shorelineTexture.refresh();
    this.shorelineFrame = frame;
  }

  private drawRamp(context: CanvasRenderingContext2D, world: World, ramp: Ramp): void {
    const { rect, highCell, lowCell, upperLevel, lowerLevel, direction } = ramp;
    const colors = this.inspection ? INSPECTION : LEVELS;
    const dx = lowCell.x - highCell.x;
    const dy = lowCell.y - highCell.y;
    const lengthSquared = dx * dx + dy * dy;
    const tile = world.tileSize;
    if (ramp.surface === 'sand') {
      if (this.islandArtwork && !this.inspection) drawIslandSteps(context, world, ramp);
      else drawSandySteps(context, world, ramp);
    } else {
      for (let y = rect.y; y < rect.y + rect.height; y++) {
        for (let x = rect.x; x < rect.x + rect.width; x++) {
          const progress = lengthSquared === 0 ? 0 : Phaser.Math.Clamp(((x - highCell.x) * dx + (y - highCell.y) * dy) / lengthSquared, 0, 1);
          context.fillStyle = mixed(colors[upperLevel], colors[lowerLevel], progress);
          context.fillRect(x * tile, y * tile, tile, tile);
        }
      }
      const x = rect.x * tile;
      const y = rect.y * tile;
      const width = rect.width * tile;
      const height = rect.height * tile;
      context.fillStyle = '#d2e99a';
      context.fillRect(x, y, direction.x === 0 ? 1 : width, direction.x === 0 ? height : 1);
      context.fillStyle = '#6d9850';
      if (direction.x === 0) context.fillRect(x + width - 1, y, 1, height);
      else context.fillRect(x, y + height - 1, width, 1);
    }
    if (this.inspection) {
      const start = { x: (highCell.x + 0.5) * tile, y: (highCell.y + 0.5) * tile };
      const end = { x: (lowCell.x + 0.5) * tile, y: (lowCell.y + 0.5) * tile };
      const middle = { x: start.x + (end.x - start.x) * 0.35, y: start.y + (end.y - start.y) * 0.35 };
      context.strokeStyle = '#374b42';
      context.lineWidth = 0.8;
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      for (const sign of [-1, 1]) {
        context.moveTo(middle.x, middle.y);
        context.lineTo(middle.x + direction.x * 2 - direction.y * 2 * sign, middle.y + direction.y * 2 + direction.x * 2 * sign);
      }
      context.stroke();
    }
  }

  private redrawNavigation(): void {
    this.overlay?.destroy();
    this.overlayTexture?.destroy();
    this.overlay = undefined;
    this.overlayTexture = undefined;
    const world = this.world;
    if (!world || !this.navigation) return;
    const canvas = document.createElement('canvas');
    canvas.width = world.width * world.tileSize;
    canvas.height = world.height * world.tileSize;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create the navigation overlay.');
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        const kind = terrainAt(world, { x, y });
        const index = y * world.width + x;
        if (this.speeds?.[index] === 0 || kind === 'deep') context.fillStyle = 'rgba(145,49,65,0.22)';
        else if (world.rampIds && world.rampIds[index] >= 0) context.fillStyle = 'rgba(255,230,160,0.55)';
        else if (kind === 'shallow') context.fillStyle = 'rgba(255,230,160,0.28)';
        else context.fillStyle = 'rgba(32,54,48,0.08)';
        context.fillRect(x * world.tileSize, y * world.tileSize, world.tileSize, world.tileSize);
      }
    }
    this.overlayTexture = this.addTexture('navigation', canvas);
    this.overlay = this.scene.add.image(0, 0, this.overlayTexture.key).setOrigin(0).setDepth(-8000);
  }

  private addTexture(key: string, canvas: HTMLCanvasElement): Phaser.Textures.CanvasTexture {
    const texture = this.scene.textures.addCanvas(key, canvas);
    if (!texture) throw new Error(`Could not register ${key} texture.`);
    texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    return texture;
  }

  updateOcean(view: Rectangle): void {
    const stride = Math.max(1, Math.ceil(Math.sqrt(view.width * view.height / (56 * 40 * 1200))));
    const stepX = 56 * stride;
    const stepY = 40 * stride;
    const left = Math.floor(view.x / stepX) - 1;
    const top = Math.floor(view.y / stepY) - 1;
    const right = Math.ceil((view.x + view.width) / stepX) + 1;
    const bottom = Math.ceil((view.y + view.height) / stepY) + 1;
    const region = this.waveRegion;
    if (left === region.left && top === region.top && right === region.right
      && bottom === region.bottom && stride === region.stride) return;
    region.left = left;
    region.top = top;
    region.right = right;
    region.bottom = bottom;
    region.stride = stride;
    this.waves.clear().fillStyle(0x49acf2);
    let count = 0;
    for (let y = top; y <= bottom && count < 1600; y++) {
      for (let x = left; x <= right && count < 1600; x++, count++) {
        const px = x * stepX + (((y * stride) % 2 + 2) % 2 === 0 ? 28 : 0);
        const py = y * stepY;
        this.waves.fillRect(px, py, 4, 1).fillRect(px + 2, py + 1, 4, 1);
      }
    }
  }

  destroy(): void {
    this.shorelineImage?.destroy();
    this.shorelineTexture?.destroy();
    this.image?.destroy();
    this.texture?.destroy();
    this.overlay?.destroy();
    this.overlayTexture?.destroy();
    this.waves.destroy();
  }
}
