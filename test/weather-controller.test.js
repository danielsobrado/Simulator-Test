import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  createWeatherController,
  normalizeSunDirection,
  sanitizeWeatherSettings,
} from '../src/editor/weather/weather_controller.js';

const WEATHER_GROUPS = Object.freeze([
  'weather-meadow',
  'weather-wind',
  'weather-rain',
  'weather-snow',
  'weather-sandstorm',
  'weather-storm',
]);

function createSamplers() {
  return {
    surfaceHeight: () => 0,
    surfaceNormal: () => [0, 1, 0],
    waterSample: () => ({ depth: 0, bodyMask: 0, waterY: 0 }),
  };
}

test('weather settings reject unknown modes and clamp unsafe values', () => {
  assert.deepEqual(
    sanitizeWeatherSettings({
      weatherMode: 'acid-rain',
      weatherIntensity: 99,
      weatherWindX: -20,
      weatherWindZ: Number.NaN,
    }),
    {
      weatherMode: 'off',
      weatherIntensity: 1.6,
      weatherWindX: -5,
      weatherWindZ: 0.18,
    },
  );
});

test('sun direction normalization reuses the supplied vector and rejects zero vectors', () => {
  const target = new THREE.Vector3();
  const result = normalizeSunDirection([0, 0, 0], target);

  assert.equal(result, target);
  assert.ok(Math.abs(target.length() - 1) < 1e-9);
  assert.ok(target.y > 0);
});

test('weather controller applies VFX material policy and restores visibility after warmup', async () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const settings = {
    weatherMode: 'off',
    weatherIntensity: 0.8,
    weatherWindX: -0.5,
    weatherWindZ: 0.2,
  };
  const controller = createWeatherController({
    scene,
    camera,
    isWebGpu: true,
    worldCells: 1024,
    samplers: createSamplers(),
    getSettings: () => settings,
    getCamera: () => camera,
  });

  const groups = WEATHER_GROUPS.map((name) => scene.getObjectByName(name));
  assert.ok(groups.every(Boolean));
  assert.ok(groups.every((group) => group.visible === false));
  assert.ok(scene.getObjectByName('weather-shader-warmup-probe'));

  for (const group of groups) {
    group.traverse((object) => {
      const materials = Array.isArray(object.material)
        ? object.material
        : object.material
          ? [object.material]
          : [];
      for (const material of materials) {
        assert.equal(material.toneMapped, false);
        if (material.transparent && material.side === THREE.DoubleSide) {
          assert.equal(material.forceSinglePass, true);
        }
      }
    });
  }

  settings.weatherMode = 'rain';
  assert.equal(controller.applySettings(), true);
  assert.equal(scene.getObjectByName('weather-rain').visible, true);

  let compileCalls = 0;
  const renderer = {
    compileAsync(root, activeCamera) {
      compileCalls += 1;
      assert.equal(root, scene);
      assert.equal(activeCamera, camera);
      assert.ok(groups.every((group) => group.visible));
      return Promise.resolve();
    },
  };

  assert.equal(await controller.precompile(renderer, camera), true);
  assert.equal(compileCalls, 1);
  assert.equal(scene.getObjectByName('weather-rain').visible, true);
  assert.ok(groups.filter((group) => group.name !== 'weather-rain').every((group) => !group.visible));
  assert.equal(scene.getObjectByName('weather-shader-warmup-probe'), undefined);

  controller.dispose();
  assert.ok(WEATHER_GROUPS.every((name) => scene.getObjectByName(name) === undefined));
});
