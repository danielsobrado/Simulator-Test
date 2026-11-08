import * as THREE from "three";
import { createSplashNodeMaterial } from "./rainNodeMaterial.js";
import { createRainShaderMaterial, createSplashShaderMaterial } from "./rainShaderMaterial.js";
import { REPOSITION_DISTANCE } from "./rain_constants.js";
import { DEFAULT_WEATHER_EFFECTS } from "./WeatherEffectsConfig.js";
import { evaluateLevels, PRECIP_LEVEL_KEYS } from "./storm/stormCurves.js";
import { DEFAULT_RAIN_WEATHER_SETTINGS } from "./rain_defaults.js";
import { createRainGeometry, createSplashGeometry } from "./rain_geometry.js";
import { RainSplashPlacement } from "./rain_splash_placement.js";
import { createCinematicRainField } from './CinematicRainField.js';
import { worldWindCamera } from './wind/worldWindState.js';
import { applyWindWeatherToMaterials, clampWindWeatherSettings, isWeatherVisible } from "./weather_settings.js";
class RainWeatherSystem {
  group = new THREE.Group();
  rainMaterial;
  hardSplashMaterial;
  waterSplashMaterial;
  rainMesh;
  hardSplashMesh;
  waterSplashMesh;
  hardBuffers;
  waterBuffers;
  splashPlacement;
  placementCenter = new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN);
  rainCenter = new THREE.Vector3();
  settings = { ...DEFAULT_RAIN_WEATHER_SETTINGS };
  stats = { hardSplashes: 0, waterSplashes: 0 };
  constructor(options) {
    const seed = options.seed ?? 2403144135;
    this.rainSettings = options.rain ?? DEFAULT_WEATHER_EFFECTS.rain;
    this.splashPlacement = new RainSplashPlacement(options.samplers, options.worldCells, seed);
    this.group.name = "weather-rain";
    this.group.visible = this.settings.enabled;
    this.rainMaterial = options.isWebGpu
      ? createCinematicRainField(options.rain, seed)
      : createRainShaderMaterial();
    this.hardSplashMaterial = options.isWebGpu ? createSplashNodeMaterial("hard") : createSplashShaderMaterial("hard");
    this.waterSplashMaterial = options.isWebGpu ? createSplashNodeMaterial("water") : createSplashShaderMaterial("water");
    this.rainMesh = new THREE.Mesh(this.rainMaterial.geometry ?? createRainGeometry(seed), this.rainMaterial.material);
    this.rainMesh.name = "weather-rain-streaks";
    this.rainMesh.frustumCulled = false;
    this.rainMesh.renderOrder = 40;
    const hard = createSplashGeometry(Math.max(...this.rainSettings.levels.hardSplashes));
    this.hardBuffers = hard.buffers;
    this.hardSplashMesh = new THREE.Mesh(hard.geometry, this.hardSplashMaterial.material);
    this.hardSplashMesh.name = "weather-rain-hard-splashes";
    this.hardSplashMesh.frustumCulled = false;
    this.hardSplashMesh.renderOrder = 41;
    const water = createSplashGeometry(Math.max(...this.rainSettings.levels.waterSplashes));
    this.waterBuffers = water.buffers;
    this.waterSplashMesh = new THREE.Mesh(water.geometry, this.waterSplashMaterial.material);
    this.waterSplashMesh.name = "weather-rain-water-splashes";
    this.waterSplashMesh.frustumCulled = false;
    this.waterSplashMesh.renderOrder = 42;
    this.group.add(this.rainMesh, this.hardSplashMesh, this.waterSplashMesh);
    options.scene.add(this.group);
    this.applySettings(this.settings);
  }
  applySettings(settings) {
    this.settings = clampWindWeatherSettings(settings);
    this.group.visible = isWeatherVisible(this.settings);
    applyWindWeatherToMaterials(this.settings, [this.rainMaterial, this.hardSplashMaterial, this.waterSplashMaterial]);
    // Splashes are placed at random, so any prefix of the buffer is an even subset.
    const level = Math.min(1, Math.max(0, this.settings.intensity));
    const { hardSplashes, waterSplashes } = this.rainSettings.levels;
    this.hardSplashMesh.geometry.instanceCount = Math.round(evaluateLevels(hardSplashes, level, PRECIP_LEVEL_KEYS));
    this.waterSplashMesh.geometry.instanceCount = Math.round(evaluateLevels(waterSplashes, level, PRECIP_LEVEL_KEYS));
  }
  update(deltaSeconds, elapsedSeconds, cameraPosition, focus) {
    void deltaSeconds;
    if (!this.group.visible) return;
    this.rainCenter.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
    this.rainMaterial.setCenter(this.rainCenter);
    this.rainMaterial.setGust?.(worldWindCamera.envelope);
    this.rainMaterial.setTime(elapsedSeconds);
    this.hardSplashMaterial.setTime(elapsedSeconds);
    this.waterSplashMaterial.setTime(elapsedSeconds);
    if (!Number.isFinite(this.placementCenter.x) || this.placementCenter.distanceToSquared(focus) > REPOSITION_DISTANCE * REPOSITION_DISTANCE) {
      this.placementCenter.copy(focus);
      this.stats = this.splashPlacement.reposition(
        focus,
        this.hardBuffers,
        this.waterBuffers,
        this.hardSplashMesh.geometry,
        this.waterSplashMesh.geometry
      );
    }
  }
  getStats() {
    const visible = this.group.visible;
    return {
      hardSplashes: visible ? Math.min(this.stats.hardSplashes, this.hardSplashMesh.geometry.instanceCount) : 0,
      waterSplashes: visible ? Math.min(this.stats.waterSplashes, this.waterSplashMesh.geometry.instanceCount) : 0,
      drops: visible ? this.rainMaterial.getDensity?.().live.reduce((sum, count) => sum + Math.round(count), 0)
        ?? this.rainMesh.geometry.instanceCount : 0,
    };
  }
  dispose() {
    this.group.removeFromParent();
    if (!this.rainMaterial.geometry) this.rainMesh.geometry.dispose();
    this.hardSplashMesh.geometry.dispose();
    this.waterSplashMesh.geometry.dispose();
    this.rainMaterial.dispose();
    this.hardSplashMaterial.dispose();
    this.waterSplashMaterial.dispose();
  }
}
export {
  RainWeatherSystem
};
