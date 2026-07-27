import { resolveAquaticPlacementRule } from './AquaticPlacement.js';
import { validateWaterVisualConfig } from './WaterQuality.js';

function assertObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object.`);
  }
}

export function applyWaterVisualConfig(config, source) {
  assertObject(config, 'editor config');
  assertObject(source, 'water visual config');
  assertObject(source.water, 'water visual config.water');
  assertObject(source.aquaticPlants, 'water visual config.aquaticPlants');
  assertObject(config.stylizedSurface?.water, 'stylizedSurface.water');
  assertObject(config.stylizedSurface?.aquaticPlants, 'stylizedSurface.aquaticPlants');

  Object.assign(config.stylizedSurface.water, structuredClone(source.water));
  config.stylizedSurface.aquaticPlants.water = structuredClone(source.aquaticPlants.water);
  config.stylizedSurface.aquaticPlants.surfaceWater = structuredClone(source.aquaticPlants.surface);
  return config;
}

export function validateWaterContentConfig(config) {
  assertObject(config?.stylizedSurface?.water, 'stylizedSurface.water');
  assertObject(config?.stylizedSurface?.aquaticPlants, 'stylizedSurface.aquaticPlants');
  validateWaterVisualConfig(config.stylizedSurface.water);
  const rootedRule = config.stylizedSurface.aquaticPlants.water;
  const surfaceRule = config.stylizedSurface.aquaticPlants.surfaceWater;
  resolveAquaticPlacementRule(rootedRule);
  resolveAquaticPlacementRule(rootedRule, surfaceRule);

  for (const variant of config.stylizedSurface.assets?.aquaticVariants ?? []) {
    const inferredRule = variant.placement?.strategy === 'shoreline-colonies'
      ? surfaceRule
      : null;
    resolveAquaticPlacementRule(rootedRule, variant.water ?? inferredRule);
    for (const prototypeRule of variant.prototypeWater ?? []) {
      resolveAquaticPlacementRule(rootedRule, prototypeRule ?? inferredRule);
    }
  }

  const currentDriftSpeed = config.player?.water?.currentDriftSpeed;
  if (!Number.isFinite(currentDriftSpeed) || currentDriftSpeed < 0 || currentDriftSpeed > 10) {
    throw new Error('player.water.currentDriftSpeed must be within [0, 10].');
  }
  return config;
}
