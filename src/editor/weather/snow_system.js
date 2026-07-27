import * as THREE from "three";
import { createSnowNodeMaterial } from "./rainNodeMaterial.js";
import { createSnowShaderMaterial } from "./rainShaderMaterial.js";
import { SNOW_FLAKE_COUNT } from "./rain_constants.js";
import { DEFAULT_SNOW_WEATHER_SETTINGS } from "./rain_defaults.js";
import { createSnowGeometry } from "./rain_geometry.js";
import { applyWindWeatherToMaterials, clampWindWeatherSettings, isWeatherVisible } from "./weather_settings.js";
class SnowWeatherSystem {
  group = new THREE.Group();
  snowMaterial;
  snowMesh;
  center = new THREE.Vector3();
  settings = { ...DEFAULT_SNOW_WEATHER_SETTINGS };
  constructor(options) {
    this.group.name = "weather-snow";
    this.group.visible = this.settings.enabled;
    this.snowMaterial = options.isWebGpu ? createSnowNodeMaterial() : createSnowShaderMaterial();
    this.snowMesh = new THREE.Mesh(createSnowGeometry(options.seed ?? 1374351373), this.snowMaterial.material);
    this.snowMesh.name = "weather-snow-flakes";
    this.snowMesh.frustumCulled = false;
    this.snowMesh.renderOrder = 40;
    this.group.add(this.snowMesh);
    options.scene.add(this.group);
    this.applySettings(this.settings);
  }
  applySettings(settings) {
    this.settings = clampWindWeatherSettings(settings);
    this.group.visible = isWeatherVisible(this.settings);
    applyWindWeatherToMaterials(this.settings, [this.snowMaterial]);
  }
  update(deltaSeconds, elapsedSeconds, cameraPosition) {
    void deltaSeconds;
    if (!this.group.visible) return;
    this.center.copy(cameraPosition);
    this.snowMaterial.setCenter(this.center);
    this.snowMaterial.setTime(elapsedSeconds);
  }
  getStats() {
    return { flakes: this.group.visible ? SNOW_FLAKE_COUNT : 0 };
  }
  dispose() {
    this.group.removeFromParent();
    this.snowMesh.geometry.dispose();
    this.snowMaterial.dispose();
  }
}
export {
  SnowWeatherSystem
};
