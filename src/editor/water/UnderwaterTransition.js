export function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

export function advanceUnderwaterBlend(current, submerged, deltaSeconds, transitionSeconds) {
  const target = submerged ? 1 : 0;
  if (!Number.isFinite(current)) return target;
  const duration = Math.max(1e-4, transitionSeconds);
  const step = Math.max(0, deltaSeconds) / duration;
  if (current < target) return Math.min(target, current + step);
  if (current > target) return Math.max(target, current - step);
  return current;
}

export function mixNumber(left, right, amount) {
  return left + (right - left) * clamp01(amount);
}
