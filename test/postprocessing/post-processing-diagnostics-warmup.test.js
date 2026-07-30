import assert from 'node:assert/strict';
import test from 'node:test';
import {
  POST_PROCESSING_GPU_TIMING_KEYS,
  PostProcessingDiagnostics,
} from '../../src/render/postprocessing/PostProcessingDiagnostics.js';
import { PostProcessingResources } from '../../src/render/postprocessing/PostProcessingResources.js';
import { DEFAULT_POST_PROCESSING_SETTINGS } from '../../src/render/postprocessing/PostProcessingSettings.js';
import { createPostProcessingWarmupVariants } from '../../src/render/postprocessing/PostProcessingWarmup.js';

test('GPU timing resolution is asynchronous and preserves pass placeholders', async () => {
  const diagnostics = new PostProcessingDiagnostics();
  let resolveQuery;
  const query = new Promise((resolve) => {
    resolveQuery = resolve;
  });
  const renderer = {
    resolveTimestampsAsync: () => query,
  };

  assert.equal(diagnostics.requestGpuTimings(renderer, ['sceneMrt', 'totalPost']), true);
  assert.equal(diagnostics.snapshot().gpuTimings.totalPost, null);
  await Promise.resolve();
  resolveQuery(2.75);
  await query;
  await Promise.resolve();
  await Promise.resolve();

  const snapshot = diagnostics.snapshot();
  assert.deepEqual(Object.keys(snapshot.gpuTimings), POST_PROCESSING_GPU_TIMING_KEYS);
  assert.equal(snapshot.gpuTimings.sceneMrt, null);
  assert.equal(snapshot.gpuTimings.totalPost, 2.75);
  assert.equal(snapshot.gpuTimingSamples, 1);
});

test('resource cache retains disabled graphs and drops stale sizes on resize', () => {
  const disposed = [];
  const resized = [];
  const resources = new PostProcessingResources({ getPixelRatio: () => 1 });
  const graph = (id) => ({
    resize: (...size) => resized.push([id, ...size]),
    dispose: () => disposed.push(id),
  });

  resources.acquireGraph('active', () => graph('active'));
  resources.activateGraph('active');
  resources.acquireGraph('retained', () => graph('retained'));
  resources.resizeGraph('retained', 8, 8, 1);

  resources.resize(1280, 720, 1);

  assert.deepEqual(disposed, ['retained']);
  assert.deepEqual(resized.at(-1), ['active', 1280, 720, 1]);
  assert.equal(resources.snapshot().retainedGraphCount, 1);
  resources.dispose();
  assert.deepEqual(disposed, ['retained', 'active']);
});

test('warmup variants cover every requested pipeline family', () => {
  const variants = createPostProcessingWarmupVariants(
    DEFAULT_POST_PROCESSING_SETTINGS,
  );
  const ids = new Set(variants.map(({ id }) => id));
  for (const id of [
    'pass-through',
    'traa',
    'traa-upscale',
    'bloom-2',
    'bloom-4',
    'bloom-6',
    'tone-agx',
    'tone-aces',
    'tone-neutral',
    'sharpen',
    'ssr-low',
    'ssr-medium',
    'ssr-high',
    'screen-space-shafts',
    'dof',
    'vignette',
    'grain',
  ]) {
    assert.equal(ids.has(id), true, `missing ${id}`);
  }
  assert.equal(
    variants.filter(({ id }) => id.startsWith('debug-')).length,
    12,
  );
});
