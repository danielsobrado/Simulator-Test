const MAX_MACRO_ATLAS_CELLS = 4_000_000;

const POSITIVE_GUIDANCE_FIELDS = Object.freeze([
  'coastInfluenceKilometers',
  'riverInfluenceKilometers',
  'ruggednessSampleKilometers',
  'ruggednessElevationDelta',
  'valleyElevationDelta',
  'precipitationNormalization',
  'temperateRange',
  'agricultureMoistureRange',
  'harborScoreNormalization',
]);

const FINITE_GUIDANCE_FIELDS = Object.freeze([
  'valleyRuggednessSuppression',
  'temperatureNormalizationMinC',
  'temperatureNormalizationMaxC',
  'mountainReliefStart',
  'mountainReliefEnd',
  'mountainReliefWeight',
  'mountainRuggednessWeight',
  'snowTemperatureWeight',
  'snowReliefWeight',
  'snowBias',
  'temperateCenter',
  'forestMoistureWeight',
  'forestTemperatureWeight',
  'forestBiomeWeight',
  'forestSnowPenalty',
  'agricultureMoistureCenter',
  'agricultureMoistureWeight',
  'agricultureTemperatureWeight',
  'agricultureFlatnessWeight',
  'agricultureLowlandWeight',
  'agricultureSettlementWeight',
  'wetnessMoistureWeight',
  'wetnessRiverWeight',
  'wetnessCoastWeight',
  'wetnessReliefPenalty',
]);

function validateGuidanceConfig(guidance) {
  if (!guidance || typeof guidance !== 'object' || Array.isArray(guidance)) {
    throw new Error('Invalid editor configuration: import.azgaarGuidance must be an object.');
  }
  for (const name of POSITIVE_GUIDANCE_FIELDS) {
    if (!Number.isFinite(guidance[name]) || guidance[name] <= 0) {
      throw new Error(
        `Invalid editor configuration: import.azgaarGuidance.${name} must be positive.`,
      );
    }
  }
  for (const name of FINITE_GUIDANCE_FIELDS) {
    if (!Number.isFinite(guidance[name])) {
      throw new Error(
        `Invalid editor configuration: import.azgaarGuidance.${name} must be finite.`,
      );
    }
  }
  if (guidance.temperatureNormalizationMaxC <= guidance.temperatureNormalizationMinC) {
    throw new Error(
      'Invalid editor configuration: Azgaar guidance temperature max must exceed min.',
    );
  }
  if (guidance.mountainReliefEnd <= guidance.mountainReliefStart) {
    throw new Error(
      'Invalid editor configuration: Azgaar guidance mountain relief end must exceed start.',
    );
  }
}

export function validateImportConfig(config) {
  const importConfig = config?.import;
  if (!importConfig || typeof importConfig !== 'object' || Array.isArray(importConfig)) {
    throw new Error('Invalid editor configuration: import must be an object.');
  }

  const longEdge = importConfig.azgaarAtlasLongEdge;
  if (!Number.isInteger(longEdge) || longEdge < 1 || longEdge > MAX_MACRO_ATLAS_CELLS) {
    throw new Error(
      `Invalid editor configuration: import.azgaarAtlasLongEdge must be an integer within 1–${MAX_MACRO_ATLAS_CELLS}.`,
    );
  }

  validateGuidanceConfig(importConfig.azgaarGuidance);
  return importConfig;
}
