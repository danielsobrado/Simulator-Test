function finiteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Resolves a one-sided resize. `pointerDelta` is measured along the positive
 * direction of the selected local axis; `side` identifies which boundary is
 * being dragged (-1 for minimum, +1 for maximum).
 */
export function solveWorkshopBoundaryResize({
  startScale,
  startSpan,
  pointerDelta,
  side,
  scaleMin,
  scaleMax,
  scaleSnap = 0,
  snapEnabled = false,
}) {
  const safeScale = Math.max(Number.EPSILON, Math.abs(finiteNumber(startScale, 1)));
  const safeSpan = Math.max(Number.EPSILON, Math.abs(finiteNumber(startSpan, 1)));
  const direction = side < 0 ? -1 : 1;
  const minimum = Math.max(Number.EPSILON, finiteNumber(scaleMin, Number.EPSILON));
  const maximum = Math.max(minimum, finiteNumber(scaleMax, minimum));
  const delta = finiteNumber(pointerDelta, 0);
  const requestedSpan = Math.max(Number.EPSILON, safeSpan + direction * delta);
  let scale = safeScale * requestedSpan / safeSpan;

  if (snapEnabled && Number.isFinite(scaleSnap) && scaleSnap > 0) {
    scale = Math.round(scale / scaleSnap) * scaleSnap;
  }
  scale = clamp(scale, minimum, maximum);

  const span = safeSpan * scale / safeScale;
  return Object.freeze({
    scale,
    span,
    boundaryDelta: direction * (span - safeSpan),
  });
}
