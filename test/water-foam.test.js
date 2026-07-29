import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeGeographicFoam,
  computeIntersectionFoam,
  validateWaterFoamConfig,
} from '../src/editor/water/WaterFoam.js';

const foam = Object.freeze({
  enabled: true,
  color: '#e8fbff',
  intensity: 0.78,
  shoreWidth: 1.6,
  noiseStrength: 0.42,
  flowStrength: 0.32,
  flowBandScale: 0.58,
  flowBandSpeed: 0.42,
  flowBandContrast: 2.4,
  intersectionDepth: 0.28,
  intersectionSoftness: 0.38,
  intersectionStrength: 0.82,
});

test('shore foam is driven by geographic distance', () => {
  assert.equal(validateWaterFoamConfig(structuredClone(foam)).enabled, true);
  const edge = computeGeographicFoam({ shoreDistance: 0, noise: 1, config: foam });
  const middle = computeGeographicFoam({ shoreDistance: 0.8, noise: 1, config: foam });
  const openWater = computeGeographicFoam({ shoreDistance: 4, noise: 1, config: foam });
  assert.ok(edge > middle);
  assert.ok(middle > openWater);
  assert.equal(openWater, 0);
});

test('streamed flow adds bounded river bands without defining the shoreline', () => {
  const calm = computeGeographicFoam({
    shoreDistance: 10,
    currentStrength: 0,
    flowPhase: Math.PI / 2,
    config: foam,
  });
  const flowing = computeGeographicFoam({
    shoreDistance: 10,
    currentStrength: 1,
    flowPhase: Math.PI / 2,
    qualityStrength: 1.2,
    config: foam,
  });
  assert.equal(calm, 0);
  assert.ok(flowing > 0);
  assert.ok(flowing <= 1);
});

test('intersection foam falls off with scene gap', () => {
  const contact = computeIntersectionFoam({ sceneGap: 0, config: foam });
  const transition = computeIntersectionFoam({ sceneGap: 0.4, config: foam });
  const clear = computeIntersectionFoam({ sceneGap: 2, config: foam });
  assert.ok(contact > transition);
  assert.ok(transition > clear);
  assert.equal(clear, 0);
});

test('foam validation rejects invalid colours and ranges', () => {
  assert.throws(
    () => validateWaterFoamConfig({ ...structuredClone(foam), color: 'white' }),
    /color/,
  );
  assert.throws(
    () => validateWaterFoamConfig({ ...structuredClone(foam), shoreWidth: 0 }),
    /shoreWidth/,
  );
});
