import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import yaml from 'js-yaml';
import { resolveSkyLook, mixSkyLooks, overcastSkyLook } from '../src/editor/stylized/sky/SkyLook.js';
import { SkyLookController } from '../src/editor/stylized/sky/SkyLookController.js';
import { applySceneEnvironment, environmentLightScale } from '../src/editor/stylized/sky/sceneEnvironment.js';
import { StylizedSkyView } from '../src/editor/stylized/StylizedSkyView.js';
import { sceneExposure } from '../src/render/sceneExposure.js';
import { createWeatherController, sanitizeWeatherSettings } from '../src/editor/weather/weather_controller.js';
import { ambientPresetName } from '../src/editor/stylized/ambient/ambientPresets.js';

const { stylizedSurface } = yaml.load(await readFile(new URL('../editor.config.yaml', import.meta.url), 'utf8'));
const { sky } = stylizedSurface;
const base = resolveSkyLook(sky, 'configured');
const day = resolveSkyLook(sky, 'highfield');
const sunset = resolveSkyLook(sky, 'emberfall');
const night = resolveSkyLook(sky, 'moonrise');

test('HDR follows day, sunset and night energy without compensating for output exposure', () => {
  assert.equal(environmentLightScale(base, base), 1);
  const dayScale = environmentLightScale(day, base);
  const sunsetScale = environmentLightScale(sunset, base);
  const nightScale = environmentLightScale(night, base);
  assert.ok(dayScale > sunsetScale && sunsetScale > nightScale);
  assert.ok(nightScale < dayScale * 0.2, 'morning reflections must not dominate night');
  assert.equal(environmentLightScale({ ...day, exposure: 2 }, base), dayScale);
  assert.equal(environmentLightScale(day, { ...base, directionalIntensity: 0, ambientIntensity: 0 }), 0);
});

test('cloud cover softens shadows and reduces direct light relative to fill at every hour', () => {
  for (const look of [day, sunset, night]) {
    let previousScale = environmentLightScale(look, base);
    for (let i = 1; i <= 20; i += 1) {
      const covered = overcastSkyLook(look, i / 20);
      assert.ok(covered.directionalIntensity / covered.ambientIntensity < look.directionalIntensity / look.ambientIntensity);
      assert.ok(covered.shadowRadius > look.shadowRadius);
      assert.ok(covered.cloudShadowStrength < look.cloudShadowStrength);
      assert.ok(covered.fogDensityScale > look.fogDensityScale);
      const scale = environmentLightScale(covered, base);
      assert.ok(Number.isFinite(scale) && scale >= 0 && scale <= previousScale);
      previousScale = scale;
    }
    assert.equal(overcastSkyLook(look, 1).cloudShadowStrength, 0);
  }
});

test('day/night and weather transitions keep HDR energy continuous', () => {
  const scales = [];
  const controller = new SkyLookController({
    skyView: { config: { sky }, applyLook: look => scales.push(environmentLightScale(look, base)) },
    preset: 'highfield',
  });
  controller.update(0);
  controller.setPreset('emberfall');
  controller.setOvercast(1);
  for (let i = 0; i < 200; i += 1) controller.update(1 / 30);
  controller.setPreset('moonrise');
  for (let i = 0; i < 200; i += 1) controller.update(1 / 30);
  assert.ok(scales.every(Number.isFinite));
  assert.ok(Math.max(...scales.slice(1).map((scale, i) => Math.abs(scale - scales[i]))) < 0.03);
  assert.equal(scales.at(-1), environmentLightScale(overcastSkyLook(night, 1), base));
  for (let i = 0; i <= 100; i += 1) {
    const look = mixSkyLooks(sunset, night, i / 100);
    assert.ok(environmentLightScale(look, base) >= 0);
  }
});

test('a late HDR load uses the current light and subsequent changes reuse its texture', async t => {
  let finishLoad;
  t.mock.method(HDRLoader.prototype, 'loadAsync', () => new Promise(resolve => { finishLoad = resolve; }));
  const scene = new THREE.Scene();
  const texture = new THREE.Texture();
  const environment = applySceneEnvironment(scene, { url: '/test.hdr', intensity: 0.3 });
  environment.setLightScale(0.1);
  finishLoad(texture);
  assert.equal(await environment.ready, texture);
  assert.equal(scene.environmentIntensity, 0.03, 'no morning flash after a night-time load');
  environment.setLightScale(0.5);
  assert.equal(scene.environmentIntensity, 0.15);
  assert.equal(scene.environment, texture, 'no HDR regeneration on time or weather changes');
  environment.setLightScale(Number.NaN);
  assert.equal(scene.environmentIntensity, 0.15);
  let disposed = false;
  texture.addEventListener('dispose', () => { disposed = true; });
  environment.dispose();
  assert.equal(scene.environment, null);
  assert.equal(disposed, true);
});

test('the production sky rig applies resolved HDR and exposure against the configured reference', async t => {
  t.mock.method(HDRLoader.prototype, 'loadAsync', async () => new THREE.Texture());
  const previousExposure = sceneExposure.scale;
  const terrainView = { scene: new THREE.Scene(),
    renderer: { toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.12 },
    godRays: { sunDirection: new THREE.Vector3(), setCloudMaskScene() {}, setVolumetricLight() {}, setLight() {} } };
  const view = new StylizedSkyView({ terrainView, config: stylizedSurface });
  try {
    await view.environment.ready;
    for (const look of [base, day, sunset, night, overcastSkyLook(day, 1)]) {
      view.applyLook(look);
      assert.equal(terrainView.scene.environmentIntensity, sky.environment.intensity * environmentLightScale(look, base));
      assert.equal(terrainView.renderer.toneMappingExposure, 1.12 * look.exposure);
      assert.equal(view.directional.shadow.radius, look.shadowRadius);
    }
  } finally { view.dispose(); sceneExposure.scale = previousExposure; }
});

test('disabled or disposed environment cannot publish a late HDR', async t => {
  const scene = new THREE.Scene();
  const disabled = applySceneEnvironment(scene, { enabled: false, url: '/test.hdr' });
  disabled.setLightScale(0.5);
  assert.equal(await disabled.ready, null);
  let finishLoad;
  t.mock.method(HDRLoader.prototype, 'loadAsync', () => new Promise(resolve => { finishLoad = resolve; }));
  const environment = applySceneEnvironment(scene, { url: '/test.hdr' });
  environment.dispose();
  const texture = new THREE.Texture();
  let disposed = false;
  texture.addEventListener('dispose', () => { disposed = true; });
  finishLoad(texture);
  assert.equal(await environment.ready, null);
  assert.equal(scene.environment, null);
  assert.equal(disposed, true);
});

test('dry overcast is selectable and activates no precipitation or storm systems', () => {
  const settings = sanitizeWeatherSettings({ weatherMode: 'overcast', weatherIntensity: 1 });
  assert.equal(settings.weatherMode, 'overcast');
  assert.equal(ambientPresetName({ skyPreset: 'highfield', weatherMode: 'overcast' }), 'calm');
  assert.equal(ambientPresetName({ skyPreset: 'moonrise', weatherMode: 'overcast', night: true }), 'moonlight');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const controller = createWeatherController({ scene, camera, isWebGpu: true, worldCells: 1024,
    samplers: { surfaceHeight: () => 0, surfaceNormal: () => [0, 1, 0], waterSample: () => ({ depth: 0, bodyMask: 0, waterY: 0 }) },
    getSettings: () => settings, getCamera: () => camera });
  try {
    assert.equal(controller.getStats().mode, 'overcast');
    assert.equal(controller.storm.cloud, 1);
    assert.equal(controller.storm.precip, 0);
    for (const name of ['rain', 'snow', 'sandstorm', 'storm', 'wind']) {
      assert.equal(scene.getObjectByName(`weather-${name}`).visible, false, name);
    }
  } finally { controller.dispose(); }
});

test('full overcast closes the cloud deck under any regional sky', () => {
  const clear = { ...resolveSkyLook({ preset: 'highfield' }), cloudDensity: 0.7 };
  const covered = overcastSkyLook(clear, 1);
  assert.ok(covered.cloudDensity + covered.cloudSharpness < 0.25, 'cloud noise must clear the threshold everywhere');
  assert.ok(overcastSkyLook(clear, 0.4).cloudDensity > 0.3, 'light cover stays broken');
});
