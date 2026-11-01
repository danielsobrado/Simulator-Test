import assert from 'node:assert/strict';
import test from 'node:test';

import { RAISED_DEVICE_LIMITS, canCreateWebGPUDevice, raiseDeviceLimits } from '../src/render/deviceLimits.js';

const gpuOffering = (limits) => ({
  requestAdapter: async (options) => {
    assert.equal(options.featureLevel, 'compatibility', 'the backend\'s own adapter options');
    return { limits };
  },
});

test('the device asks for what the adapter offers, up to the cap', async () => {
  const cap = RAISED_DEVICE_LIMITS.maxSampledTexturesPerShaderStage;
  assert.deepEqual(
    await raiseDeviceLimits({}, { gpu: gpuOffering({ maxSampledTexturesPerShaderStage: 48 }) }),
    { maxSampledTexturesPerShaderStage: cap },
  );
  assert.deepEqual(
    await raiseDeviceLimits({}, { gpu: gpuOffering({ maxSampledTexturesPerShaderStage: 16 }) }),
    { maxSampledTexturesPerShaderStage: 16 },
    'never more than the adapter has',
  );
});

test('without WebGPU or an adapter the limits are left alone', async () => {
  const limits = { existing: 1 };
  assert.deepEqual(await raiseDeviceLimits(limits, { gpu: null }), { existing: 1 });
  assert.deepEqual(await raiseDeviceLimits(limits, { gpu: { requestAdapter: async () => null } }), { existing: 1 });
});

test('startup needs a real device, not only an adapter', async () => {
  let destroyed = 0;
  const gpuWith = (requestDevice) => ({ requestAdapter: async () => ({ requestDevice }) });
  assert.equal(await canCreateWebGPUDevice({ gpu: gpuWith(async () => ({ destroy: () => destroyed++ })) }), true);
  assert.equal(destroyed, 1, 'the probe leaves no device behind');
  assert.equal(await canCreateWebGPUDevice({ gpu: null }), false);
  assert.equal(await canCreateWebGPUDevice({ gpu: { requestAdapter: async () => null } }), false);
  assert.equal(await canCreateWebGPUDevice({ gpu: gpuWith(async () => { throw new Error('dxil.dll'); }) }), false);
});
