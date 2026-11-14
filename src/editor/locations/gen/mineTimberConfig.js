/**
 * Configuration schema, validation, and runtime defaults for procedural mine
 * timber supports. Canonical defaults live in `config/mine-timber.yaml` and are
 * loaded into `setDefaultMineTimberConfig` by `createLocationRuntime.js`, while
 * per-archetype/site overrides can also be supplied via `params.timber`.
 */

function deepFreeze(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  for (const value of Object.values(obj)) deepFreeze(value);
  return Object.freeze(obj);
}

function mergeObjects(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return override ?? base;
  const out = { ...(base && typeof base === 'object' ? base : {}) };
  for (const [key, value] of Object.entries(override)) out[key] = mergeObjects(out[key], value);
  return out;
}

function finite(value, name, { min = -Infinity, max = Infinity } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Mine timber config: "${name}" must be a finite number in [${min}, ${max}] (got ${value}).`);
  }
  return value;
}

export const DEFAULT_MINE_TIMBER_CONFIG = deepFreeze({
  beamDimensions: {
    postWidth: 0.175,
    postDepth: 0.185,
    capWidth: 0.19,
    capHeight: 0.21,
    sillWidth: 0.28,
    sillHeight: 0.095,
    sillDepth: 0.30,
    braceWidth: 0.11,
    braceDepth: 0.125,
    bolsterWidth: 0.21,
    bolsterHeight: 0.125,
    bolsterLength: 0.72,
    laggingWidth: 0.20,
    laggingThickness: 0.042,
    stullWidth: 0.185,
    stullDepth: 0.185,
    variation: 0.09,
  },
  archetypes: {
    standard: { postScale: 1.0, capScale: 1.0, braceScale: 1.0, braceChance: 0.84, asymmetryChance: 0.28, hardwareChance: 0.35, weight: 0.48 },
    heavy: { postScale: 1.24, capScale: 1.26, braceScale: 1.18, braceChance: 0.98, asymmetryChance: 0.12, hardwareChance: 0.85, weight: 0.16 },
    light: { postScale: 0.82, capScale: 0.82, braceScale: 0.84, braceChance: 0.42, asymmetryChance: 0.45, hardwareChance: 0.15, weight: 0.16 },
    repaired: { postScale: 0.98, capScale: 1.02, braceScale: 1.0, braceChance: 0.90, asymmetryChance: 0.55, hardwareChance: 0.80, weight: 0.10 },
    aged: { postScale: 0.96, capScale: 0.98, braceScale: 0.95, braceChance: 0.76, asymmetryChance: 0.38, hardwareChance: 0.45, weight: 0.06 },
    partial: { postScale: 1.02, capScale: 0.96, braceScale: 0.95, braceChance: 0.88, asymmetryChance: 1.0, hardwareChance: 0.30, weight: 0.04 },
    overbreakHeavyThreshold: 0.50,
    spanHeavyThreshold: 4.15,
    partialMaxRockGap: 0.38,
  },
  placement: {
    nominalSpacing: 3.45,
    minSpacing: 2.25,
    maxSpacing: 4.65,
    spacingJitter: 0.18,
    entranceOffset: 2.35,
    endMargin: 1.35,
    heavyClusterChance: 0.24,
    heavyClusterMinCount: 2,
    heavyClusterMaxCount: 4,
    junctionClearance: 1.65,
    openingWidthThreshold: 1.45,
  },
  geometry: {
    bevelRatio: 0.145,
    edgeIrregularity: 0.24,
    longitudinalStep: 0.58,
    maxSteps: 10,
    chipChance: 0.55,
    chipDepth: 0.016,
    splitChance: 0.28,
    splitDepth: 0.011,
    sawCutSkew: 0.022,
    bowFactor: 0.008,
    taperFactor: 0.055,
    uvScale: 0.55,
    endGrainDarken: 0.62,
  },
  braces: {
    kneeDropMin: 0.62,
    kneeDropMax: 0.88,
    kneeReachMin: 0.52,
    kneeReachMax: 0.78,
    minClearHeight: 2.15,
    heelCleatChance: 0.48,
  },
  joints: {
    styles: { housed: 0.34, notched: 0.30, bolster: 0.20, collared: 0.16 },
    pegSize: 0.032,
    boltSize: 0.028,
    strapWidth: 0.052,
    strapThickness: 0.012,
    capEarMin: 0.16,
    capEarMax: 0.28,
    wedgeMaxThickness: 0.085,
    blockingMaxGap: 0.68,
  },
  lagging: {
    roofProbability: 0.28,
    wallProbability: 0.18,
    unstableBoost: 0.52,
    boardsPerBayMin: 2,
    boardsPerBayMax: 4,
    maxSpan: 4.1,
  },
  clearance: {
    walkHalfWidth: 1.05,
    walkHeight: 2.15,
    railHalfWidth: 0.72,
    railHeight: 1.65,
    postWallTargetGap: 0.06,
    maxRockPenetration: 0.09,
    ceilingContactMargin: 0.04,
    minFrameHeight: 1.95,
  },
  conditions: {
    new: { wear: 0.25, damp: 0.12, splitRate: 0.15, leanMax: 0.012, tintHex: 0x8b6c4c, repairTintHex: 0x9b7c5a },
    maintained: { wear: 0.48, damp: 0.28, splitRate: 0.45, leanMax: 0.026, tintHex: 0x7b5e42, repairTintHex: 0x967552 },
    aged: { wear: 0.78, damp: 0.58, splitRate: 0.85, leanMax: 0.042, tintHex: 0x624b36, repairTintHex: 0x856747 },
    neglected: { wear: 0.95, damp: 0.72, splitRate: 1.0, leanMax: 0.058, tintHex: 0x523f2d, repairTintHex: 0x74583c },
    repaired: { wear: 0.68, damp: 0.42, splitRate: 0.75, leanMax: 0.038, tintHex: 0x674f39, repairTintHex: 0x987854 },
  },
});

let runtimeDefaults = DEFAULT_MINE_TIMBER_CONFIG;

/** Installs parsed `config/mine-timber.yaml` data as runtime defaults. */
export function setDefaultMineTimberConfig(yamlDoc) {
  const section = yamlDoc?.mineTimber ?? yamlDoc;
  if (!section || typeof section !== 'object') return runtimeDefaults;
  runtimeDefaults = resolveMineTimberConfig(section, DEFAULT_MINE_TIMBER_CONFIG);
  return runtimeDefaults;
}

/** Validates and resolves partial timber overrides against active defaults. */
export function resolveMineTimberConfig(raw = {}, base = runtimeDefaults) {
  const merged = mergeObjects(base, raw ?? {});
  const d = merged.beamDimensions;
  finite(d.postWidth, 'beamDimensions.postWidth', { min: 0.06, max: 0.5 });
  finite(d.postDepth, 'beamDimensions.postDepth', { min: 0.06, max: 0.5 });
  finite(d.capWidth, 'beamDimensions.capWidth', { min: 0.06, max: 0.5 });
  finite(d.capHeight, 'beamDimensions.capHeight', { min: 0.06, max: 0.5 });
  finite(d.braceWidth, 'beamDimensions.braceWidth', { min: 0.04, max: 0.35 });
  finite(d.braceDepth, 'beamDimensions.braceDepth', { min: 0.04, max: 0.35 });

  const p = merged.placement;
  finite(p.nominalSpacing, 'placement.nominalSpacing', { min: 1.0, max: 10.0 });
  finite(p.minSpacing, 'placement.minSpacing', { min: 0.8, max: p.nominalSpacing });
  finite(p.maxSpacing, 'placement.maxSpacing', { min: p.nominalSpacing, max: 15.0 });
  finite(p.spacingJitter, 'placement.spacingJitter', { min: 0, max: 0.6 });

  const g = merged.geometry;
  finite(g.bevelRatio, 'geometry.bevelRatio', { min: 0.02, max: 0.32 });
  finite(g.edgeIrregularity, 'geometry.edgeIrregularity', { min: 0, max: 1 });
  finite(g.longitudinalStep, 'geometry.longitudinalStep', { min: 0.2, max: 2.0 });

  const c = merged.clearance;
  finite(c.walkHalfWidth, 'clearance.walkHalfWidth', { min: 0.4, max: 3.0 });
  finite(c.walkHeight, 'clearance.walkHeight', { min: 1.5, max: 4.5 });
  finite(c.railHalfWidth, 'clearance.railHalfWidth', { min: 0.3, max: 2.0 });
  finite(c.minFrameHeight, 'clearance.minFrameHeight', { min: 1.4, max: 5.0 });

  return deepFreeze(merged);
}
