import test from 'node:test';
import assert from 'node:assert/strict';
import { float, vec3 } from 'three/tsl';

import { evaluateShaderNode as evaluate } from './helpers/evaluateShaderNode.js';
import { createRainWetnessShading, WET_ALBEDO_FLOOR } from '../src/editor/stylized/RainWetnessShading.js';
import { waterFresnel } from '../src/editor/stylized/PuddleShading.js';
import { surfaceWetnessUniform } from '../src/editor/weather/surfaceWetness.js';
import { resolveSurfaceWetnessConfig } from '../src/editor/weather/surfaceWetnessConfig.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('soaked ground and standing water keep at least the wet albedo floor', () => {
  const shading = (config) => createRainWetnessShading({ snow: float(0), canopy: float(0), config: resolveSurfaceWetnessConfig(config) });
  const albedo = (config, puddle) => evaluate(shading(config).apply(vec3(0.5), float(0.9), float(puddle)).color)[0] / 0.5;
  surfaceWetnessUniform.value = 0;
  close(albedo({}, 0), 1);
  surfaceWetnessUniform.value = 1;
  close(albedo({}, 0), 0.7);
  close(albedo({}, 1), WET_ALBEDO_FLOOR);
  close(albedo({ darkening: 1 }, 1), WET_ALBEDO_FLOOR);
  assert.ok(albedo({}, 0.3) < 0.7 && albedo({}, 0.3) > WET_ALBEDO_FLOOR, 'a shallow edge darkens part way');
  surfaceWetnessUniform.value = 0;
});

test('puddles reflect by water Fresnel: faint looking down, strong at grazing', () => {
  close(evaluate(waterFresnel(float(1))), 0.02);
  close(evaluate(waterFresnel(float(0))), 1);
  const values = [1, 0.6, 0.3, 0.1].map((c) => evaluate(waterFresnel(float(c))));
  values.slice(1).forEach((value, i) => assert.ok(value > values[i]));
});
