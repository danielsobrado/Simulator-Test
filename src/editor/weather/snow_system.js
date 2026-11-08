import * as THREE from "three";
import { createSnowShaderMaterial } from "./rainShaderMaterial.js";
import { SNOW_FLAKE_COUNT } from "./rain_constants.js";
import { DEFAULT_SNOW_WEATHER_SETTINGS } from "./rain_defaults.js";
import { createSnowGeometry } from "./rain_geometry.js";
import { createSnowfallField } from "./snowfall/SnowfallField.js";
import { clampWindWeatherSettings, isWeatherVisible } from "./weather_settings.js";
import { DEFAULT_WEATHER_EFFECTS } from './WeatherEffectsConfig.js';
import { worldWindCamera } from './wind/worldWindState.js';
import { evaluateLevels, PRECIP_LEVEL_KEYS } from './storm/stormCurves.js';
/**
 * Maximum coverage-driven snowfall over snow country with the weather off.
 * Resolved weather-effects settings can override this reference intensity.
 */
const REGIONAL_SNOW_INTENSITY = DEFAULT_WEATHER_EFFECTS.snowfall.regionalIntensity;
/** Flake drift (m/s) in the calm reference wind; scales with the world wind's strength. */
const SNOW_DRIFT_SPEED = Math.hypot(DEFAULT_SNOW_WEATHER_SETTINGS.windX, DEFAULT_SNOW_WEATHER_SETTINGS.windZ);
/** Regional snowfall at full coverage reads as the moderate level (≈ the former full field). */
const REGIONAL_LEVEL_KEY = PRECIP_LEVEL_KEYS[2];
/** Extra drift at full storm wind: the field's 2.4× intensity alone leaves a gale at ~3 m/s. */
const SNOW_STORM_DRIFT_GAIN = 2;

/**
 * Drift velocity (m/s) from the shared camera wind sample, capped per level
 * (`snowfall.levels.driftCap`: a blizzard drives flakes ~15 m/s sideways against a 1.2 m/s fall).
 */
export function snowDriftVelocity(sample = worldWindCamera, cap = 15) {
  const speed = Math.min(cap,
    SNOW_DRIFT_SPEED * sample.envelope * (1 + SNOW_STORM_DRIFT_GAIN * sample.storm));
  return { x: sample.directionX * speed, z: sample.directionZ * speed };
}
class SnowWeatherSystem {
  group = new THREE.Group();
  snowMaterial;
  snowMesh;
  center = new THREE.Vector3();
  settings = { ...DEFAULT_SNOW_WEATHER_SETTINGS };
  regional = 0;
  regionalTarget = 0;
  flakeCount;
  constructor(options) {
    this.snowfallSettings = { ...DEFAULT_WEATHER_EFFECTS.snowfall, ...options.snowfall };
    this.group.name = "weather-snow";
    // WebGPU draws the camera-facing, three-population field; WebGL keeps the
    // crossed-quad flakes its shader material was written for.
    if (options.isWebGpu) {
      this.snowMaterial = createSnowfallField(this.snowfallSettings, options.seed);
      this.snowMesh = new THREE.Mesh(this.snowMaterial.geometry, this.snowMaterial.material);
      this.flakeCount = this.snowMaterial.geometry.instanceCount;
    } else {
      this.snowMaterial = createSnowShaderMaterial();
      this.snowMesh = new THREE.Mesh(createSnowGeometry(options.seed ?? 1374351373), this.snowMaterial.material);
      this.flakeCount = SNOW_FLAKE_COUNT;
    }
    this.snowMesh.name = "weather-snow-flakes";
    this.snowMesh.frustumCulled = false;
    this.snowMesh.renderOrder = 40;
    this.group.add(this.snowMesh);
    options.scene.add(this.group);
    this.applySettings(this.settings);
  }
  applySettings(settings) {
    this.settings = clampWindWeatherSettings(settings);
    this.refresh();
  }
  /**
   * Snow country (0..1) snows whatever the weather; the weather's snow
   * mode can only make it heavier.
   */
  setRegionalSnow(amount) {
    const coverage = Math.max(0, Math.min(1, Number(amount) || 0));
    const { regionalMinCoverage, regionalFullCoverage, regionalIntensity } = this.snowfallSettings;
    this.regionalTarget = THREE.MathUtils.smoothstep(coverage, regionalMinCoverage, regionalFullCoverage) * regionalIntensity;
  }
  /** The snow channel the field draws: the weather's, or the regional floor, whichever is heavier. */
  effectiveIntensity() {
    const weather = isWeatherVisible(this.settings) ? this.settings.intensity : 0;
    return Math.max(weather, this.regional * REGIONAL_LEVEL_KEY);
  }
  refresh() {
    const intensity = this.effectiveIntensity();
    this.group.visible = intensity > 1e-3;
    this.snowMaterial.setIntensity(intensity);
  }
  update(deltaSeconds, elapsedSeconds, cameraPosition, origin) {
    const dt = Math.max(0, Math.min(0.1, Number(deltaSeconds) || 0));
    const eased = this.regionalTarget + (this.regional - this.regionalTarget)
      * Math.exp(-this.snowfallSettings.regionalFadeRate * dt);
    this.regional = Math.abs(eased - this.regionalTarget) < 0.002 ? this.regionalTarget : eased;
    this.refresh();
    if (!this.group.visible) return;
    this.center.copy(cameraPosition);
    this.snowMaterial.setCenter(this.center);
    this.snowMaterial.setOrigin?.(origin);
    // Drift with the gust the grass and trees bend to at the camera.
    const level = Math.min(1, this.effectiveIntensity());
    const drift = snowDriftVelocity(worldWindCamera, evaluateLevels(this.snowfallSettings.levels.driftCap, level, PRECIP_LEVEL_KEYS));
    this.snowMaterial.setWind(drift.x, drift.z);
    this.snowMaterial.setTime(elapsedSeconds);
  }
  getStats() {
    if (!this.group.visible) return { flakes: 0 };
    const density = this.snowMaterial.getDensity?.();
    return { flakes: density ? density.live.reduce((sum, count) => sum + Math.round(count), 0) : this.flakeCount };
  }
  dispose() {
    this.group.removeFromParent();
    if (!this.snowMaterial.geometry) this.snowMesh.geometry.dispose();
    this.snowMaterial.dispose();
  }
}
export {
  REGIONAL_SNOW_INTENSITY,
  SnowWeatherSystem
};
