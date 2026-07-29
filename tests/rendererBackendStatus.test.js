import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectRendererBackend } from '../src/editor/InfiniteTerrainView.js';

test('renderer backend status distinguishes WebGPU from supported fallbacks', () => {
  assert.deepEqual(
    inspectRendererBackend({ backend: { isWebGPUBackend: true } }),
    { mode: 'webgpu', webgpu: true, webgl: false },
  );
  assert.deepEqual(
    inspectRendererBackend({ backend: { isWebGLBackend: true } }),
    { mode: 'webgl', webgpu: false, webgl: true },
  );
  assert.deepEqual(
    inspectRendererBackend({}),
    { mode: 'unknown', webgpu: false, webgl: false },
  );
});

