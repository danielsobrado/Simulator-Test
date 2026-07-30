import assert from 'node:assert/strict';
import test from 'node:test';
import {
  POST_PROCESSING_CAPTURE_LOCATIONS,
  POST_PROCESSING_MEASURE_FRAMES,
  POST_PROCESSING_WARMUP_FRAMES,
  createPostProcessingRoutePhases,
  listPostProcessingCaptureIds,
  resolvePostProcessingCapture,
} from '../../src/editor/performance/qa/PostProcessingQaCaptures.js';
import {
  createMovementPlan,
  parseQaParams,
} from '../../src/editor/performance/qa/parseQaParams.js';

test('post-processing capture registry lists the required locations', () => {
  const ids = listPostProcessingCaptureIds();
  for (const required of [
    'forest-close',
    'forest-aerial',
    'river-close',
    'coast',
    'castle',
    'dense-settlement',
    'snow-or-ice',
    'night-emissive',
    'spell-combat',
    'weather-heavy',
  ]) {
    assert.ok(ids.includes(required), required);
  }
  assert.equal(POST_PROCESSING_CAPTURE_LOCATIONS.length, 10);
  assert.equal(POST_PROCESSING_WARMUP_FRAMES, 120);
  assert.equal(POST_PROCESSING_MEASURE_FRAMES, 600);
});

test('post-processing capture scenario uses frame budgets', () => {
  const config = parseQaParams(
    '?qa=post-processing-capture&ppCapture=forest-close&download=0',
  );
  assert.equal(config.scenarioId, 'post-processing-capture');
  assert.equal(config.captureId, 'forest-close');
  assert.equal(config.warmupFrames, 120);
  assert.equal(config.measureFrames, 600);
  assert.equal(config.useFrameBudget, true);
  assert.equal(config.densityProfile, 'dense-forest');
  const plan = createMovementPlan(config);
  assert.equal(plan.phases[0].durationFrames, 120);
  assert.equal(plan.phases[1].durationFrames, 600);
  assert.equal(plan.phases[0].record, false);
  assert.equal(plan.phases[1].record, true);
});

test('post-processing route includes rebase and static hold phases', () => {
  const config = parseQaParams('?qa=post-processing-route&download=0');
  assert.equal(config.multiPhase, true);
  const plan = createMovementPlan(config);
  const ids = plan.phases.map((phase) => phase.id);
  assert.deepEqual(ids, [
    'warmup',
    'forward',
    'rotate',
    'chunk-cross',
    'rebase-teleport',
    'rebase-move',
    'static',
  ]);
  assert.ok(plan.phases.find((phase) => phase.id === 'static').durationFrames >= 300);
  assert.ok(plan.phases.find((phase) => phase.id === 'rebase-teleport').teleport);
});

test('route phases honour floating-origin threshold', () => {
  const phases = createPostProcessingRoutePhases({ floatingOriginThreshold: 2048 });
  const teleport = phases.find((phase) => phase.id === 'rebase-teleport');
  assert.equal(teleport.teleport.x, 1920);
});

test('resolvePostProcessingCapture returns null for unknown ids', () => {
  assert.equal(resolvePostProcessingCapture('missing'), null);
  assert.equal(resolvePostProcessingCapture('coast')?.label, 'Coast');
});
