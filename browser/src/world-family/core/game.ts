import type {
  BushPhase,
  BushState,
  CharacterPose,
  CharacterState,
  GatherJob,
  NavigationApi,
  Point,
  World,
} from './contracts';
import { cellCenter, terrainAt } from './world';
import { HOP_DISTANCE, HOP_TAKEOFF_PHASE, motionSourceBounds, sampleRabbitMotion } from './character-motion';
import { dampedMotion } from './motion-clock';

const MOVE_SPEED = 22;
const INTEGRATION_STEP = 0.01;
const APPROACH_DISTANCE = 8;
const GATHER_SECONDS = 0.8;
const REGROW_SECONDS = 20;
const GROWING_SECONDS = 7;
const EPSILON = 1e-9;

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function samePoint(a: Point, b: Point): boolean {
  return distance(a, b) <= EPSILON;
}

function checkPoint(point: Point): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RangeError('Point coordinates must be finite.');
  }
}

function checkDelta(delta: number): void {
  if (!Number.isFinite(delta) || delta < 0) {
    throw new RangeError('Simulation delta must be finite and non-negative.');
  }
}

function checkZoom(zoom: number): void {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    throw new RangeError('Zoom must be finite and positive.');
  }
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function createCharacter(position: Point, selected = false): CharacterState {
  checkPoint(position);
  return {
    position: { ...position },
    direction: { x: 0, y: 0 },
    route: [],
    routeIndex: 0,
    selected,
    gaitDistance: 0,
    animationTime: 0,
    motionWeight: 0,
    facing: 0,
    facingDirection: 1,
    hop: { phase: 0, speed: 0, active: false },
  };
}

export function advanceCharacterAnimation(
  character: CharacterState,
  delta: number,
  travelled: number,
  direction: Point,
  moving: boolean,
): void {
  checkDelta(delta);
  checkPoint(direction);
  if (!Number.isFinite(travelled) || travelled < 0) {
    throw new RangeError('Travel distance must be finite and non-negative.');
  }
  if (delta === 0) {
    if (travelled > 0) throw new RangeError('Travel distance needs a positive animation delta.');
    return;
  }
  const hop = character.hop;
  if (!hop || !Number.isFinite(hop.phase) || hop.phase < 0 || hop.phase >= 1
    || !Number.isFinite(hop.speed) || hop.speed < 0 || typeof hop.active !== 'boolean') {
    throw new RangeError('The character hop clock is invalid.');
  }
  if (!moving && travelled === 0 && hop.active && hop.phase >= HOP_TAKEOFF_PHASE && hop.speed === 0) {
    throw new RangeError('An airborne hop must have a positive cadence.');
  }
  character.animationTime += delta;
  character.gaitDistance += travelled;
  // Keep the last heading at rest, on vertical routes and below visible horizontal speed.
  if (travelled > 0 && Math.abs(direction.x * travelled / delta) > 0.05) {
    character.facingDirection = direction.x < 0 ? -1 : 1;
  }
  const blendPose = (seconds: number, weight: number, facing: number): void => {
    const blend = -Math.expm1(-seconds * 10);
    character.motionWeight += (weight - character.motionWeight) * blend;
    character.facing += (facing - character.facing) * blend;
  };
  if (moving || travelled > 0) {
    const cadence = dampedMotion(hop.speed, travelled / delta, delta, 8);
    hop.phase = (hop.phase + cadence.integral / HOP_DISTANCE) % 1;
    hop.speed = cadence.value;
    hop.active = true;
    blendPose(delta, 1, direction.x);
    character.direction = { ...direction };
  } else if (hop.active && hop.phase >= HOP_TAKEOFF_PHASE) {
    // Finish the existing flight and recovery, rather than fading a frozen midair pose.
    const remaining = (1 - hop.phase) * HOP_DISTANCE / hop.speed;
    const finish = Math.min(delta, remaining);
    blendPose(finish, 1, character.direction.x);
    if (delta < remaining) {
      hop.phase += delta * hop.speed / HOP_DISTANCE;
    } else {
      hop.phase = 0;
      hop.active = false;
      hop.speed = dampedMotion(hop.speed, 0, delta - finish, 8).value;
      blendPose(delta - finish, 0, 0);
    }
  } else {
    hop.active = false;
    hop.phase *= Math.exp(-delta * 10);
    hop.speed = dampedMotion(hop.speed, 0, delta, 8).value;
    blendPose(delta, 0, 0);
  }
}

export function characterPose(character: CharacterState): CharacterPose {
  return sampleRabbitMotion(character).summary;
}

export class GameSimulation {
  character: CharacterState;
  bushes: BushState[] = [];
  berries = 0;
  feedback = '';
  job: GatherJob | null = null;
  tick = 0;
  elapsed = 0;
  private feedbackRemaining = 0;

  constructor(
    readonly world: World,
    readonly navigation: NavigationApi,
    options: { foraging?: boolean; autoSelect?: boolean } = {},
  ) {
    this.character = createCharacter(navigation.spawnPosition(), options.autoSelect ?? false);
    if (options.foraging ?? true) this.placeBushes();
  }

  get activity(): string {
    if (this.job) return this.job.started ? 'Gathering berries...' : 'Walking to berries';
    return this.feedback;
  }

  select(value: boolean): void {
    this.character.selected = value;
  }

  click(point: Point, zoom: number): void {
    checkPoint(point);
    checkZoom(zoom);
    const characterHit = this.characterHitTest(point, zoom);
    const bush = this.character.selected ? this.bushAt(point, zoom) : undefined;
    // Enlarged hit targets overlap at gathering distance; prefer the closer visual center.
    if (
      characterHit &&
      (!bush ||
        distance(point, { x: this.character.position.x, y: this.character.position.y - 4 }) <=
          distance(point, { x: bush.position.x, y: bush.position.y - 4.5 }))
    ) {
      this.select(true);
    } else if (this.character.selected) {
      if (bush) this.gather(bush.id);
      else this.moveTo(point);
    }
  }

  bushAt(point: Point, zoom: number): BushState | undefined {
    checkPoint(point);
    checkZoom(zoom);
    let closest: BushState | undefined;
    let bestDistance = Infinity;
    for (const bush of this.bushes) {
      const center = { x: bush.position.x, y: bush.position.y - 4.5 };
      const width = Math.max(14, 24 / zoom);
      const height = Math.max(13, 24 / zoom);
      const nextDistance = distance(point, center);
      if (
        point.x >= center.x - width / 2 &&
        point.x < center.x + width / 2 &&
        point.y >= center.y - height / 2 &&
        point.y < center.y + height / 2 &&
        nextDistance < bestDistance
      ) {
        closest = bush;
        bestDistance = nextDistance;
      }
    }
    return closest;
  }

  characterHitTest(point: Point, zoom: number): boolean {
    checkPoint(point);
    checkZoom(zoom);
    const pose = sampleRabbitMotion(this.character);
    const bounds = motionSourceBounds(pose);
    let minX = (bounds.x - 9) * 12 / 29;
    let minY = (bounds.y - 29) * 12 / 29 - pose.hop;
    let maxX = (bounds.x + bounds.width - 9) * 12 / 29;
    let maxY = (bounds.y + bounds.height - 29) * 12 / 29 - pose.hop;
    const radius = Math.max(1.5, 3 / zoom);
    const markerY = -15 - radius - 2 / zoom + Math.sin(this.character.animationTime * 2.5) * 0.45;
    minX = Math.min(minX, -radius) - 0.5;
    maxX = Math.max(maxX, radius) + 0.5;
    minY = Math.min(minY, markerY - radius) - 0.5;
    maxY = Math.max(maxY, markerY + radius) + 0.5;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const width = Math.max(maxX - minX, 24 / zoom);
    const height = Math.max(maxY - minY, 24 / zoom);
    const x = point.x - this.character.position.x;
    const y = point.y - this.character.position.y;
    return (
      x >= centerX - width / 2 &&
      x < centerX + width / 2 &&
      y >= centerY - height / 2 &&
      y < centerY + height / 2
    );
  }

  moveTo(point: Point): void {
    checkPoint(point);
    this.cancelGather();
    this.clearFeedback();
    this.setRoute(this.navigation.route(this.character.position, point));
    if (this.character.route.length === 0 && !samePoint(this.character.position, point)) {
      this.setFeedback("Can't reach that point");
    }
  }

  gather(bushId: string): boolean {
    if (this.job?.bushId === bushId) return true;
    this.cancelGather();
    this.stopMovement();
    const bush = this.bushes.find((candidate) => candidate.id === bushId);
    if (!bush) {
      this.setFeedback("Can't reach this bush");
      return false;
    }
    if (bush.state !== 'ripe') {
      this.setFeedback('Berries are regrowing');
      return false;
    }
    let destination: Point | undefined;
    let bestRoute: Point[] = [];
    let bestCost = Infinity;
    for (let index = 0; index < 8; index += 1) {
      const angle = (index * Math.PI * 2) / 8;
      const point = {
        x: bush.position.x + Math.cos(angle) * APPROACH_DISTANCE,
        y: bush.position.y + Math.sin(angle) * APPROACH_DISTANCE,
      };
      if (
        this.navigation.speedAt(point) !== 1 ||
        !this.navigation.canReach(this.character.position, point) ||
        !this.navigation.segmentClear(point, bush.position)
      ) {
        continue;
      }
      const route = this.navigation.route(this.character.position, point);
      const end = route.at(-1);
      if (!end || !samePoint(end, point)) continue;
      let cost = 0;
      for (let step = 1; step < route.length; step += 1) {
        cost += distance(route[step - 1], route[step]);
      }
      if (cost < bestCost) {
        bestCost = cost;
        bestRoute = route;
        destination = point;
      }
    }
    if (!destination) {
      this.setFeedback("Can't reach this bush");
      return false;
    }
    this.clearFeedback();
    this.job = { bushId, destination, elapsed: 0, started: false };
    bush.targeted = true;
    this.setRoute(bestRoute);
    return true;
  }

  cancelGather(): void {
    if (!this.job) return;
    const bush = this.bushes.find((candidate) => candidate.id === this.job?.bushId);
    if (bush) {
      bush.targeted = false;
      bush.gatherProgress = 0;
    }
    this.job = null;
  }

  setBushState(bushId: string, state: BushPhase): void {
    const bush = this.bushes.find((candidate) => candidate.id === bushId);
    if (!bush) throw new RangeError(`Unknown bush: ${bushId}`);
    if (this.job?.bushId === bushId) this.cancelGather();
    bush.state = state;
    bush.regrowElapsed = state === 'growing' ? GROWING_SECONDS : 0;
    bush.targeted = false;
    bush.gatherProgress = 0;
  }

  advance(delta: number): void {
    checkDelta(delta);
    if (delta === 0) return;
    this.tick += 1;
    this.elapsed += delta;
    let remaining = delta;
    while (remaining > 0) {
      const step = Math.min(remaining, INTEGRATION_STEP);
      this.advanceStep(step);
      remaining = Math.max(0, remaining - step);
    }
  }

  private advanceStep(delta: number): void {
    this.advanceFeedback(delta);
    for (const bush of this.bushes) this.advanceBush(bush, delta);
    this.checkJob();
    const idleTime = this.advanceMovement(delta);
    this.checkJob();
    const job = this.job;
    if (!job || this.isMoving()) return;
    const bush = this.bushes.find((candidate) => candidate.id === job.bushId);
    if (!bush) return;
    job.started = true;
    job.elapsed += idleTime;
    bush.gatherProgress = Math.min(job.elapsed / GATHER_SECONDS, 1);
    if (job.elapsed + EPSILON < GATHER_SECONDS) return;
    const afterHarvest = Math.max(0, job.elapsed - GATHER_SECONDS);
    bush.state = 'depleted';
    bush.regrowElapsed = 0;
    bush.targeted = false;
    bush.gatherProgress = 0;
    this.berries += 3;
    this.job = null;
    this.advanceBush(bush, afterHarvest);
    this.setFeedback('Gathered 3 berries');
    this.advanceFeedback(afterHarvest);
  }

  private checkJob(): void {
    const job = this.job;
    if (!job) return;
    const bush = this.bushes.find((candidate) => candidate.id === job.bushId);
    if (!bush || bush.state !== 'ripe') {
      this.cancelGather();
      this.setFeedback(bush ? 'Berries are regrowing' : 'Gathering interrupted');
      return;
    }
    if (this.isMoving()) {
      const destination = this.character.route.at(-1);
      if (!destination || !samePoint(destination, job.destination)) this.cancelGather();
    } else if (
      !samePoint(this.character.position, job.destination) ||
      distance(this.character.position, bush.position) > APPROACH_DISTANCE + 0.1 ||
      !this.navigation.segmentClear(this.character.position, bush.position)
    ) {
      this.cancelGather();
      this.setFeedback('Gathering interrupted');
    }
  }

  private advanceMovement(delta: number): number {
    let remaining = delta;
    let travelled = 0;
    while (this.isMoving() && remaining > 0) {
      const target = this.character.route[this.character.routeIndex];
      const length = distance(this.character.position, target);
      if (length <= EPSILON) {
        this.character.position = { ...target };
        this.character.routeIndex += 1;
        continue;
      }
      const speed = MOVE_SPEED * this.navigation.speedAt(this.character.position);
      if (!Number.isFinite(speed) || speed <= 0) {
        this.stopMovement();
        this.cancelGather();
        this.setFeedback('Character reached blocked terrain');
        break;
      }
      const travel = length <= speed * remaining + EPSILON ? length : speed * remaining;
      const direction = {
        x: (target.x - this.character.position.x) / length,
        y: (target.y - this.character.position.y) / length,
      };
      this.character.direction = direction;
      this.character.position = {
        x: this.character.position.x + direction.x * travel,
        y: this.character.position.y + direction.y * travel,
      };
      travelled += travel;
      remaining = Math.max(0, remaining - travel / speed);
      if (travel >= length) {
        this.character.position = { ...target };
        this.character.routeIndex += 1;
      }
    }
    if (!this.isMoving()) this.stopMovement();
    advanceCharacterAnimation(
      this.character,
      delta,
      travelled,
      this.character.direction,
      this.isMoving(),
    );
    return remaining;
  }

  private isMoving(): boolean {
    return this.character.routeIndex < this.character.route.length;
  }

  private setRoute(route: Point[]): void {
    this.character.route = route.map((point) => ({ ...point }));
    this.character.routeIndex = route.length > 1 ? 1 : 0;
  }

  private stopMovement(): void {
    this.character.route = [];
    this.character.routeIndex = 0;
  }

  private advanceBush(bush: BushState, delta: number): void {
    if (bush.state === 'ripe') return;
    bush.regrowElapsed = Math.min(REGROW_SECONDS, bush.regrowElapsed + delta);
    if (bush.regrowElapsed + EPSILON >= REGROW_SECONDS) {
      bush.regrowElapsed = REGROW_SECONDS;
      bush.state = 'ripe';
    } else {
      bush.state = bush.regrowElapsed + EPSILON >= GROWING_SECONDS ? 'growing' : 'depleted';
    }
  }

  private setFeedback(message: string): void {
    this.feedback = message;
    this.feedbackRemaining = 3;
  }

  private clearFeedback(): void {
    this.feedback = '';
    this.feedbackRemaining = 0;
  }

  private advanceFeedback(delta: number): void {
    if (this.feedbackRemaining <= 0) return;
    this.feedbackRemaining = Math.max(0, this.feedbackRemaining - delta);
    if (this.feedbackRemaining <= EPSILON) this.clearFeedback();
  }

  private placeBushes(): void {
    const { width, height, cliffCells } = this.world;
    const spawn = this.character.position;
    const candidates: Point[] = [];
    for (let y = 2; y < height - 2; y += 1) {
      for (let x = 2; x < width - 2; x += 1) {
        let suitable = true;
        for (let dy = -2; dy <= 2 && suitable; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) {
            const index = (y + dy) * width + x + dx;
            if (
              terrainAt(this.world, { x: x + dx, y: y + dy }) !== 'grass' ||
              (cliffCells && cliffCells[index] !== 0)
            ) {
              suitable = false;
              break;
            }
          }
        }
        const point = cellCenter(this.world, { x, y });
        if (
          suitable &&
          distance(point, spawn) >= 20 &&
          this.navigation.speedAt(point) === 1 &&
          this.navigation.canReach(spawn, point)
        ) {
          candidates.push(point);
        }
      }
    }
    if (candidates.length === 0) {
      this.setFeedback('No reachable grass patch for berry bushes');
      return;
    }
    const nearSpawn = { x: spawn.x + 28, y: spawn.y + 16 };
    let first = candidates[0];
    for (const candidate of candidates) {
      if (distance(candidate, nearSpawn) < distance(first, nearSpawn)) first = candidate;
    }
    this.addBush(first);
    const random = seededRandom(this.world.seed ^ 0x42525259);
    const count = Math.max(6, Math.min(18, Math.floor(candidates.length / 120)));
    for (let attempt = 0; attempt < 2000 && this.bushes.length < count; attempt += 1) {
      const point = candidates[Math.floor(random() * candidates.length)];
      let nearest = Infinity;
      for (const bush of this.bushes) nearest = Math.min(nearest, distance(point, bush.position));
      if (nearest < 16 || (nearest > 36 && random() > 0.2)) continue;
      this.addBush(point);
    }
  }

  private addBush(position: Point): void {
    this.bushes.push({
      id: `bush-${this.bushes.length}`,
      position: { ...position },
      state: 'ripe',
      regrowElapsed: 0,
      targeted: false,
      hovered: false,
      gatherProgress: 0,
    });
  }
}
