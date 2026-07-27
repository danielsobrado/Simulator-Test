import * as THREE from "three";
import { createStormNodeMaterial } from "./rainNodeMaterial.js";
import { createStormShaderMaterial } from "./rainShaderMaterial.js";
import { DEFAULT_STORM_WEATHER_SETTINGS } from "./rain_defaults.js";
import { placeCameraFacingBillboard } from "./weather_camera_billboard.js";
import { applyStormWeatherToMaterials, clampStormWeatherSettings, isWeatherVisible } from "./weather_settings.js";
const LIGHTNING_DISTANCE = 1.5;
class StormLightningSystem {
  group = new THREE.Group();
  stormMaterial;
  stormMesh;
  camera;
  center = new THREE.Vector3();
  cameraDirection = new THREE.Vector3();
  settings = { ...DEFAULT_STORM_WEATHER_SETTINGS };
  constructor(options) {
    this.camera = options.camera;
    this.group.name = "weather-storm";
    this.group.visible = this.settings.enabled;
    this.stormMaterial = options.isWebGpu ? createStormNodeMaterial() : createStormShaderMaterial();
    this.stormMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2, 1, 1), this.stormMaterial.material);
    this.stormMesh.name = "weather-storm-lightning";
    this.stormMesh.frustumCulled = false;
    this.stormMesh.renderOrder = 99;
    this.group.add(this.stormMesh);
    options.scene.add(this.group);
    this.applySettings(this.settings);
  }
  applySettings(settings) {
    this.settings = clampStormWeatherSettings(settings);
    this.group.visible = isWeatherVisible(this.settings);
    applyStormWeatherToMaterials(this.settings, [this.stormMaterial]);
  }
  update(deltaSeconds, elapsedSeconds, cameraPosition) {
    void deltaSeconds;
    if (!this.group.visible) return;
    this.center.copy(cameraPosition);
    this.stormMaterial.setTime(elapsedSeconds);
    placeCameraFacingBillboard({
      camera: this.camera,
      mesh: this.stormMesh,
      cameraPosition,
      distance: LIGHTNING_DISTANCE,
      scratchDirection: this.cameraDirection
    });
  }
  getStats() {
    return { active: this.group.visible };
  }
  dispose() {
    this.group.removeFromParent();
    this.stormMesh.geometry.dispose();
    this.stormMaterial.dispose();
  }
}
export {
  StormLightningSystem
};
