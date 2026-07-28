import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeWaterOpticsSample,
  validateWaterOpticsConfig,
} from '../src/editor/water/WaterOptics.js';

const optics = Object.freeze({
  shallowColor: '#72d8e8',
  deepColor: '#0b4a68',
  underwaterColor: '#15596d',
  absorptionDensity: 0.42,
  minimumOpacity: 0.08,
  maximumOpacity: 0.94,
  shallowDepth: 0.2,
  deepDepth: 6,
  maximumOpticalDistance: 14,
  minimumViewCosine: 0.22,
  surfaceDetailStrength: 0.28,
  underwaterTintStrength: 0.35,
});

test('depth optics are monotonic and bounded', () => {
  const shallow = computeWaterOpticsSample({ depth: 0.1, config: optics });
  const medium = computeWaterOpticsSample({ depth: 2, config: optics });
  const deep = computeWaterOpticsSample({ depth: 8, config: optics });
  assert.ok(shallow.opacity < medium.opacity);
  assert.ok(medium.opacity < deep.opacity);
  assert.ok(shallow.transmission > medium.transmission);
  assert.ok(medium.transmission > deep.transmission);
  assert.equal(shallow.depthMix, 0);
  assert.equal(deep.depthMix, 1);
  assert.ok(deep.opacity <= optics.maximumOpacity);
});

test('grazing views increase optical distance without exceeding the cap', () => {
  const vertical = computeWaterOpticsSample({ depth: 2, viewCosine: 1, config: optics });
  const grazing = computeWaterOpticsSample({ depth: 2, viewCosine: 0.05, config: optics });
  assert.ok(grazing.opticalDistance > vertical.opticalDistance);
  assert.ok(grazing.opacity > vertical.opacity);
  assert.ok(grazing.opticalDistance <= optics.maximumOpticalDistance);
});

test('underwater optics use camera submersion instead of seabed depth', () => {
  const justBelow = computeWaterOpticsSample({
    depth: 20,
    underwater: true,
    cameraSubmersionDepth: 0.2,
    config: optics,
  });
  const deepBelow = computeWaterOpticsSample({
    depth: 20,
    underwater: true,
    cameraSubmersionDepth: 5,
    config: optics,
  });
  assert.equal(justBelow.verticalDistance, 0.2);
  assert.ok(justBelow.opacity < deepBelow.opacity);
  assert.equal(justBelow.depthMix, 1);
});

test('optics validation rejects malformed colours and inverted ranges', () => {
  assert.equal(validateWaterOpticsConfig(structuredClone(optics)).deepDepth, 6);
  assert.throws(
    () => validateWaterOpticsConfig({ ...structuredClone(optics), deepColor: 'blue' }),
    /deepColor/,
  );
  assert.throws(
    () => validateWaterOpticsConfig({
      ...structuredClone(optics),
      maximumOpacity: 0.05,
    }),
    /maximumOpacity/,
  );
  assert.throws(
    () => validateWaterOpticsConfig({
      ...structuredClone(optics),
      deepDepth: 0.1,
    }),
    /deepDepth/,
  );
});
