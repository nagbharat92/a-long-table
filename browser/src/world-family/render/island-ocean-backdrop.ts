import type { LandCamera, LandProjection } from '../core/landform-study';
import type { SunlitOcean, SunlitOceanFrame } from './island-sun-water';
import type { IslandSun } from './island-sun';
import { createWaterSurfaceResponse } from './island-water-surface';
import { waterWorldPoint } from './island-environment';
import { WATER_MAX_DEPTH } from './island-water-color';
import { projectedWaterColor } from './island-water-projection';
import type { WaterSettings } from './island-water-settings';

interface OceanCamera {
  width: number;
  height: number;
  left: number;
  top: number;
  magnification: number;
  origin: { x: number; y: number };
  projection: LandProjection;
  camera?: LandCamera;
  surfaceSun?: IslandSun;
  surfaceHighlights?: boolean;
  waterSettings?: Readonly<WaterSettings>;
  patches?: Uint8Array;
  colorPatches?: boolean;
  lighting?: boolean;
}

export class IslandOceanBackdrop {
  private readonly context: CanvasRenderingContext2D;
  private ocean?: SunlitOcean;
  private frame?: SunlitOceanFrame;
  private points?: Float64Array;
  private response?: ReturnType<typeof createWaterSurfaceResponse>;
  private highlights = false;
  private waterSettings?: Readonly<WaterSettings>;
  private patches?: Uint8Array;
  private colorPatches = true;
  private lighting = true;
  private image?: ImageData;
  private key = '';
  private left = 0;
  private top = 0;
  private width = 0;
  private height = 0;
  private time = NaN;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create the ocean backdrop canvas.');
    this.context = context;
  }

  hide(): void {
    this.canvas.hidden = true;
  }

  update(ocean: SunlitOcean, camera: OceanCamera, seconds: number): void {
    if (!camera.width || !camera.height) { this.hide(); return; }
    if (![camera.width, camera.height, camera.left, camera.top, camera.magnification].every(Number.isFinite)
      || camera.width < 0 || camera.height < 0 || camera.magnification <= 0) throw new Error('Ocean backdrop requires a valid scene camera.');
    const { magnification: m } = camera;
    let scale = Math.max(1, m, Math.sqrt(camera.width * camera.height / 800000));
    let columns = Math.ceil(camera.width / scale) + 32, rows = Math.ceil(camera.height / scale) + 32;
    while (columns * rows > 2097152) {
      scale *= 2;
      columns = Math.ceil(camera.width / scale) + 32;
      rows = Math.ceil(camera.height / scale) + 32;
    }
    const startX = Math.floor(-camera.left / scale), startY = Math.floor(-camera.top / scale);
    const visibleColumns = Math.ceil(camera.width / scale) + 2, visibleRows = Math.ceil(camera.height / scale) + 2;
    const key = `${m}:${scale}:${camera.origin.x}:${camera.origin.y}:${camera.projection}:${camera.camera?.yaw}:${camera.camera?.center.x}:${camera.camera?.center.y}:${Boolean(camera.surfaceSun)}:${Boolean(camera.surfaceHighlights)}`;
    if (this.ocean !== ocean || this.key !== key || !this.frame
      || this.waterSettings !== camera.waterSettings || this.patches !== camera.patches
      || this.colorPatches !== (camera.colorPatches !== false) || this.lighting !== (camera.lighting !== false)
      || startX < this.left || startY < this.top
      || startX + visibleColumns > this.left + this.width || startY + visibleRows > this.top + this.height) {
      this.left = startX - 16;
      this.top = startY - 16;
      this.width = columns;
      this.height = rows;
      const points = new Float64Array(columns * rows * 2);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < columns; x++) {
          const rasterX = Math.floor((this.left + x + 0.5) * scale / m) + 0.5;
          const rasterY = Math.floor((this.top + y + 0.5) * scale / m) + 0.5;
          const point = waterWorldPoint(rasterX - camera.origin.x, rasterY - camera.origin.y, camera.projection, camera.camera);
          const offset = (y * columns + x) * 2;
          points[offset] = point.x; points[offset + 1] = point.y;
        }
      }
      this.frame = ocean.prepare(points);
      this.points = points;
      this.response = camera.surfaceSun ? createWaterSurfaceResponse(camera.surfaceSun, camera.projection, camera.camera) : undefined;
      this.highlights = Boolean(camera.surfaceHighlights);
      this.waterSettings = camera.waterSettings;
      this.patches = camera.patches;
      this.colorPatches = camera.colorPatches !== false;
      this.lighting = camera.lighting !== false;
      this.ocean = ocean;
      this.key = key;
      this.canvas.width = columns;
      this.canvas.height = rows;
      this.image = this.context.createImageData(columns, rows);
      this.time = NaN;
    }
    this.canvas.hidden = false;
    this.canvas.style.left = `${camera.left + this.left * scale}px`;
    this.canvas.style.top = `${camera.top + this.top * scale}px`;
    this.canvas.style.width = `${this.width * scale}px`;
    this.canvas.style.height = `${this.height * scale}px`;
    this.paint(seconds);
  }

  paint(seconds: number): void {
    if (this.canvas.hidden || !this.frame || !this.image || seconds === this.time) return;
    this.frame.animate(seconds);
    this.image.data.set(this.frame.pixels);
    if (this.points && (this.response || (this.waterSettings && this.patches))) {
      for (let i = 0; i < this.points.length / 2; i++) {
        const offset = i * 4;
        const source = this.highlights ? this.frame.unlitPixels : this.frame.basePixels;
        const x = this.points[i * 2], y = this.points[i * 2 + 1];
        const palette = this.waterSettings && this.patches
          ? projectedWaterColor(WATER_MAX_DEPTH, this.patches, x, y, seconds, this.waterSettings, this.colorPatches)
          : [source[offset], source[offset + 1], source[offset + 2]] as const;
        const body = this.highlights && this.waterSettings
          ? [palette[0] + this.frame.unlitPixels[offset] - this.frame.basePixels[offset],
            palette[1] + this.frame.unlitPixels[offset + 1] - this.frame.basePixels[offset + 1],
            palette[2] + this.frame.unlitPixels[offset + 2] - this.frame.basePixels[offset + 2]] as const : palette;
        const lit = this.lighting ? this.frame.shade(i, body) : body;
        const color = this.response ? this.response(lit, x, y, seconds, 0, this.frame.visibility[i] / 255) : lit;
        this.image.data.set(color, offset);
      }
    }
    this.context.putImageData(this.image, 0, 0);
    this.time = seconds;
    this.canvas.dataset.waterTime = seconds.toFixed(3);
  }
}
