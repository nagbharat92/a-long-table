import Phaser from 'phaser';
import type { CharacterMode, DestinationId, Point, Rectangle, World } from '../core/contracts';
import { advanceCharacterAnimation, type GameSimulation } from '../core/game';
import { getWorldBounds, isCoastalCliff, terrainAt } from '../core/world';
import { ActorDrawing, BLINK_TEXTURE, createBushTextures, RABBIT_TEXTURE, SOURCE_PIXEL_SCALE } from './actors';
import { OCEAN, TerrainDrawing } from './terrain';

export interface GameViewOptions {
  mode: DestinationId;
  simulation: GameSimulation;
  onGroundClick?: (point: Point, pointer: { button: number; shiftKey: boolean }) => void;
  onHover?: (point: Point | null) => void;
  onFrame?: () => void;
  onError?: (error: Error) => void;
}

export interface GameView {
  setSimulation(simulation: GameSimulation): void;
  fit(): void;
  zoomBy(multiplier: number): void;
  setInspection(enabled: boolean): void;
  setNavigationOverlay(enabled: boolean): void;
  setCharacterMode(mode: CharacterMode): void;
  setPaused(paused: boolean): void;
  /** Coordinates are CSS pixels relative to the mount, not canvas backing pixels. */
  worldToScreen(point: Point): Point;
  screenToWorld(point: Point): Point;
  /** Zoom is CSS pixels per world unit; scroll is Phaser's world-space camera scroll. */
  getCameraState(): { zoom: number; scrollX: number; scrollY: number };
  destroy(): void;
}

const STEP = 1 / 60;
const MAX_CATCHUP_STEPS = 5;
const STARTUP_TIMEOUT = 30000;
const snapDown = (value: number) => value >= 1 ? Math.floor(value) : 1 / Math.ceil(1 / value);
const snapUp = (value: number) => value >= 1 ? Math.ceil(value) : 1 / Math.max(1, Math.floor(1 / value));

function errorFrom(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function density(): number {
  const value = window.devicePixelRatio;
  if (!Number.isFinite(value) || value <= 0) throw new Error('The display pixel ratio is invalid.');
  return value;
}

function finitePoint(point: Point): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new RangeError('Point coordinates must be finite.');
}

function drawingBounds(world: World): Rectangle {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      if (terrainAt(world, { x, y }) === 'deep') continue;
      left = Math.min(left, x * world.tileSize);
      top = Math.min(top, y * world.tileSize - (world.elevations?.[y * world.width + x] ? 1 : 0));
      right = Math.max(right, (x + 1) * world.tileSize);
      bottom = Math.max(bottom, (y + 1) * world.tileSize + (isCoastalCliff(world, { x, y }) ? 5 : 1));
    }
  }
  if (!Number.isFinite(left)) return getWorldBounds(world);
  return { x: left - 1, y: top - 1, width: right - left + 2, height: bottom - top + 2 };
}

function simulationBounds(simulation: GameSimulation): Rectangle {
  const bounds = drawingBounds(simulation.world);
  let left = Math.min(bounds.x, simulation.character.position.x - 8);
  let top = Math.min(bounds.y, simulation.character.position.y - 21);
  let right = Math.max(bounds.x + bounds.width, simulation.character.position.x + 8);
  let bottom = Math.max(bounds.y + bounds.height, simulation.character.position.y + 3);
  for (const bush of simulation.bushes) {
    left = Math.min(left, bush.position.x - 8);
    top = Math.min(top, bush.position.y - 12);
    right = Math.max(right, bush.position.x + 8);
    bottom = Math.max(bottom, bush.position.y + 2);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function disposeGame(game: Phaser.Game): void {
  let disposed = false;
  game.events.once(Phaser.Core.Events.DESTROY, () => { disposed = true; });
  game.canvas?.remove();
  game.destroy(true, false);
  // A hidden document may never deliver another rAF. Flush the documented game
  // step after the current frame so Phaser can process its pending destruction.
  queueMicrotask(() => {
    if (!disposed) game.step(performance.now(), 0);
  });
}

class ViewController implements GameView {
  private readonly camera: Phaser.Cameras.Scene2D.Camera;
  private readonly terrain?: TerrainDrawing;
  private readonly actors: ActorDrawing;
  private readonly observer: ResizeObserver;
  private simulation: GameSimulation;
  private bounds: Rectangle;
  private characterMode: CharacterMode = 'hop';
  private characterMagnification?: number;
  private paused = false;
  private destroyed = false;
  private hidden = document.hidden;
  private mountVisible = false;
  private following = false;
  private accumulator = 0;
  private frameElapsed = 0;
  private skipDelta = true;
  private cssWidth = 0;
  private cssHeight = 0;
  private dpr = 1;
  private zoom = 1;
  private fitZoom = 1;
  private readonly cameraLayout = { x: NaN, y: NaN, zoom: NaN, width: NaN, height: NaN };
  private dprQuery?: MediaQueryList;
  private lastPointer?: Point;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly container: HTMLElement,
    private readonly options: GameViewOptions,
    private readonly fail: (error: Error) => void,
  ) {
    this.simulation = options.simulation;
    this.bounds = simulationBounds(this.simulation);
    this.camera = scene.cameras.main;
    this.camera.setRoundPixels(false).setBackgroundColor(options.mode === 'character' ? 0xe6ece3 : OCEAN);
    if (options.mode !== 'character') this.terrain = new TerrainDrawing(scene);
    this.actors = new ActorDrawing(scene, options.mode === 'character');
    this.observer = new ResizeObserver((entries) => this.guard(() => {
      const entry = entries.find((candidate) => candidate.target === this.container);
      if (entry) this.resize(entry.contentRect.width, entry.contentRect.height);
    }));
  }

  initialize(): void {
    this.terrain?.setWorld(this.simulation.world, this.simulation.navigation.speeds);
    this.actors.replaceBushes(this.simulation.bushes);
    this.observer.observe(this.container);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('resize', this.onResize);
    window.visualViewport?.addEventListener('resize', this.onResize);
    this.scene.game.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.scene.game.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown);
    this.scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove);
    this.watchDensity();
    this.resize();
    this.draw();
  }

  private guard(action: () => void): void {
    if (this.destroyed) return;
    try {
      action();
    } catch (error) {
      this.fail(errorFrom(error));
    }
  }

  private readonly onResize = () => this.guard(() => this.resize());

  private watchDensity(): void {
    this.dprQuery?.removeEventListener('change', this.onDensity);
    this.dprQuery = window.matchMedia(`(resolution: ${density()}dppx)`);
    this.dprQuery.addEventListener('change', this.onDensity);
  }

  private readonly onDensity = () => this.guard(() => {
    this.watchDensity();
    this.resize();
  });

  private readonly onVisibility = () => this.guard(() => {
    this.hidden = document.hidden;
    this.accumulator = 0;
    this.frameElapsed = 0;
    this.skipDelta = true;
    if (!this.hidden) this.resize();
  });

  private readonly onContextLost = (event: Event) => {
    event.preventDefault();
    this.fail(new Error('The WebGL rendering context was lost. Reopen this view to restore rendering.'));
  };

  private readonly onPointerLeave = () => this.guard(() => {
    this.lastPointer = undefined;
    this.options.onHover?.(null);
  });

  private pointerPoint(pointer: Phaser.Input.Pointer): Point {
    this.scene.scale.updateBounds();
    this.camera.preRender();
    // Phaser 4 applies the complete camera matrix here, including scroll and zoom.
    pointer.updateWorldPoint(this.camera);
    return { x: pointer.worldX, y: pointer.worldY };
  }

  private readonly onPointerDown = (pointer: Phaser.Input.Pointer) => this.guard(() => {
    const point = this.pointerPoint(pointer);
    const event = pointer.event;
    this.options.onGroundClick?.(point, {
      button: pointer.button,
      shiftKey: 'shiftKey' in event && Boolean(event.shiftKey),
    });
  });

  private readonly onPointerMove = (pointer: Phaser.Input.Pointer) => this.guard(() => {
    this.lastPointer = { x: pointer.x, y: pointer.y };
    this.options.onHover?.(this.pointerPoint(pointer));
  });

  private resize(contentWidth?: number, contentHeight?: number): void {
    const style = getComputedStyle(this.container);
    const bounds = this.container.getBoundingClientRect();
    const width = contentWidth ?? bounds.width - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth)
      - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const height = contentHeight ?? bounds.height - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth)
      - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const nextDpr = density();
    // Hidden mounts keep their last valid camera, never a synthetic one-pixel fit.
    if (width <= 0 || height <= 0) {
      this.mountVisible = false;
      this.skipDelta = true;
      this.accumulator = 0;
      return;
    }
    if (!this.mountVisible) this.skipDelta = true;
    this.mountVisible = true;
    if (width === this.cssWidth && height === this.cssHeight && nextDpr === this.dpr) return;
    const oldDpr = this.dpr;
    this.cssWidth = width;
    this.cssHeight = height;
    this.dpr = nextDpr;
    const backingWidth = Math.max(1, Math.round(width * nextDpr));
    const backingHeight = Math.max(1, Math.round(height * nextDpr));
    const canvas = this.scene.game.canvas;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    this.scene.scale.resize(backingWidth, backingHeight);
    // ScaleManager NONE uses backing pixels. CSS sizing is intentionally independent.
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    this.scene.scale.refresh();
    this.camera.setSize(backingWidth, backingHeight);
    this.zoom = snapDown(this.zoom / oldDpr * nextDpr);
    this.layoutCamera();
    this.skipDelta = true;
    this.accumulator = 0;
  }

  private layoutCamera(): void {
    if (!this.cssWidth || !this.cssHeight) return;
    if (this.options.mode === 'character') {
      const availableWidth = Math.max(1, this.camera.width - 32 * this.dpr);
      const availableHeight = Math.max(1, this.camera.height - 32 * this.dpr);
      const sourceMagnification = Math.max(1, Math.floor(Math.min(
        availableWidth / (18 * 1.15),
        availableHeight / (19 * (1 / SOURCE_PIXEL_SCALE)),
      )));
      this.fitZoom = sourceMagnification / SOURCE_PIXEL_SCALE;
      const magnification = this.characterMagnification === undefined
        ? sourceMagnification
        : Phaser.Math.Clamp(this.characterMagnification, 1, sourceMagnification);
      this.zoom = magnification / SOURCE_PIXEL_SCALE;
    } else {
      const margin = Math.min(24 * this.dpr, this.camera.width * 0.05, this.camera.height * 0.05);
      const fit = Math.min(
        Math.max(1, this.camera.width - margin * 2) / this.bounds.width,
        Math.max(1, this.camera.height - margin * 2) / this.bounds.height,
      );
      this.fitZoom = snapDown(fit);
      this.zoom = this.following
        ? Phaser.Math.Clamp(this.zoom, this.fitZoom, Math.max(this.fitZoom, Math.floor(32 * this.dpr)))
        : this.fitZoom;
      this.following = this.zoom > this.fitZoom;
    }
    this.camera.setZoom(this.zoom);
    this.positionCamera();
  }

  private positionCamera(): void {
    let x: number;
    let y: number;
    if (this.options.mode === 'character') {
      const foot = this.simulation.character.position;
      x = foot.x;
      y = foot.y - 6;
    } else if (this.following) {
      x = this.simulation.character.position.x;
      y = this.simulation.character.position.y;
    } else {
      x = this.bounds.x + this.bounds.width / 2;
      y = this.bounds.y + this.bounds.height / 2;
    }
    const layout = this.cameraLayout;
    if (layout.x === x && layout.y === y && layout.zoom === this.zoom
      && layout.width === this.camera.width && layout.height === this.camera.height) return;
    layout.x = x;
    layout.y = y;
    layout.zoom = this.zoom;
    layout.width = this.camera.width;
    layout.height = this.camera.height;
    this.camera.centerOn(x, y);
    this.camera.preRender();
    this.terrain?.updateOcean(this.camera.worldView);
  }

  update(deltaMilliseconds: number): void {
    this.guard(() => {
      if (this.dpr !== density()) this.resize();
      const skip = this.skipDelta;
      this.skipDelta = false;
      if (!this.paused && !this.hidden && this.mountVisible && !skip) {
        const delta = Math.min(Math.max(0, deltaMilliseconds / 1000), STEP * MAX_CATCHUP_STEPS);
        this.accumulator = Math.min(this.accumulator + delta, STEP * MAX_CATCHUP_STEPS);
        // Discard excess wall time; never replay a background tab's elapsed time.
        for (let step = 0; step < MAX_CATCHUP_STEPS && this.accumulator + 1e-10 >= STEP; step++) {
          if (this.options.mode === 'character') {
            const speed = this.characterMode === 'idle' ? 0 : this.characterMode === 'shallows' ? 9.9 : 22;
            advanceCharacterAnimation(this.simulation.character, STEP, speed * STEP, { x: 1, y: 0 }, speed > 0);
          } else {
            this.simulation.advance(STEP);
          }
          this.accumulator = Math.max(0, this.accumulator - STEP);
        }
      } else {
        this.accumulator = 0;
      }
      if (!this.hidden && this.mountVisible) this.draw();
      this.frameElapsed += Math.min(Math.max(deltaMilliseconds / 1000, 0), 0.1);
      if (!this.hidden && this.frameElapsed >= 0.1) {
        this.frameElapsed %= 0.1;
        if (this.lastPointer) {
          this.options.onHover?.(this.camera.getWorldPoint(this.lastPointer.x, this.lastPointer.y));
        }
        this.options.onFrame?.();
      }
    });
  }

  private draw(): void {
    this.positionCamera();
    this.actors.render(this.simulation.character, this.simulation.bushes, this.zoom / this.dpr);
  }

  setSimulation(simulation: GameSimulation): void {
    this.assertAlive();
    this.simulation = simulation;
    this.bounds = simulationBounds(simulation);
    this.accumulator = 0;
    this.skipDelta = true;
    this.lastPointer = undefined;
    this.terrain?.setWorld(simulation.world, simulation.navigation.speeds);
    this.actors.replaceBushes(simulation.bushes);
    this.fit();
    this.options.onHover?.(null);
  }

  fit(): void {
    this.assertAlive();
    this.following = false;
    this.characterMagnification = undefined;
    this.layoutCamera();
    this.draw();
  }

  zoomBy(multiplier: number): void {
    this.assertAlive();
    if (!Number.isFinite(multiplier) || multiplier <= 0) throw new RangeError('Zoom multiplier must be finite and positive.');
    if (multiplier === 1) return;
    if (this.options.mode === 'character') {
      const current = this.zoom * SOURCE_PIXEL_SCALE;
      const target = multiplier > 1 ? Math.ceil(current * multiplier) : Math.floor(current * multiplier);
      this.characterMagnification = Phaser.Math.Clamp(target, 1, Math.round(this.fitZoom * SOURCE_PIXEL_SCALE));
      this.zoom = this.characterMagnification / SOURCE_PIXEL_SCALE;
      this.camera.setZoom(this.zoom);
      this.draw();
      return;
    }
    const target = this.zoom * multiplier;
    this.zoom = Phaser.Math.Clamp(multiplier > 1 ? snapUp(target) : snapDown(target),
      this.fitZoom, Math.max(this.fitZoom, Math.floor(32 * this.dpr)));
    this.following = this.zoom > this.fitZoom;
    this.camera.setZoom(this.zoom);
    this.draw();
  }

  setInspection(enabled: boolean): void {
    this.assertAlive();
    this.terrain?.setInspection(enabled);
  }

  setNavigationOverlay(enabled: boolean): void {
    this.assertAlive();
    this.terrain?.setNavigationOverlay(enabled);
  }

  setCharacterMode(mode: CharacterMode): void {
    this.assertAlive();
    this.characterMode = mode;
  }

  setPaused(paused: boolean): void {
    this.assertAlive();
    this.paused = paused;
    this.accumulator = 0;
    this.skipDelta = true;
  }

  worldToScreen(point: Point): Point {
    this.assertAlive();
    finitePoint(point);
    this.camera.preRender();
    const transformed = this.camera.matrixCombined.transformPoint(point.x, point.y);
    return {
      x: transformed.x * this.cssWidth / this.camera.width,
      y: transformed.y * this.cssHeight / this.camera.height,
    };
  }

  screenToWorld(point: Point): Point {
    this.assertAlive();
    finitePoint(point);
    if (!this.cssWidth || !this.cssHeight) throw new Error('The game mount has no visible size.');
    this.camera.preRender();
    const transformed = this.camera.getWorldPoint(point.x * this.camera.width / this.cssWidth, point.y * this.camera.height / this.cssHeight);
    return { x: transformed.x, y: transformed.y };
  }

  getCameraState(): { zoom: number; scrollX: number; scrollY: number } {
    this.assertAlive();
    return { zoom: this.zoom / this.dpr, scrollX: this.camera.scrollX, scrollY: this.camera.scrollY };
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error('This game view has been destroyed.');
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.observer.disconnect();
    this.dprQuery?.removeEventListener('change', this.onDensity);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('resize', this.onResize);
    window.visualViewport?.removeEventListener('resize', this.onResize);
    this.scene.game.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.scene.game.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown);
    this.scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove);
    this.actors.destroy();
    this.terrain?.destroy();
    disposeGame(this.scene.game);
  }
}

export async function createGameView(container: HTMLElement, options: GameViewOptions): Promise<GameView> {
  if (container.querySelector('canvas')) throw new Error('The game mount already contains a canvas.');
  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  canvas.style.imageRendering = 'pixelated';
  canvas.style.touchAction = 'none';
  canvas.setAttribute('aria-label', options.mode === 'character' ? 'Animated pixel-art rabbit' : 'Interactive island');
  const context = canvas.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: true });
  if (!context) {
    const error = new Error('WebGL is required for this view. No alternate rendering backend was started.');
    options.onError?.(error);
    throw error;
  }
  return new Promise<GameView>((resolve, reject) => {
    let game: Phaser.Game | undefined;
    let controller: ViewController | undefined;
    let settled = false;
    let failed = false;
    const timer = window.setTimeout(() => fail(new Error('The Phaser scene or its character assets did not become ready within 30 seconds.')), STARTUP_TIMEOUT);
    const fail = (error: Error) => {
      if (failed) return;
      failed = true;
      window.clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
      try {
        if (controller) controller.destroy();
        else {
          if (game) disposeGame(game);
          canvas.remove();
        }
      } catch (cleanupError) {
        console.error('Could not fully release the failed game view:', cleanupError);
      }
      if (options.onError) options.onError(error);
      else console.error('Game rendering failed:', error);
    };
    class GameScene extends Phaser.Scene {
      constructor() {
        super('game-view');
      }

      preload(): void {
        this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) =>
          fail(new Error(`Could not load character asset: ${file.key}.`)));
        this.load.image(RABBIT_TEXTURE, `${import.meta.env.BASE_URL}assets/rabbit.png`);
        this.load.image(BLINK_TEXTURE, `${import.meta.env.BASE_URL}assets/rabbit-blink.png`);
      }

      create(): void {
        if (failed) return;
        try {
          if (this.game.renderer.type !== Phaser.WEBGL) throw new Error('Phaser did not start the required WebGL backend.');
          for (const key of [RABBIT_TEXTURE, BLINK_TEXTURE]) {
            if (!this.textures.exists(key)) throw new Error(`The ${key} character asset is missing.`);
            const frame = this.textures.getFrame(key);
            if (frame.width !== 18 || frame.height !== 29) throw new Error(`The ${key} source must be the approved 18 by 29 pixel PNG.`);
            this.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
          }
          createBushTextures(this);
          controller = new ViewController(this, container, options, fail);
          controller.initialize();
          window.clearTimeout(timer);
          settled = true;
          resolve(controller);
        } catch (error) {
          fail(errorFrom(error));
        }
      }

      update(_time: number, delta: number): void {
        controller?.update(delta);
      }
    }
    try {
      game = new Phaser.Game({
        type: Phaser.WEBGL,
        parent: container,
        canvas,
        width: Math.max(1, Math.round(container.clientWidth * density())),
        height: Math.max(1, Math.round(container.clientHeight * density())),
        backgroundColor: OCEAN,
        // Phaser 4's pixelArt flag forces roundPixels, distorting scaled vertices.
        render: { pixelArt: false, roundPixels: false, antialias: false, antialiasGL: false },
        scale: { mode: Phaser.Scale.NONE, autoRound: false },
        audio: { noAudio: true },
        input: { mouse: { preventDefaultWheel: false }, keyboard: false },
        callbacks: { preBoot: (instance) => { game = instance; } },
        scene: [new GameScene()],
        banner: false,
      });
    } catch (error) {
      fail(errorFrom(error));
    }
  });
}
