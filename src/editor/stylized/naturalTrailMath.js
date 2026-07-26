const DEFAULTS = Object.freeze({
  enabled: false,
  scale: 0.018,
  level: 0.08,
  width: 0.038,
  softness: 0.035,
  warp: 0.9,
  clearThreshold: 0.42,
});

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

export function normalizeNaturalTrailConfig(config = {}) {
  return {
    enabled: config.enabled === true,
    scale: Math.max(0.000001, finiteOr(config.scale, DEFAULTS.scale)),
    level: finiteOr(config.level, DEFAULTS.level),
    width: Math.max(0.000001, finiteOr(config.width, DEFAULTS.width)),
    softness: Math.max(0.000001, finiteOr(config.softness, DEFAULTS.softness)),
    warp: finiteOr(config.warp, DEFAULTS.warp),
    clearThreshold: Math.min(1, Math.max(
      0,
      finiteOr(config.clearThreshold, DEFAULTS.clearThreshold),
    )),
  };
}

/**
 * A continuous world-space contour field for decorative game trails.
 *
 * Unlike thresholded noise blobs, an iso-contour stays connected for long
 * distances. The same inexpensive expression is mirrored in the TSL materials
 * so streamed chunks and CPU prop placement agree without storing another map.
 */
export function naturalTrailFieldAt(worldX, worldZ, config = {}) {
  const settings = normalizeNaturalTrailConfig(config);
  const x = worldX * settings.scale;
  const z = worldZ * settings.scale;
  const warpedX = x + Math.sin(z * 0.73 + 1.7) * settings.warp;
  const warpedZ = z + Math.sin(x * 0.61 - 2.3) * settings.warp;
  return Math.sin(warpedX) * 0.52
    + Math.sin(warpedZ * 0.83 + 1.1) * 0.33
    + Math.sin((warpedX + warpedZ) * 0.47 - 0.6) * 0.15;
}

export function naturalTrailMaskAt(worldX, worldZ, config = {}) {
  const settings = normalizeNaturalTrailConfig(config);
  if (!settings.enabled) return 0;
  const distance = Math.abs(
    naturalTrailFieldAt(worldX, worldZ, settings) - settings.level,
  );
  const transition = Math.min(1, Math.max(
    0,
    (distance - settings.width) / settings.softness,
  ));
  const smoothTransition = transition * transition * (3 - 2 * transition);
  return 1 - smoothTransition;
}
