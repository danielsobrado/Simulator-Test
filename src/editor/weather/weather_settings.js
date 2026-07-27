import * as THREE from "three";
function clampWindWeatherSettings(settings) {
  return {
    ...settings,
    enabled: settings.enabled,
    intensity: THREE.MathUtils.clamp(settings.intensity, 0, 1.6),
    windX: THREE.MathUtils.clamp(settings.windX, -5, 5),
    windZ: THREE.MathUtils.clamp(settings.windZ, -5, 5)
  };
}
function clampStormWeatherSettings(settings) {
  return {
    enabled: settings.enabled,
    intensity: THREE.MathUtils.clamp(settings.intensity, 0, 1.6)
  };
}
function isWeatherVisible(settings) {
  return settings.enabled && settings.intensity > 1e-3;
}
function applyWindWeatherToMaterials(settings, materials) {
  for (const material of materials) {
    material.setIntensity(settings.intensity);
    material.setWind(settings.windX, settings.windZ);
  }
}
function applyStormWeatherToMaterials(settings, materials) {
  for (const material of materials) material.setIntensity(settings.intensity);
}
export {
  applyStormWeatherToMaterials,
  applyWindWeatherToMaterials,
  clampStormWeatherSettings,
  clampWindWeatherSettings,
  isWeatherVisible
};
