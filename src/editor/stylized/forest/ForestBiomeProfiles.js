const DEFAULT_PROFILE_DEFINITIONS = Object.freeze({
  3: Object.freeze({
    key: 'savanna',
    structure: 'groves',
    density: 0.24,
    patchRadiusMin: 0.2,
    patchRadiusMax: 0.42,
    patchAspectMin: 0.7,
    patchAspectMax: 1.6,
    patchEdgeWidth: 0.3,
    boundaryWarp: 0.12,
    elevationMin: -8,
    elevationMax: 44,
    elevationFade: 10,
    preferredSlope: 0.45,
    maximumSlope: 1.2,
  }),
  4: Object.freeze({
    key: 'grassland',
    structure: 'groves',
    density: 0.16,
    patchRadiusMin: 0.18,
    patchRadiusMax: 0.36,
    patchAspectMin: 0.55,
    patchAspectMax: 1.8,
    patchEdgeWidth: 0.34,
    boundaryWarp: 0.14,
    elevationMin: -8,
    elevationMax: 46,
    elevationFade: 10,
    preferredSlope: 0.5,
    maximumSlope: 1.3,
  }),
  5: Object.freeze({
    key: 'tropical_seasonal_forest',
    structure: 'fragmented_woodland',
    density: 0.72,
    patchRadiusMin: 0.42,
    patchRadiusMax: 0.68,
    patchAspectMin: 0.65,
    patchAspectMax: 1.35,
    patchEdgeWidth: 0.24,
    boundaryWarp: 0.12,
    elevationMin: -8,
    elevationMax: 48,
    elevationFade: 8,
    preferredSlope: 0.55,
    maximumSlope: 1.45,
  }),
  6: Object.freeze({
    key: 'temperate_deciduous_forest',
    structure: 'fragmented_woodland',
    density: 0.78,
    patchRadiusMin: 0.48,
    patchRadiusMax: 0.78,
    patchAspectMin: 0.7,
    patchAspectMax: 1.3,
    patchEdgeWidth: 0.22,
    boundaryWarp: 0.14,
    elevationMin: -8,
    elevationMax: 46,
    elevationFade: 7,
    preferredSlope: 0.65,
    maximumSlope: 1.6,
  }),
  7: Object.freeze({
    key: 'tropical_rainforest',
    structure: 'closed_forest',
    density: 0.94,
    patchRadiusMin: 0.68,
    patchRadiusMax: 1.02,
    patchAspectMin: 0.75,
    patchAspectMax: 1.35,
    patchEdgeWidth: 0.18,
    boundaryWarp: 0.16,
    elevationMin: -8,
    elevationMax: 42,
    elevationFade: 6,
    preferredSlope: 0.75,
    maximumSlope: 1.8,
  }),
  8: Object.freeze({
    key: 'temperate_rainforest',
    structure: 'closed_forest',
    density: 0.9,
    patchRadiusMin: 0.62,
    patchRadiusMax: 0.96,
    patchAspectMin: 0.72,
    patchAspectMax: 1.38,
    patchEdgeWidth: 0.2,
    boundaryWarp: 0.15,
    elevationMin: -8,
    elevationMax: 45,
    elevationFade: 7,
    preferredSlope: 0.85,
    maximumSlope: 1.9,
  }),
  9: Object.freeze({
    key: 'taiga',
    structure: 'treeline',
    density: 0.7,
    patchRadiusMin: 0.48,
    patchRadiusMax: 0.82,
    patchAspectMin: 0.55,
    patchAspectMax: 1.5,
    patchEdgeWidth: 0.25,
    boundaryWarp: 0.1,
    elevationMin: -4,
    elevationMax: 40,
    elevationFade: 10,
    preferredSlope: 0.8,
    maximumSlope: 2.1,
  }),
  10: Object.freeze({
    key: 'tundra',
    structure: 'treeline',
    density: 0.12,
    patchRadiusMin: 0.2,
    patchRadiusMax: 0.46,
    patchAspectMin: 0.5,
    patchAspectMax: 1.7,
    patchEdgeWidth: 0.32,
    boundaryWarp: 0.08,
    elevationMin: -4,
    elevationMax: 30,
    elevationFade: 12,
    preferredSlope: 0.6,
    maximumSlope: 1.5,
  }),
  12: Object.freeze({
    key: 'wetland',
    structure: 'wetland_stands',
    density: 0.5,
    patchRadiusMin: 0.3,
    patchRadiusMax: 0.56,
    patchAspectMin: 0.55,
    patchAspectMax: 1.45,
    patchEdgeWidth: 0.28,
    boundaryWarp: 0.18,
    elevationMin: -4,
    elevationMax: 24,
    elevationFade: 5,
    preferredSlope: 0.22,
    maximumSlope: 0.65,
  }),
});

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeProfile(tileId, value) {
  const profile = {
    ...DEFAULT_PROFILE_DEFINITIONS[tileId],
    ...value,
  };
  const patchRadiusMin = clamp(finite(profile.patchRadiusMin, 0.4), 0.1, 1.5);
  const patchRadiusMax = clamp(
    finite(profile.patchRadiusMax, patchRadiusMin),
    patchRadiusMin,
    1.75,
  );
  const patchAspectMin = clamp(finite(profile.patchAspectMin, 0.7), 0.25, 2);
  const patchAspectMax = clamp(
    finite(profile.patchAspectMax, patchAspectMin),
    patchAspectMin,
    3,
  );
  const preferredSlope = Math.max(0, finite(profile.preferredSlope, 0.6));
  const maximumSlope = Math.max(
    preferredSlope + 0.001,
    finite(profile.maximumSlope, preferredSlope + 1),
  );

  return Object.freeze({
    tileId,
    key: String(profile.key ?? `biome_${tileId}`),
    structure: String(profile.structure ?? 'fragmented_woodland'),
    density: clamp(finite(profile.density, 0), 0, 1),
    patchRadiusMin,
    patchRadiusMax,
    patchAspectMin,
    patchAspectMax,
    patchEdgeWidth: clamp(finite(profile.patchEdgeWidth, 0.22), 0.02, 0.6),
    boundaryWarp: clamp(finite(profile.boundaryWarp, 0.1), 0, 0.4),
    elevationMin: finite(profile.elevationMin, -16),
    elevationMax: finite(profile.elevationMax, 48),
    elevationFade: Math.max(0.001, finite(profile.elevationFade, 8)),
    preferredSlope,
    maximumSlope,
    waterMinimum: finite(profile.waterMinimum, Number.NEGATIVE_INFINITY),
    waterMaximum: finite(profile.waterMaximum, Number.POSITIVE_INFINITY),
    waterFade: Math.max(0.001, finite(profile.waterFade, 8)),
  });
}

export function createForestBiomeProfiles(overrides = {}) {
  const merged = new Map();
  for (const [tileId, profile] of Object.entries(DEFAULT_PROFILE_DEFINITIONS)) {
    merged.set(Number(tileId), normalizeProfile(Number(tileId), profile));
  }
  for (const [rawTileId, override] of Object.entries(overrides ?? {})) {
    const tileId = Number(rawTileId);
    if (!Number.isInteger(tileId) || tileId < 0 || !override) continue;
    merged.set(tileId, normalizeProfile(tileId, override));
  }
  return merged;
}

export function forestProfileSignature(profiles) {
  const values = [...profiles.values()]
    .sort((left, right) => left.tileId - right.tileId)
    .map((profile) => [
      profile.tileId,
      profile.key,
      profile.structure,
      profile.density,
      profile.patchRadiusMin,
      profile.patchRadiusMax,
      profile.patchAspectMin,
      profile.patchAspectMax,
      profile.patchEdgeWidth,
      profile.boundaryWarp,
      profile.elevationMin,
      profile.elevationMax,
      profile.elevationFade,
      profile.preferredSlope,
      profile.maximumSlope,
      profile.waterMinimum,
      profile.waterMaximum,
      profile.waterFade,
    ]);
  return JSON.stringify(values);
}

export const FOREST_PROFILE_DEFAULTS = DEFAULT_PROFILE_DEFINITIONS;
