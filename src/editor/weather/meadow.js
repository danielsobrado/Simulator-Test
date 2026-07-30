import * as THREE from "three";
import { getSunLightGpuAtlas } from "../_clod_shims/sun_light_gpu_atlas.js";
import {
  DEFAULT_MEADOW_WEATHER_SETTINGS,
  MEADOW_CELL_SIZE,
  MEADOW_MODE_VISUAL_AMOUNT,
  MEADOW_MODE_VISIBILITY_GAIN,
  MEADOW_PARTICLE_COUNT
} from "./meadow_defaults.js";
import { createMeadowGeometry, createMeadowNodeMaterial, createMeadowShaderMaterial } from "./meadow_material.js";
class MeadowWeatherSystem {
  group = new THREE.Group();
  meadowMaterial;
  meadowMesh;
  anchor = new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN);
  settings = cloneSettings(DEFAULT_MEADOW_WEATHER_SETTINGS);
  visualAmount = 0;
  atlasValid = false;
  atlasVersion = -1;
  frame = 0;
  constructor(options) {
    this.group.name = "weather-meadow";
    const geometry = createMeadowGeometry(options.seed ?? 1832554273);
    this.meadowMaterial = options.isWebGpu ? createMeadowNodeMaterial() : createMeadowShaderMaterial();
    this.meadowMesh = new THREE.Mesh(geometry, this.meadowMaterial.material);
    this.meadowMesh.name = "weather-sunbeam-motes";
    this.meadowMesh.frustumCulled = true;
    this.meadowMesh.renderOrder = 43;
    this.group.add(this.meadowMesh);
    options.scene.add(this.group);
    this.applySettings(this.settings);
  }
  applySettings(settings) {
    this.settings = cloneSettings(settings);
    this.meadowMesh.geometry.instanceCount = Math.min(
      MEADOW_PARTICLE_COUNT,
      Math.max(0, Math.floor(this.settings.motes.maxParticles))
    );
    this.meadowMaterial.setIntensity(THREE.MathUtils.clamp(this.settings.intensity, 0, 1.6));
    this.meadowMaterial.setWind(
      THREE.MathUtils.clamp(this.settings.windX, -5, 5),
      THREE.MathUtils.clamp(this.settings.windZ, -5, 5)
    );
    this.meadowMaterial.setMoteSettings(this.settings.motes);
    this.applyVisibility();
  }
  update(deltaSeconds, elapsedSeconds, focus, environment) {
    void deltaSeconds;
    this.visualAmount = THREE.MathUtils.clamp(environment.amount, 0, 1);
    this.applyVisibility();
    if (!this.group.visible) return;
    const nextX = Math.floor(focus.x / MEADOW_CELL_SIZE) * MEADOW_CELL_SIZE + MEADOW_CELL_SIZE * 0.5;
    const nextZ = Math.floor(focus.z / MEADOW_CELL_SIZE) * MEADOW_CELL_SIZE + MEADOW_CELL_SIZE * 0.5;
    if (!Number.isFinite(this.anchor.x) || Math.abs(nextX - this.anchor.x) > 1e-3 || Math.abs(nextZ - this.anchor.z) > 1e-3) {
      this.anchor.set(nextX, focus.y, nextZ);
      this.group.position.copy(this.anchor);
      this.meadowMaterial.setCenter(this.anchor);
    } else if (Math.abs(focus.y - this.anchor.y) > 0.25) {
      this.anchor.y = focus.y;
      this.group.position.y = focus.y;
      this.meadowMaterial.setCenter(this.anchor);
    }
    this.meadowMaterial.setTime(elapsedSeconds);
    this.meadowMaterial.setEnvironment(environment);
    this.syncSunVisibilityAtlas();
    this.frame += 1;
  }
  getStats() {
    const activeParticles = this.group.visible ? Math.floor(this.meadowMesh.geometry.instanceCount * this.settings.motes.density) : 0;
    return {
      particles: activeParticles,
      atlasValid: this.atlasValid,
      visualAmount: this.visualAmount
    };
  }
  dispose() {
    this.group.removeFromParent();
    this.meadowMesh.geometry.dispose();
    this.meadowMaterial.dispose();
  }
  applyVisibility() {
    const motes = this.settings.motes;
    this.group.visible = this.settings.enabled && motes.enabled && this.settings.intensity > 1e-3 && motes.strength > 1e-3 && motes.maxParticles > 0 && motes.density > 1e-3 && this.visualAmount > 1e-3;
  }
  syncSunVisibilityAtlas() {
    const atlas = getSunLightGpuAtlas();
    const updatePeriod = Math.max(1, this.settings.motes.updatePeriodFrames);
    if (atlas.version === this.atlasVersion && this.frame % updatePeriod !== 0) return;
    this.atlasVersion = atlas.version;
    this.atlasValid = atlas.valid > 0;
    this.meadowMaterial.setSunVisibilityAtlas(
      atlas.originX,
      atlas.originZ,
      atlas.worldSize,
      atlas.valid
    );
  }
}
function cloneSettings(settings) {
  return {
    enabled: settings.enabled,
    intensity: settings.intensity,
    windX: settings.windX,
    windZ: settings.windZ,
    motes: {
      ...settings.motes,
      warmColorRgb: [...settings.motes.warmColorRgb],
      coldColorRgb: [...settings.motes.coldColorRgb]
    }
  };
}
export {
  DEFAULT_MEADOW_WEATHER_SETTINGS,
  MEADOW_CELL_SIZE,
  MEADOW_MODE_VISUAL_AMOUNT,
  MEADOW_MODE_VISIBILITY_GAIN,
  MEADOW_PARTICLE_COUNT,
  MeadowWeatherSystem
};
