import * as THREE from "three";
import { createRainNodeMaterial, createSplashNodeMaterial } from "./rainNodeMaterial.js";
import { createRainShaderMaterial, createSplashShaderMaterial } from "./rainShaderMaterial.js";
import { HARD_SPLASH_COUNT, REPOSITION_DISTANCE, WATER_SPLASH_COUNT } from "./rain_constants.js";
import { DEFAULT_RAIN_WEATHER_SETTINGS } from "./rain_defaults.js";
import { createRainGeometry, createSplashGeometry } from "./rain_geometry.js";
import { RainSplashPlacement } from "./rain_splash_placement.js";
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
    this.splashPlacement = new RainSplashPlacement(options.samplers, options.worldCells, seed);
    this.group.name = "weather-rain";
    this.group.visible = this.settings.enabled;
    this.rainMaterial = options.isWebGpu ? createRainNodeMaterial() : createRainShaderMaterial();
    this.hardSplashMaterial = options.isWebGpu ? createSplashNodeMaterial("hard") : createSplashShaderMaterial("hard");
    this.waterSplashMaterial = options.isWebGpu ? createSplashNodeMaterial("water") : createSplashShaderMaterial("water");
    this.rainMesh = new THREE.Mesh(createRainGeometry(seed), this.rainMaterial.material);
    this.rainMesh.name = "weather-rain-streaks";
    this.rainMesh.frustumCulled = false;
    this.rainMesh.renderOrder = 40;
    const hard = createSplashGeometry(HARD_SPLASH_COUNT);
    this.hardBuffers = hard.buffers;
    this.hardSplashMesh = new THREE.Mesh(hard.geometry, this.hardSplashMaterial.material);
    this.hardSplashMesh.name = "weather-rain-hard-splashes";
    this.hardSplashMesh.frustumCulled = false;
    this.hardSplashMesh.renderOrder = 41;
    const water = createSplashGeometry(WATER_SPLASH_COUNT);
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
  }
  update(deltaSeconds, elapsedSeconds, cameraPosition, focus) {
    void deltaSeconds;
    if (!this.group.visible) return;
    this.rainCenter.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
    this.rainMaterial.setCenter(this.rainCenter);
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
    return { ...this.stats };
  }
  dispose() {
    this.group.removeFromParent();
    this.rainMesh.geometry.dispose();
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
