export function dampedMotion(current: number, target: number, seconds: number, rate: number): { value: number; integral: number } {
  if (![current, target, seconds, rate].every(Number.isFinite)
    || current < 0 || target < 0 || seconds < 0 || rate <= 0) {
    throw new RangeError('Motion damping needs finite non-negative values/time and a positive rate.');
  }
  const blend = -Math.expm1(-rate * seconds);
  return {
    value: current + (target - current) * blend,
    integral: Math.max(0, target * seconds + (current - target) * blend / rate),
  };
}
