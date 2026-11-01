/** Surface appearance only; the Azgaar bake remains authoritative for snow cover. */
export const SNOW_SURFACE_DEFAULTS = Object.freeze({
  calmScale: 34,
  calmCoverage: 0.5,
  calmRelief: 0.25,
  calmDetail: 0.45,
  windward: 0.6,
  pathCompaction: 0.85,
  pathColor: '#a3b4c9',
  baseRoughness: 0.7,
  compactedRoughness: 0.4,
  toneContrast: 0.06,
  cavityStrength: 0.2,
  subsurfaceStrength: 0.12,
  driftShadow: 0.18,
  fineNormal: 0.35,
  lowSunWrap: 0.85,
});

export function resolveSnowSurfaceConfig(source = {}) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new TypeError('stylizedSurface.snowSurface must be an object.');
  }
  const value = { ...SNOW_SURFACE_DEFAULTS, ...source };
  for (const key of ['calmCoverage', 'calmRelief', 'calmDetail', 'windward', 'pathCompaction',
    'baseRoughness', 'compactedRoughness', 'toneContrast', 'cavityStrength', 'subsurfaceStrength', 'driftShadow', 'fineNormal', 'lowSunWrap']) {
    if (!Number.isFinite(value[key]) || value[key] < 0 || value[key] > 1) {
      throw new RangeError(`stylizedSurface.snowSurface.${key} must be within [0, 1].`);
    }
  }
  if (!Number.isFinite(value.calmScale) || value.calmScale < 1 || value.calmScale > 256) {
    throw new RangeError('stylizedSurface.snowSurface.calmScale must be within [1, 256] metres.');
  }
  if (!/^#[0-9a-f]{6}$/i.test(value.pathColor)) {
    throw new TypeError('stylizedSurface.snowSurface.pathColor must be a #rrggbb colour.');
  }
  return value;
}
