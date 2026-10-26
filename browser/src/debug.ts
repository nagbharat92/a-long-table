import type { DestinationId, World } from './core/contracts';
import type { GameSimulation } from './core/game';
import type { GameView } from './render/game-view';

export interface RuntimeDebug {
  ready: boolean;
  mode: DestinationId;
  world: World;
  simulation: GameSimulation;
  view: GameView;
}

declare global {
  interface Window {
    __longTable?: RuntimeDebug;
  }
}
