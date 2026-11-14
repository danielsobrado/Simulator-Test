/**
 * Configuration schema and validation for procedural excavated mine tunnels.
 * Values are authored under `archetypes.<id>.params.tunnelGeometry` in
 * `config/instanced-locations.yaml`.
 */

export const DEFAULT_MINE_TUNNEL_CONFIG = Object.freeze({
  macroWidthVariation: 0.65,
  macroHeightVariation: 0.72,
  wallAsymmetry: 0.9,
  ceilingFlattening: 0.58,
  ceilingOffset: 0.5,
  geologicalDisplacement: 0.44,
  fractureFrequency: 0.45,
  fractureStrength: 0.42,
  featureScale: 0.32,
  maxProtrusion: 0.46,
  minNavigationClearance: 1.05,
  minHeadClearance: 2.25,
  junctionBlendDistance: 3.4,
  samplingQuality: 0.75,
  cornerRadius: 4.5,
  beddingDipX: 0.18,
  beddingDipZ: 0.09,
});

function finite(value, name, { min = -Infinity, max = Infinity } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Mine tunnel geometry: "${name}" must be a finite number in [${min}, ${max}] (got ${value}).`);
  }
  return value;
}

/**
 * Resolves and validates partial tunnel geometry settings against defaults.
 *
 * @param {object} [raw]
 * @returns {Readonly<typeof DEFAULT_MINE_TUNNEL_CONFIG>}
 */
export function resolveMineTunnelConfig(raw = {}) {
  const source = raw ?? {};
  return Object.freeze({
    macroWidthVariation: finite(source.macroWidthVariation ?? DEFAULT_MINE_TUNNEL_CONFIG.macroWidthVariation, 'macroWidthVariation', { min: 0, max: 3 }),
    macroHeightVariation: finite(source.macroHeightVariation ?? DEFAULT_MINE_TUNNEL_CONFIG.macroHeightVariation, 'macroHeightVariation', { min: 0, max: 3 }),
    wallAsymmetry: finite(source.wallAsymmetry ?? DEFAULT_MINE_TUNNEL_CONFIG.wallAsymmetry, 'wallAsymmetry', { min: 0, max: 2 }),
    ceilingFlattening: finite(source.ceilingFlattening ?? DEFAULT_MINE_TUNNEL_CONFIG.ceilingFlattening, 'ceilingFlattening', { min: 0, max: 1 }),
    ceilingOffset: finite(source.ceilingOffset ?? DEFAULT_MINE_TUNNEL_CONFIG.ceilingOffset, 'ceilingOffset', { min: 0, max: 1 }),
    geologicalDisplacement: finite(source.geologicalDisplacement ?? DEFAULT_MINE_TUNNEL_CONFIG.geologicalDisplacement, 'geologicalDisplacement', { min: 0, max: 2 }),
    fractureFrequency: finite(source.fractureFrequency ?? DEFAULT_MINE_TUNNEL_CONFIG.fractureFrequency, 'fractureFrequency', { min: 0.05, max: 3 }),
    fractureStrength: finite(source.fractureStrength ?? DEFAULT_MINE_TUNNEL_CONFIG.fractureStrength, 'fractureStrength', { min: 0, max: 2 }),
    featureScale: finite(source.featureScale ?? DEFAULT_MINE_TUNNEL_CONFIG.featureScale, 'featureScale', { min: 0.05, max: 3 }),
    maxProtrusion: finite(source.maxProtrusion ?? DEFAULT_MINE_TUNNEL_CONFIG.maxProtrusion, 'maxProtrusion', { min: 0, max: 2 }),
    minNavigationClearance: finite(source.minNavigationClearance ?? DEFAULT_MINE_TUNNEL_CONFIG.minNavigationClearance, 'minNavigationClearance', { min: 0.4, max: 3 }),
    minHeadClearance: finite(source.minHeadClearance ?? DEFAULT_MINE_TUNNEL_CONFIG.minHeadClearance, 'minHeadClearance', { min: 1.6, max: 6 }),
    junctionBlendDistance: finite(source.junctionBlendDistance ?? DEFAULT_MINE_TUNNEL_CONFIG.junctionBlendDistance, 'junctionBlendDistance', { min: 0, max: 15 }),
    samplingQuality: finite(source.samplingQuality ?? DEFAULT_MINE_TUNNEL_CONFIG.samplingQuality, 'samplingQuality', { min: 0.25, max: 4 }),
    cornerRadius: finite(source.cornerRadius ?? DEFAULT_MINE_TUNNEL_CONFIG.cornerRadius, 'cornerRadius', { min: 0.5, max: 12 }),
    beddingDipX: finite(source.beddingDipX ?? DEFAULT_MINE_TUNNEL_CONFIG.beddingDipX, 'beddingDipX', { min: -1, max: 1 }),
    beddingDipZ: finite(source.beddingDipZ ?? DEFAULT_MINE_TUNNEL_CONFIG.beddingDipZ, 'beddingDipZ', { min: -1, max: 1 }),
  });
}
