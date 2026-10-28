import { berryPositions, CROP_MATURITIES, type BushAppearance } from './bush-appearance';

export const BERRY_STAGES = ['picked', 'bud', 'green', 'turning', 'ripe', 'sweet'] as const;
export type BerryStage = typeof BERRY_STAGES[number];
export interface BerryFruit {
  x: number;
  y: number;
  age: number;
  speed: number;
  stage: BerryStage;
}

const GATHER_SECONDS = 0.8;
const MAX_AGE = 28;
export const stageAt = (age: number): BerryStage =>
  age < 0 ? 'picked' : age < 5 ? 'bud' : age < 11 ? 'green' : age < 17 ? 'turning' : age < 23 ? 'ripe' : 'sweet';
export const berryValue = (stage: BerryStage): number => stage === 'sweet' ? 2 : stage === 'ripe' ? 1 : 0;

/** Explorer-only crop model. The island's three-berry gameplay contract stays unchanged. */
export class BushCrop {
  readonly fruits: BerryFruit[];
  collected = 0;
  value = 0;
  elapsed = 0;
  gathering = false;
  gatherElapsed = 0;
  feedback = '';

  constructor(appearance: BushAppearance) {
    if (!CROP_MATURITIES[appearance.maturity]) throw new RangeError('Unknown crop maturity.');
    this.fruits = berryPositions(appearance).map((point, index) => {
      const age = appearance.maturity === 0 ? point.maturity * 15
        : appearance.maturity === 2 ? 17 + point.maturity * 11
        : index < 3 ? [7, 18, 25][index] : point.maturity * 28;
      return { x: point.x, y: point.y, age, speed: 0.8 + point.maturity * 0.4, stage: stageAt(age) };
    });
  }

  get available(): number { return this.fruits.filter(fruit => berryValue(fruit.stage) > 0).length; }
  get availableValue(): number { return this.fruits.reduce((sum, fruit) => sum + berryValue(fruit.stage), 0); }
  get nextRipe(): number | null {
    const waiting = this.fruits.filter(fruit => berryValue(fruit.stage) === 0);
    return waiting.length ? Math.min(...waiting.map(fruit => (17 - fruit.age) / fruit.speed)) : null;
  }
  get progress(): number { return this.gatherElapsed / GATHER_SECONDS; }

  gather(): void {
    if (this.gathering) return;
    if (!this.available) {
      this.feedback = 'No ripe berries yet';
      return;
    }
    this.gathering = true;
    this.gatherElapsed = 0;
    this.feedback = 'Gathering ripe berries';
  }

  cancel(): void {
    if (this.gathering) this.feedback = 'Gathering interrupted';
    this.gathering = false;
    this.gatherElapsed = 0;
  }

  setState(state: 'ripe' | 'depleted' | 'growing'): void {
    this.cancel();
    this.fruits.forEach(fruit => {
      fruit.age = state === 'ripe' ? MAX_AGE : state === 'depleted' ? -7 : 0;
      fruit.stage = stageAt(fruit.age);
    });
    this.feedback = '';
  }

  advance(delta: number): void {
    if (!Number.isFinite(delta) || delta < 0) throw new RangeError('Time step must be finite and non-negative.');
    if (this.gathering && delta + this.gatherElapsed >= GATHER_SECONDS - 1e-9) {
      const before = Math.max(0, GATHER_SECONDS - this.gatherElapsed);
      this.grow(before);
      let picked = 0;
      let value = 0;
      for (const fruit of this.fruits) {
        const worth = berryValue(fruit.stage);
        if (!worth) continue;
        picked++;
        value += worth;
        fruit.age = -7;
        fruit.stage = 'picked';
      }
      this.collected += picked;
      this.value += value;
      this.gathering = false;
      this.gatherElapsed = 0;
      this.feedback = `Collected ${picked} ${picked === 1 ? 'berry' : 'berries'} · ${value} value`;
      this.grow(Math.max(0, delta - before));
    } else {
      this.grow(delta);
      if (this.gathering) this.gatherElapsed += delta;
    }
    this.elapsed += delta;
  }

  private grow(delta: number): void {
    for (const fruit of this.fruits) {
      fruit.age = Math.min(MAX_AGE, fruit.age + delta * fruit.speed);
      fruit.stage = stageAt(fruit.age);
    }
  }
}
