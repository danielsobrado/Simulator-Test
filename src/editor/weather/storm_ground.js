import * as THREE from "three";
import { DEFAULT_SEED, REPOSITION_DISTANCE, STRIKE_COUNT } from "./storm_ground_constants.js";
import { createImpactGeometry, createStrikeGeometry, markStrikeAttributesDirty } from "./storm_ground_geometry.js";
import {
  createStormGroundImpactNodeMaterial,
  createStormGroundImpactShaderMaterial,
  createStormGroundNodeMaterial,
  createStormGroundShaderMaterial
} from "./storm_ground_materials.js";
import { StormGroundStrikePlacement } from "./storm_ground_placement.js";
import { applyStormWeatherToMaterials, clampStormWeatherSettings, isWeatherVisible } from "./weather_settings.js";
class StormLightningSystem {
  group = new THREE.Group();
  strikeMaterial;
  impactMaterial;
  strikeMesh;
  impactMesh;
  buffers;
  placement;
  placementCenter = new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN);
  settings = { enabled: false, intensity: 1 };
  constructor(options) {
    this.placement = new StormGroundStrikePlacement(options.samplers, options.worldCells, options.seed ?? DEFAULT_SEED);
    this.group.name = "weather-storm";
    this.group.visible = this.settings.enabled;
    this.strikeMaterial = options.isWebGpu ? createStormGroundNodeMaterial() : createStormGroundShaderMaterial();
    this.impactMaterial = options.isWebGpu ? createStormGroundImpactNodeMaterial() : createStormGroundImpactShaderMaterial();
    const strikes = createStrikeGeometry(STRIKE_COUNT);
    this.buffers = strikes.buffers;
    this.strikeMesh = new THREE.Mesh(strikes.geometry, this.strikeMaterial.material);
    this.strikeMesh.name = "weather-storm-ground-lightning";
    this.strikeMesh.frustumCulled = false;
    this.strikeMesh.renderOrder = 96;
    this.impactMesh = new THREE.Mesh(createImpactGeometry(this.buffers), this.impactMaterial.material);
    this.impactMesh.name = "weather-storm-impact-roots";
    this.impactMesh.frustumCulled = false;
    this.impactMesh.renderOrder = 97;
    this.group.add(this.impactMesh, this.strikeMesh);
    options.scene.add(this.group);
    this.applySettings(this.settings);
  }
  applySettings(settings) {
    this.settings = clampStormWeatherSettings(settings);
    this.group.visible = isWeatherVisible(this.settings);
    applyStormWeatherToMaterials(this.settings, [this.strikeMaterial, this.impactMaterial]);
  }
  update(deltaSeconds, elapsedSeconds, focus) {
    void deltaSeconds;
    if (!this.group.visible) return;
    this.strikeMaterial.setTime(elapsedSeconds);
    this.impactMaterial.setTime(elapsedSeconds);
    if (!Number.isFinite(this.placementCenter.x) || this.placementCenter.distanceToSquared(focus) > REPOSITION_DISTANCE * REPOSITION_DISTANCE) {
      this.placementCenter.copy(focus);
      this.placement.reposition(this.buffers, focus);
      markStrikeAttributesDirty([this.strikeMesh.geometry, this.impactMesh.geometry]);
    }
  }
  getStats() {
    return { active: this.group.visible };
  }
  dispose() {
    this.group.removeFromParent();
    this.strikeMesh.geometry.dispose();
    this.impactMesh.geometry.dispose();
    this.strikeMaterial.dispose();
    this.impactMaterial.dispose();
  }
}
export {
  StormLightningSystem
};
