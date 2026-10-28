import { drawGrassPreview, type GrassAppearance } from '../core/grass-appearance';
import { FoliageWindRenderer } from './foliage-wind';

export { FOLIAGE_WIND_PRESETS as GRASS_WIND_PRESETS, type FoliageWind as GrassWind } from './foliage-wind';

export class GrassWindRenderer extends FoliageWindRenderer {
  private readonly source: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement, onError: (cause: unknown) => void, signal: AbortSignal) {
    const source = document.createElement('canvas');
    source.width = canvas.width;
    source.height = canvas.height;
    const context = source.getContext('2d');
    if (!context) throw new Error('Could not open the grass source canvas.');
    super(canvas, onError, signal, { anchor: 33.5, height: 30, response: 1, swayRate: 1, flutter: 0 });
    this.source = source;
    this.context = context;
  }

  setAppearance(appearance: GrassAppearance): void {
    drawGrassPreview(this.context, appearance);
    this.setSprite(this.source, appearance.seed);
  }
}
