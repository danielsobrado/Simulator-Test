/**
 * Per-palette stone surface response: unit shading, procedural albedo noise,
 * and material constants shared by workshop and live construction.
 *
 * Defaults reproduce the hard-coded values that granite / limestone / sandstone
 * already used. Soft limestone overrides them for a calmer, less saturated look.
 */

const DEFAULT_UNIT_SHADING = Object.freeze({
  brightnessMin: 0.94,
  brightnessMax: 1.04,
  weatheringStrength: 0.14,
});

const DEFAULT_PROCEDURAL_ALBEDO = Object.freeze({
  broadCellSize: 18,
  broadVariation: 15,
  grainVariation: 8,
  dampDarkening: 14,
  dampGreenLift: 4,
});

const DEFAULT_MATERIAL_SURFACE = Object.freeze({
  bumpTextureScale: 1,
  bumpScale: 0.055,

  roughnessBase: 226,
  roughnessVariation: 26,
  roughnessBroadScale: 9,

  normalKind: null,
  workshopNormalScale: 0.55,
  constructionNormalScale: null,

  workshopEnvMapIntensity: 0.72,
  constructionEnvMapIntensity: null,

  mortarColor: null,
});

const DEFAULT_STONE_SURFACE_PROFILE = Object.freeze({
  unitShading: DEFAULT_UNIT_SHADING,
  proceduralAlbedo: DEFAULT_PROCEDURAL_ALBEDO,
  material: DEFAULT_MATERIAL_SURFACE,
});

const VALID_NORMAL_KINDS = new Set([
  'stoneBlock',
  'rubble',
  'granite',
  'plaster',
  'timber',
  'roofTile',
  'shingle',
]);

export const STONE_SURFACE_PROFILES = Object.freeze({
  'soft-limestone': Object.freeze({
    unitShading: Object.freeze({
      // Wider coherent stone-to-stone value range, but less high-frequency
      // surface noise: the block silhouette and bevel lighting do the work.
      brightnessMin: 0.945,
      brightnessMax: 1.055,
      weatheringStrength: 0.065,
    }),

    proceduralAlbedo: Object.freeze({
      broadCellSize: 28,
      broadVariation: 5,
      grainVariation: 2,
      dampDarkening: 7,
      dampGreenLift: 1.5,
    }),

    material: Object.freeze({
      bumpTextureScale: 0.42,
      bumpScale: 0.020,

      roughnessBase: 236,
      roughnessVariation: 10,
      roughnessBroadScale: 16,

      normalKind: 'stoneBlock',
      workshopNormalScale: 0.22,
      constructionNormalScale: 0.22,

      workshopEnvMapIntensity: 0.64,
      constructionEnvMapIntensity: 0.64,

      mortarColor: '#707069',
    }),
  }),
});

function finiteInRange(value, label, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}, got ${value}.`);
  }
  return value;
}

function optionalFiniteInRange(value, label, minimum, maximum) {
  if (value == null) return value;
  return finiteInRange(value, label, minimum, maximum);
}

function integerInRange(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}, got ${value}.`);
  }
  return value;
}

function validateUnitShading(shading, label) {
  finiteInRange(shading.brightnessMin, `${label} brightnessMin`, 0, 2);
  finiteInRange(shading.brightnessMax, `${label} brightnessMax`, 0, 2);
  finiteInRange(shading.weatheringStrength, `${label} weatheringStrength`, 0, 1);
  if (shading.brightnessMin > shading.brightnessMax) {
    throw new Error(`${label} brightness range is reversed.`);
  }
}

function validateProceduralAlbedo(albedo, label) {
  integerInRange(albedo.broadCellSize, `${label} broadCellSize`, 1, 256);
  finiteInRange(albedo.broadVariation, `${label} broadVariation`, 0, 128);
  finiteInRange(albedo.grainVariation, `${label} grainVariation`, 0, 128);
  finiteInRange(albedo.dampDarkening, `${label} dampDarkening`, 0, 128);
  finiteInRange(albedo.dampGreenLift, `${label} dampGreenLift`, 0, 128);
}

function validateMaterialSurface(material, label) {
  finiteInRange(material.bumpTextureScale, `${label} bumpTextureScale`, 0, 4);
  finiteInRange(material.bumpScale, `${label} bumpScale`, 0, 1);
  finiteInRange(material.roughnessBase, `${label} roughnessBase`, 0, 255);
  finiteInRange(material.roughnessVariation, `${label} roughnessVariation`, 0, 255);
  integerInRange(material.roughnessBroadScale, `${label} roughnessBroadScale`, 1, 128);
  optionalFiniteInRange(material.workshopNormalScale, `${label} workshopNormalScale`, 0, 4);
  optionalFiniteInRange(material.constructionNormalScale, `${label} constructionNormalScale`, 0, 4);
  optionalFiniteInRange(material.workshopEnvMapIntensity, `${label} workshopEnvMapIntensity`, 0, 4);
  optionalFiniteInRange(material.constructionEnvMapIntensity, `${label} constructionEnvMapIntensity`, 0, 4);
  if (material.normalKind != null && !VALID_NORMAL_KINDS.has(material.normalKind)) {
    throw new Error(`${label} normalKind "${material.normalKind}" is unknown.`);
  }
  if (material.mortarColor != null) {
    if (!/^#[0-9a-fA-F]{6}$/.test(material.mortarColor)) {
      throw new Error(`${label} mortarColor must be a six-digit hex colour.`);
    }
  }
}

function validateProfile(profile, label) {
  validateUnitShading(profile.unitShading, `${label}.unitShading`);
  validateProceduralAlbedo(profile.proceduralAlbedo, `${label}.proceduralAlbedo`);
  validateMaterialSurface(profile.material, `${label}.material`);
}

function resolveProfile(paletteKey) {
  const override = STONE_SURFACE_PROFILES[paletteKey];
  if (!override) return DEFAULT_STONE_SURFACE_PROFILE;
  return Object.freeze({
    unitShading: Object.freeze({
      ...DEFAULT_UNIT_SHADING,
      ...override.unitShading,
    }),
    proceduralAlbedo: Object.freeze({
      ...DEFAULT_PROCEDURAL_ALBEDO,
      ...override.proceduralAlbedo,
    }),
    material: Object.freeze({
      ...DEFAULT_MATERIAL_SURFACE,
      ...override.material,
    }),
  });
}

for (const [key, override] of Object.entries(STONE_SURFACE_PROFILES)) {
  validateProfile(resolveProfile(key), `STONE_SURFACE_PROFILES.${key}`);
}
validateProfile(DEFAULT_STONE_SURFACE_PROFILE, 'DEFAULT_STONE_SURFACE_PROFILE');

const resolvedProfiles = new Map();

/**
 * @param {string} paletteKey stone palette key (`granite`, `soft-limestone`, …)
 * @returns {Readonly<{
 *   unitShading: object,
 *   proceduralAlbedo: object,
 *   material: object,
 * }>}
 */
export function stoneSurfaceProfile(paletteKey) {
  const key = typeof paletteKey === 'string' ? paletteKey : '';
  if (!resolvedProfiles.has(key)) {
    resolvedProfiles.set(key, resolveProfile(key));
  }
  return resolvedProfiles.get(key);
}

/** Test seam: rebuild the soft-limestone profile with overrides and validate. */
export function defineStoneSurfaceProfileForTest(input) {
  const profile = Object.freeze({
    unitShading: Object.freeze({
      ...DEFAULT_UNIT_SHADING,
      ...input.unitShading,
    }),
    proceduralAlbedo: Object.freeze({
      ...DEFAULT_PROCEDURAL_ALBEDO,
      ...input.proceduralAlbedo,
    }),
    material: Object.freeze({
      ...DEFAULT_MATERIAL_SURFACE,
      ...input.material,
    }),
  });
  validateProfile(profile, input.key ?? 'test-profile');
  return profile;
}
