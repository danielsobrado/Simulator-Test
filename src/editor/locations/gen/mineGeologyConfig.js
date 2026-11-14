/**
 * Configuration schema and validation for procedural underground geological
 * zoning, floor classification, and surface transition masks.
 * Values are authored under `archetypes.<id>.params.geology` in
 * `config/instanced-locations.yaml`.
 */

export const DEFAULT_MINE_GEOLOGY_CONFIG = Object.freeze({
  zoneScale: 0.042,
  zoneContrast: 1.0,
  beddingDipX: 0.18,
  beddingDipZ: 0.09,
  wallBlendWidth: 1.05,
  sedimentAccumulation: 0.72,
  gravelDensity: 0.68,
  bedrockExposure: 0.36,
  wetnessGain: 1.0,
  drainageLevel: -3.8,
  mineralIntensity: 0.42,
  excavationContrast: 0.75,
});

function finite(value, name, { min = -Infinity, max = Infinity } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Mine geology config: "${name}" must be a finite number in [${min}, ${max}] (got ${value}).`);
  }
  return value;
}

/**
 * Resolves and validates partial geological distribution settings against defaults.
 *
 * @param {object} [raw]
 * @returns {Readonly<typeof DEFAULT_MINE_GEOLOGY_CONFIG>}
 */
export function resolveMineGeologyConfig(raw = {}) {
  const source = raw ?? {};
  return Object.freeze({
    zoneScale: finite(source.zoneScale ?? DEFAULT_MINE_GEOLOGY_CONFIG.zoneScale, 'zoneScale', { min: 0.005, max: 0.5 }),
    zoneContrast: finite(source.zoneContrast ?? DEFAULT_MINE_GEOLOGY_CONFIG.zoneContrast, 'zoneContrast', { min: 0, max: 2 }),
    beddingDipX: finite(source.beddingDipX ?? DEFAULT_MINE_GEOLOGY_CONFIG.beddingDipX, 'beddingDipX', { min: -1, max: 1 }),
    beddingDipZ: finite(source.beddingDipZ ?? DEFAULT_MINE_GEOLOGY_CONFIG.beddingDipZ, 'beddingDipZ', { min: -1, max: 1 }),
    wallBlendWidth: finite(source.wallBlendWidth ?? DEFAULT_MINE_GEOLOGY_CONFIG.wallBlendWidth, 'wallBlendWidth', { min: 0.1, max: 4 }),
    sedimentAccumulation: finite(source.sedimentAccumulation ?? DEFAULT_MINE_GEOLOGY_CONFIG.sedimentAccumulation, 'sedimentAccumulation', { min: 0, max: 1.5 }),
    gravelDensity: finite(source.gravelDensity ?? DEFAULT_MINE_GEOLOGY_CONFIG.gravelDensity, 'gravelDensity', { min: 0, max: 1.5 }),
    bedrockExposure: finite(source.bedrockExposure ?? DEFAULT_MINE_GEOLOGY_CONFIG.bedrockExposure, 'bedrockExposure', { min: 0, max: 1 }),
    wetnessGain: finite(source.wetnessGain ?? DEFAULT_MINE_GEOLOGY_CONFIG.wetnessGain, 'wetnessGain', { min: 0, max: 2 }),
    drainageLevel: finite(source.drainageLevel ?? DEFAULT_MINE_GEOLOGY_CONFIG.drainageLevel, 'drainageLevel', { min: -100, max: 100 }),
    mineralIntensity: finite(source.mineralIntensity ?? DEFAULT_MINE_GEOLOGY_CONFIG.mineralIntensity, 'mineralIntensity', { min: 0, max: 1.5 }),
    excavationContrast: finite(source.excavationContrast ?? DEFAULT_MINE_GEOLOGY_CONFIG.excavationContrast, 'excavationContrast', { min: 0, max: 1.5 }),
  });
}
