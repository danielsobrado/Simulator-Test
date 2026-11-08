import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';

import {
  SNOWFALL_POPULATIONS,
  createSnowfallField,
  createSnowfallGeometry,
  snowfallFlakeCount,
} from '../src/editor/weather/snowfall/SnowfallField.js';
import { REGIONAL_SNOW_INTENSITY, SnowWeatherSystem, snowDriftVelocity } from '../src/editor/weather/snow_system.js';

test('the seeded flake populations share one quad and retain their size and appearance profiles', () => {
  const geometry = createSnowfallGeometry(SNOWFALL_POPULATIONS, () => 0.5);
  const seeds = geometry.attributes.snowSeed;
  const shapes = geometry.attributes.snowShape;
  assert.equal(seeds.count, snowfallFlakeCount());
  assert.equal(geometry.attributes.position.count, 4, 'all flakes share one quad');
  assert.equal(geometry.instanceCount, snowfallFlakeCount());
  let start = 0;
  for (const population of SNOWFALL_POPULATIONS) {
    const ranks = Array.from({ length: population.count }, (_, i) => seeds.getW(start + i));
    assert.ok(ranks[0] < 1 / population.count + 1e-9 && ranks.at(-1) > 1 - 1 / population.count - 1e-9);
    const appearance = geometry.attributes.snowAppearance;
    assert.equal(appearance.getY(start), population.softness, 'soft lens flakes keep their population profile');
    assert.ok(shapes.getZ(start) >= population.sizeMin && shapes.getZ(start) <= population.sizeMax);
    start += population.count;
  }
  geometry.dispose();
});

test('the drift integrates the wind, so a gust never jumps the field', () => {
  const field = createSnowfallField();
  field.setWind(1, 0);
  field.setTime(0);
  let previous = 0;
  for (let frame = 1; frame <= 600; frame += 1) {
    field.setTime(frame / 60);
    const drift = field.uniforms.drift.value.x;
    assert.ok(drift - previous >= 0 && drift - previous < 0.05, `frame ${frame} moved ${drift - previous}`);
    previous = drift;
  }
  assert.ok(Math.abs(previous - 10) < 1e-6, `ten seconds of a 1 m/s wind (${previous})`);
  assert.equal(field.uniforms.drift.value.y, 0);
  field.dispose();
});

test('coverage-driven snow fades in with the weather off, and weather snow only adds', () => {
  const scene = new THREE.Scene();
  const snow = new SnowWeatherSystem({ scene, isWebGpu: true });
  snow.applySettings({ enabled: false, intensity: 0.7, windX: 0, windZ: 0 });
  assert.equal(snow.group.visible, false);
  snow.setRegionalSnow(1);
  assert.equal(snow.group.visible, false, 'regional snow starts through the update fade');
  snow.update(0.1, 0.1, new THREE.Vector3());
  assert.equal(snow.group.visible, true);
  assert.ok(snow.snowMaterial.uniforms.intensity.value > 0 && snow.snowMaterial.uniforms.intensity.value < 0.2);
  for (let frame = 2; frame <= 60; frame++) snow.update(0.1, frame / 10, new THREE.Vector3());
  assert.equal(snow.snowMaterial.uniforms.intensity.value, REGIONAL_SNOW_INTENSITY);
  snow.applySettings({ enabled: true, intensity: 1.2, windX: 0, windZ: 0 });
  assert.equal(snow.snowMaterial.uniforms.intensity.value, 1.2);
  snow.applySettings({ enabled: false, intensity: 1.2, windX: 0, windZ: 0 });
  snow.setRegionalSnow(0);
  for (let frame = 61; frame <= 120; frame++) snow.update(0.1, frame / 10, new THREE.Vector3());
  assert.equal(snow.group.visible, false);
  assert.equal(snow.getStats().flakes, 0);
  snow.dispose();
});

test('regional coverage thresholds and intensity are configurable without changing the flake budget', () => {
  const snow = new SnowWeatherSystem({ scene: new THREE.Scene(), isWebGpu: true,
    snowfall: { regionalIntensity: 0.5, regionalMinCoverage: 0.2, regionalFullCoverage: 0.7 } });
  const count = snow.flakeCount;
  snow.setRegionalSnow(0.1);
  snow.update(0.1, 0.1, new THREE.Vector3());
  assert.equal(snow.group.visible, false);
  snow.setRegionalSnow(0.6);
  for (let frame = 1; frame <= 60; frame++) snow.update(0.1, frame / 10, new THREE.Vector3());
  assert.ok(Math.abs(snow.effectiveIntensity() - 0.448) < 0.002);
  assert.equal(snow.flakeCount, count);
  snow.dispose();
});

test('flakes drift with the world wind, not a separate snow wind', async () => {
  const { worldWindCamera } = await import('../src/editor/weather/wind/worldWindState.js');
  const before = { ...worldWindCamera };
  Object.assign(worldWindCamera, { directionX: 0, directionZ: 1, envelope: 1, storm: 0 });
  const snow = new SnowWeatherSystem({ scene: new THREE.Scene(), isWebGpu: true });
  snow.applySettings({ enabled: true, intensity: 1, windX: -3, windZ: 0 });
  snow.update(0.1, 0, new THREE.Vector3());
  snow.update(0.1, 1, new THREE.Vector3());
  const drift = snow.snowMaterial.uniforms.drift.value;
  assert.ok(drift.y > 0.1 && Math.abs(drift.x) < 1e-6, `drift follows the world wind (${drift.x}, ${drift.y})`);
  Object.assign(worldWindCamera, before);
  snow.dispose();
});

test('a storm wind drives a blizzard drift, capped at 15 m/s', () => {
  const calm = snowDriftVelocity({ directionX: 1, directionZ: 0, envelope: 1, storm: 0 });
  const gale = snowDriftVelocity({ directionX: 1, directionZ: 0, envelope: 2.4 * 2.5, storm: 1 });
  const gust = snowDriftVelocity({ directionX: 0, directionZ: -1, envelope: 2.4 * 7, storm: 1 });
  assert.ok(calm.x > 0.4 && calm.x < 0.8, `calm drift ${calm.x}`);
  assert.ok(gale.x > 8 && gale.x < 15, `gale drift ${gale.x}`);
  assert.equal(gust.z, -15);
});
