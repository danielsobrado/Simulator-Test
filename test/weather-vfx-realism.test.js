import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { Rng } from '../src/editor/_clod_shims/seed.js';
import { createSnowGeometry, createSplashGeometry } from '../src/editor/weather/rain_geometry.js';
import { RainSplashPlacement } from '../src/editor/weather/rain_splash_placement.js';
import { resolveMeadowSettings } from '../src/editor/weather/weather_controller.js';

function sortedSnowSizes(seed = 0x51eaf00d) {
  const geometry = createSnowGeometry(seed);
  const values = geometry.getAttribute('aSnowShape').array;
  const sizes = [];
  for (let i = 0; i < values.length; i += 4) sizes.push(values[i]);
  geometry.dispose();
  return sizes.sort((a, b) => a - b);
}

function activeScales(buffers) {
  const scales = [];
  for (let i = 0; i < buffers.params.length; i += 4) {
    if (buffers.params[i + 3] > 0) scales.push(buffers.params[i]);
  }
  return scales;
}

function makePlacement(waterSample) {
  return new RainSplashPlacement({
    surfaceHeight: () => 0,
    surfaceNormal: () => [0, 1, 0],
    waterSample,
  }, null, 0xdecafbad);
}

test('snow uses a small-biased size distribution with rare larger flakes', () => {
  const sizes = sortedSnowSizes();
  const mean = sizes.reduce((sum, size) => sum + size, 0) / sizes.length;
  const p10 = sizes[Math.floor(sizes.length * 0.1)];
  const p90 = sizes[Math.floor(sizes.length * 0.9)];

  assert.ok(mean >= 0.035 && mean <= 0.065, `mean flake half-size ${mean}`);
  assert.ok(sizes.at(-1) <= 0.13, `largest flake half-size ${sizes.at(-1)}`);
  assert.ok(p90 / p10 >= 2.2, `p90/p10 size ratio ${p90 / p10}`);
});

test('rain impacts stay within plausible stylized raindrop scales', () => {
  const focus = new THREE.Vector3(0, 0, 0);

  const hard = createSplashGeometry(256);
  makePlacement(() => ({ depth: 0, bodyMask: 0, waterY: 0 }))
    .place(hard.buffers, 'hard', new Rng(11), focus);
  const hardScales = activeScales(hard.buffers);
  assert.equal(hardScales.length, 256);
  assert.ok(Math.max(...hardScales) <= 0.18, `largest ground impact ${Math.max(...hardScales)}`);
  hard.geometry.dispose();

  const water = createSplashGeometry(256);
  makePlacement(() => ({ depth: 1, bodyMask: 1, waterY: 0 }))
    .place(water.buffers, 'water', new Rng(17), focus);
  const waterScales = activeScales(water.buffers);
  const meanWaterScale = waterScales.reduce((sum, scale) => sum + scale, 0) / waterScales.length;
  assert.equal(waterScales.length, 256);
  assert.ok(Math.max(...waterScales) <= 0.3, `largest water impact ${Math.max(...waterScales)}`);
  assert.ok(meanWaterScale <= 0.2, `mean water impact ${meanWaterScale}`);
  water.geometry.dispose();
});

test('meadow mode has an explicit visibility floor in both renderer paths', () => {
  const controller = readFileSync(
    new URL('../src/editor/weather/weather_controller.js', import.meta.url),
    'utf8',
  );
  const shader = readFileSync(
    new URL('../src/editor/weather/meadow_material.js', import.meta.url),
    'utf8',
  );

  assert.match(controller, /MEADOW_MODE_VISUAL_AMOUNT/);
  assert.match(shader, /MEADOW_MIN_ATLAS_VISIBILITY/);
  assert.match(shader, /MEADOW_MIN_FORWARD_SCATTER/);
  assert.match(shader, /sampledVisibility/);
});

test('selecting meadow enables motes even when startup mode was off', () => {
  const runtimeMotes = {
    enabled: false,
    warmColorRgb: [1, 0.8, 0.5],
    coldColorRgb: [0.8, 0.9, 1],
  };
  const settings = resolveMeadowSettings({
    weatherMode: 'meadow',
    weatherIntensity: 0.7,
    weatherWindX: 0,
    weatherWindZ: 0,
  }, runtimeMotes);

  assert.equal(settings.motes.enabled, true);
  assert.equal(runtimeMotes.enabled, false, 'runtime preferences remain immutable');
});
