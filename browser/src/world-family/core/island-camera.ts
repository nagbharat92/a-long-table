import type { Point, Rectangle } from './contracts';

export function stepIslandZoom(
  zoom: number, target: number, velocity: number, seconds: number, min: number, max: number,
): { zoom: number; velocity: number } {
  if (![zoom, target, velocity, seconds, min, max].every(Number.isFinite)
    || min <= 0 || max < min || zoom <= 0 || target < min || target > max || seconds < 0) {
    throw new RangeError('Island zoom needs finite positive scales, valid limits and non-negative elapsed time.');
  }
  // Solve the underdamped spring in log scale so zoom direction and frame rate do not change its feel.
  const frequency = 44;
  const decay = frequency * 0.68;
  const oscillation = frequency * Math.sqrt(1 - 0.68 ** 2);
  const offset = Math.log(zoom / target);
  const sine = Math.sin(oscillation * seconds);
  const cosine = Math.cos(oscillation * seconds);
  const envelope = Math.exp(-decay * seconds);
  const coefficient = (velocity + decay * offset) / oscillation;
  const nextOffset = envelope * (offset * cosine + coefficient * sine);
  const nextVelocity = envelope * (velocity * cosine - (decay * coefficient + oscillation * offset) * sine);
  const nextZoom = target * Math.exp(nextOffset);
  if (nextZoom <= min) return { zoom: min, velocity: Math.max(0, nextVelocity) };
  if (nextZoom >= max) return { zoom: max, velocity: Math.min(0, nextVelocity) };
  if (Math.abs(nextOffset) < 0.00001 && Math.abs(nextVelocity) < 0.001) return { zoom: target, velocity: 0 };
  return { zoom: nextZoom, velocity: nextVelocity };
}

export function clampIslandCenter(
  center: Point, island: Rectangle, viewport: { width: number; height: number }, zoom: number, fitZoom: number,
): Point {
  if (![center.x, center.y, island.x, island.y, island.width, island.height, viewport.width, viewport.height, zoom, fitZoom].every(Number.isFinite)
    || island.width <= 0 || island.height <= 0 || viewport.width <= 0 || viewport.height <= 0 || fitZoom <= 0 || zoom < fitZoom) {
    throw new RangeError('Island pan bounds need finite dimensions and a zoom at or above the fit scale.');
  }
  // The fitted view is the outer pan rectangle, including its existing ocean margin.
  const travelX = Math.max(0, viewport.width / fitZoom - viewport.width / zoom) / 2;
  const travelY = Math.max(0, viewport.height / fitZoom - viewport.height / zoom) / 2;
  const x = island.x + island.width / 2;
  const y = island.y + island.height / 2;
  return {
    x: Math.max(x - travelX, Math.min(x + travelX, center.x)),
    y: Math.max(y - travelY, Math.min(y + travelY, center.y)),
  };
}
