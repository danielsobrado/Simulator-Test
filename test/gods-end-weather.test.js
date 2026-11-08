import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';
import * as THREE from 'three/webgpu';
import { createCinematicRainField } from '../src/editor/weather/CinematicRainField.js';
import { DEFAULT_WEATHER_EFFECTS, resolveWeatherEffects } from '../src/editor/weather/WeatherEffectsConfig.js';
import { createSnowfallField } from '../src/editor/weather/snowfall/SnowfallField.js';
import { GodsEndLightShafts, shaftNormalization, shaftSourceReference } from '../src/editor/stylized/GodsEndLightShafts.js';
import { StylizedGodRaysPostProcess } from '../src/editor/stylized/StylizedGodRaysPostProcess.js';

test('weather configuration matches donor-scaled defaults and rejects unsafe fields', () => {
  const source = yaml.load(readFileSync(new URL('../config/weather-effects.yaml', import.meta.url), 'utf8'));
  assert.deepEqual(resolveWeatherEffects(source), DEFAULT_WEATHER_EFFECTS);
  const mid = DEFAULT_WEATHER_EFFECTS.rain.layers[1];
  for (const patch of [
    { rain: { layers: [] } }, { rain: { layers: [{ ...mid, counts: [0, 1, 2, 3, 32001] }] } },
    { rain: { layers: [{ ...mid, counts: [0, 1, 2.5] }] } }, { rain: { layers: [{ ...mid, top: -100 }] } },
    { rain: { levels: { opacity: [1, 1, 1, 1, 9] } } }, { rain: { levels: { fallSpeed: [12, 12] } } },
    { snowfall: { opacity: 2 } }, { snowfall: { speed: -1 } },
    { snowfall: { layers: [] } }, { rain: { colorLinear: [1, NaN, 1] } },
    { snowfall: { levels: { driftCap: [3, 3, 5, 9, -1] } } },
  ]) assert.throws(() => resolveWeatherEffects(patch), /weatherEffects/);
});

test('rain uses one four-vertex quad and keeps its field centred at camera height', () => {
  const field = createCinematicRainField();
  assert.equal(field.geometry.attributes.position.count, 4);
  assert.equal(field.geometry.instanceCount, 0, 'clear weather draws nothing');
  const center = new THREE.Vector3(1234, 876, -5678);
  field.setCenter(center);
  field.setTime(12.5);
  field.setWind(1, -2);
  field.setIntensity(0.7);
  assert.ok(field.geometry.instanceCount > 0 && field.geometry.instanceCount < 22500);
  assert.deepEqual(field.uniforms.center.value.toArray(), center.toArray());
  assert.deepEqual(field.uniforms.wind.value.toArray(), [1, -2]);
  assert.equal(field.uniforms.time.value, 12.5);
  assert.equal(field.uniforms.intensity.value, 1, 'moderate-to-heavy rain is fully opaque; density is count');
  // Travel integrates wind × gust, so a gust changes speed without moving drops.
  field.setGust(2);
  field.setTime(13.5);
  assert.deepEqual(field.uniforms.drift.value.toArray(), [0.5, -1], 'wind × gust × a dt clamped to 0.25 s');
  assert.ok(Math.abs(field.uniforms.fall.value - field.uniforms.fallSpeed.value * 0.25) < 1e-9, 'the fall integrates too');
  field.setGust(10);
  field.setTime(13.75);
  assert.deepEqual(field.uniforms.vector.value.toArray(), [4, -8], 'gust clamps at 4×');
  field.setIntensity(1);
  assert.equal(field.geometry.instanceCount, 22500, 'a full storm draws its whole allocation');
  assert.equal(field.uniforms.fallSpeed.value, 18);
  field.setIntensity(0);
  assert.equal(field.geometry.instanceCount, 0);
  let disposed = 0;
  field.geometry.addEventListener('dispose', () => { disposed += 1; });
  field.dispose();
  field.dispose();
  assert.equal(disposed, 1);
});

test('snow seeds repeat across recovery and its wind integral is frame-rate independent', () => {
  const a = createSnowfallField(undefined, 123);
  const b = createSnowfallField(undefined, 123);
  const c = createSnowfallField(undefined, 456);
  assert.deepEqual(a.geometry.attributes.snowSeed.array, b.geometry.attributes.snowSeed.array);
  assert.notDeepEqual(a.geometry.attributes.snowSeed.array, c.geometry.attributes.snowSeed.array);
  for (const [field, fps] of [[a, 60], [b, 120]]) {
    field.setWind(1, 0);
    field.setTime(0);
    for (let frame = 1; frame <= fps * 10; frame += 1) field.setTime(frame / fps);
  }
  assert.ok(Math.abs(a.uniforms.drift.value.x - b.uniforms.drift.value.x) < 1e-8);
  assert.ok(Math.abs(a.uniforms.drift.value.x - 10) < 1e-8);
  a.dispose(); b.dispose(); c.dispose();
});

test('snow stays in place through large-world floating-origin snaps', () => {
  const field = createSnowfallField();
  field.setOrigin({ x: 900000, z: -700000 });
  field.setCenter(new THREE.Vector3(256, 20, -128));
  const before = field.uniforms.phases.array.map(phase => phase.toArray());
  field.setOrigin({ x: 900256, z: -700128 });
  field.setCenter(new THREE.Vector3(0, 20, 0));
  assert.deepEqual(field.uniforms.phases.array.map(phase => phase.toArray()), before);
  field.dispose();
});

test('shafts conserve normalized energy, concentrate at the sun and own both targets', () => {
  for (const decay of [0, 0.965, 1]) {
    const weight = Array.from({ length: 32 }, (_, index) => decay ** index).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(weight * shaftNormalization(32, decay) - 1) < 1e-10);
  }
  assert.equal(shaftSourceReference(0, 0), 0);
  assert.equal(shaftSourceReference(1, 0), 1);
  assert.equal(shaftSourceReference(1, 0.45), 0);
  assert.ok(shaftSourceReference(1, 0.1) > shaftSourceReference(1, 0.3));
  const shafts = new GodsEndLightShafts({ depth: {}, sunUv: {}, intensity: { value: 0 } });
  assert.equal(shafts.mask.getResolutionScale(), 0.25);
  assert.equal(shafts.march.getResolutionScale(), 0.25);
  let disposed = 0;
  for (const target of [shafts.mask, shafts.march]) target.renderTarget.addEventListener('dispose', () => { disposed += 1; });
  shafts.dispose(); shafts.dispose();
  assert.equal(disposed, 2);
});

test('cinematic shafts boost snow-country light and fade completely at high noon', () => {
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 5000);
  const direction = new THREE.Vector3(0, 0.2, -1).normalize();
  camera.lookAt(direction);
  camera.updateMatrixWorld();
  const effect = new StylizedGodRaysPostProcess({ renderer: { samples: 0 }, scene: new THREE.Scene(),
    config: { enabled: true, technique: 'cinematic', intensity: 1 }, sunDirection: direction });
  effect.updateUniforms(camera);
  const lowland = effect.cinematicIntensity.value;
  assert.ok(lowland > 0);
  effect.setShaftAtmosphere(1);
  effect.updateUniforms(camera);
  assert.ok(Math.abs(effect.cinematicIntensity.value - lowland * 2.4) < 1e-8);
  effect.sunDirection.set(0, 1, 0);
  effect.updateUniforms(camera);
  assert.equal(effect.cinematicIntensity.value, 0);
  effect.dispose();
});
