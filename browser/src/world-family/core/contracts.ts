export interface Point {
  x: number;
  y: number;
}

export interface Rectangle extends Point {
  width: number;
  height: number;
}

export type TerrainKind = 'deep' | 'shallow' | 'sand' | 'grass';
export type DestinationId = 'play' | 'island' | 'character' | 'foraging' | 'navigation';
export type CharacterMode = 'idle' | 'hop' | 'shallows' | 'walk';

export interface Ramp {
  surface?: 'sand';
  rect: Rectangle;
  upperLevel: number;
  lowerLevel: number;
  direction: Point;
  highCell: Point;
  lowCell: Point;
}

export interface World {
  seed: number;
  generatorVersion: string;
  width: number;
  height: number;
  tileSize: number;
  seaLevel: number;
  heights: Float32Array;
  cells: Uint8Array;
  provenance: 'captured-reference' | 'browser-generated' | 'test-fixture';
  elevations?: Uint8Array;
  cliffCells?: Uint8Array;
  rampIds?: Int32Array;
  ramps?: Ramp[];
}

export interface CharacterState {
  position: Point;
  direction: Point;
  route: Point[];
  routeIndex: number;
  selected: boolean;
  gaitDistance: number;
  animationTime: number;
  motionWeight: number;
  facing: number;
  facingDirection: -1 | 1;
  hop: {
    phase: number;
    speed: number;
    active: boolean;
  };
}

export interface CharacterPose {
  hop: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  blink: boolean;
}

export type BushPhase = 'ripe' | 'depleted' | 'growing';

export interface BushState {
  id: string;
  position: Point;
  state: BushPhase;
  regrowElapsed: number;
  targeted: boolean;
  hovered: boolean;
  gatherProgress: number;
}

export interface GatherJob {
  bushId: string;
  destination: Point;
  elapsed: number;
  started: boolean;
}

export interface NavigationApi {
  readonly world: World;
  readonly speeds: Float32Array;
  spawnPosition(): Point;
  speedAt(point: Point): number;
  canReach(from: Point, to: Point): boolean;
  canStep(fromCell: Point, toCell: Point): boolean;
  segmentClear(from: Point, to: Point, sameSpeed?: boolean): boolean;
  route(from: Point, requested: Point): Point[];
}
