import * as THREE from "three";
import { Rng, hashCombine, hashString } from '../_clod_shims/seed.js';
import { createWindNodeMaterial } from "./windNodeMaterial.js";
import { createWindShaderMaterial } from "./windShaderMaterial.js";
const WIND_RIBBON_COUNT = 7200;
const WIND_NEAR_COUNT = 2800;
const WIND_MID_COUNT = 2600;
const WIND_FAR_COUNT = 1800;
const DEFAULT_WIND_WEATHER_SETTINGS = {
  enabled: false,
  intensity: 0.95,
  windX: -2.2,
  windZ: 0.36
};
class WindWeatherSystem {
  group = new THREE.Group();
  material;
  mesh;
  settings = { ...DEFAULT_WIND_WEATHER_SETTINGS };
  constructor(options) {
    void options.camera;
    this.group.name = "weather-wind";
    this.group.visible = this.settings.enabled;
    this.material = options.isWebGpu ? createWindNodeMaterial() : createWindShaderMaterial();
    this.mesh = new THREE.Mesh(createWindGeometry(options.seed ?? 1911639313), this.material.material);
    this.mesh.name = "weather-wind-ribbons";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 39;
    this.group.add(this.mesh);
    options.scene.add(this.group);
    this.applySettings(this.settings);
  }
  applySettings(settings) {
    this.settings = {
      enabled: settings.enabled,
      intensity: THREE.MathUtils.clamp(settings.intensity, 0, 1.6),
      windX: THREE.MathUtils.clamp(settings.windX, -8, 8),
      windZ: THREE.MathUtils.clamp(settings.windZ, -8, 8)
    };
    this.group.visible = this.settings.enabled && this.settings.intensity > 1e-3;
    this.material.setIntensity(this.settings.intensity);
    this.material.setWind(this.settings.windX, this.settings.windZ);
  }
  update(deltaSeconds, elapsedSeconds, cameraPosition) {
    void deltaSeconds;
    if (!this.group.visible) return;
    this.material.setTime(elapsedSeconds);
    this.material.setCenter(cameraPosition);
  }
  getStats() {
    return { ribbons: WIND_RIBBON_COUNT };
  }
  dispose() {
    this.group.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
function createWindGeometry(seed) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
    -1,
    -1,
    0,
    1,
    -1,
    0,
    -1,
    1,
    0,
    1,
    1,
    0,
    0,
    -1,
    -1,
    0,
    -1,
    1,
    0,
    1,
    -1,
    0,
    1,
    1
  ]), 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([
    0,
    0,
    1,
    0,
    0,
    1,
    1,
    1,
    0,
    0,
    1,
    0,
    0,
    1,
    1,
    1
  ]), 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([
    0,
    1,
    2,
    2,
    1,
    3,
    4,
    5,
    6,
    6,
    5,
    7
  ]), 1));
  geometry.instanceCount = WIND_RIBBON_COUNT;
  const offset = new Float32Array(WIND_RIBBON_COUNT * 4);
  const shape = new Float32Array(WIND_RIBBON_COUNT * 4);
  const rng = new Rng(hashCombine(seed, hashString("wind-ribbons")));
  writeWindBand({ rng, offset, shape, start: 0, count: WIND_NEAR_COUNT, area: 34, yMin: 0.04, yMax: 2.2, sizeMin: 0.045, sizeMax: 0.16, opacityMin: 0.035, opacityMax: 0.115, speedMin: 2, speedMax: 5.8 });
  writeWindBand({ rng, offset, shape, start: WIND_NEAR_COUNT, count: WIND_MID_COUNT, area: 58, yMin: 0.18, yMax: 5, sizeMin: 0.035, sizeMax: 0.12, opacityMin: 0.022, opacityMax: 0.085, speedMin: 3.5, speedMax: 7.4 });
  writeWindBand({ rng, offset, shape, start: WIND_NEAR_COUNT + WIND_MID_COUNT, count: WIND_FAR_COUNT, area: 88, yMin: 0.6, yMax: 9, sizeMin: 0.024, sizeMax: 0.084, opacityMin: 0.014, opacityMax: 0.055, speedMin: 5.2, speedMax: 9.5 });
  geometry.setAttribute("aWindOffset", new THREE.InstancedBufferAttribute(offset, 4));
  geometry.setAttribute("aWindShape", new THREE.InstancedBufferAttribute(shape, 4));
  return geometry;
}
function writeWindBand(options) {
  const { rng, offset, shape } = options;
  for (let i = 0; i < options.count; i++) {
    const o = (options.start + i) * 4;
    offset[o] = rng.range(-options.area * 0.5, options.area * 0.5);
    offset[o + 1] = rng.float();
    offset[o + 2] = rng.range(options.yMin, options.yMax);
    offset[o + 3] = options.area;
    shape[o] = rng.range(options.sizeMin, options.sizeMax);
    shape[o + 1] = rng.range(options.opacityMin, options.opacityMax);
    shape[o + 2] = rng.range(options.speedMin, options.speedMax);
    shape[o + 3] = rng.float() * 1e3;
  }
}
export {
  DEFAULT_WIND_WEATHER_SETTINGS,
  WindWeatherSystem
};
