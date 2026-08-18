const WHEEL_LINE_PIXELS = 16;

export function wrapIndex(index, length) {
  if (!Number.isInteger(length) || length <= 0) return 0;
  return ((index % length) + length) % length;
}

export function arcSlot(index, count) {
  const center = (count - 1) / 2;
  const denominator = Math.max(1, center);
  const normalized = (index - center) / denominator;
  return Object.freeze({
    y: 50 + normalized * 42,
    depth: 16 + (1 - normalized * normalized) * 72,
    scale: 0.82 + (1 - Math.abs(normalized)) * 0.18,
    opacity: 0.62 + (1 - Math.abs(normalized)) * 0.38,
  });
}

export function circularOffset(index, selectedIndex, length) {
  if (!Number.isInteger(length) || length <= 0) return 0;
  const forward = wrapIndex(index - selectedIndex, length);
  return forward > length / 2 ? forward - length : forward;
}

export function wheelDeltaPixels({ deltaX = 0, deltaY = 0, deltaMode = 0 }, pagePixels = 800) {
  const primary = Math.abs(deltaY) >= Math.abs(deltaX) ? deltaY : deltaX;
  if (!Number.isFinite(primary)) return 0;
  if (deltaMode === 1) return primary * WHEEL_LINE_PIXELS;
  if (deltaMode === 2) return primary * Math.max(1, Number(pagePixels) || 800);
  return primary;
}

export function consumeSteppedDelta(accumulated, incoming, threshold, maxSteps = 2) {
  const safeThreshold = Math.max(1, Number(threshold) || 1);
  const safeMaxSteps = Math.max(1, Math.trunc(Number(maxSteps) || 1));
  const combined = (Number.isFinite(accumulated) ? accumulated : 0)
    + (Number.isFinite(incoming) ? incoming : 0);
  const requestedSteps = Math.trunc(combined / safeThreshold);
  const steps = Math.max(-safeMaxSteps, Math.min(safeMaxSteps, requestedSteps));
  const rawRemainder = combined - steps * safeThreshold;
  const remainderLimit = safeThreshold * 0.95;
  const remainder = Math.sign(rawRemainder)
    * Math.min(Math.abs(rawRemainder), remainderLimit);
  return Object.freeze({ steps, remainder });
}
