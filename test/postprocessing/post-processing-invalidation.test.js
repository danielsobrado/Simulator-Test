import assert from 'node:assert/strict';
import test from 'node:test';
import { PostProcessingDiagnostics } from '../../src/render/postprocessing/PostProcessingDiagnostics.js';
import { PostProcessingHistory } from '../../src/render/postprocessing/PostProcessingHistory.js';
import {
  POST_PROCESSING_REACTIVE_EVENTS,
  POST_PROCESSING_REACTIVE_LIFETIMES,
  POST_PROCESSING_RESET_REASONS,
  PostProcessingInvalidation,
} from '../../src/render/postprocessing/PostProcessingInvalidation.js';

function createSystem() {
  const history = new PostProcessingHistory();
  const diagnostics = new PostProcessingDiagnostics();
  const log = [];
  const invalidation = new PostProcessingInvalidation({
    history,
    diagnostics,
    debug: (message) => log.push(message),
  });
  return { history, diagnostics, invalidation, log };
}

for (const reason of Object.values(POST_PROCESSING_RESET_REASONS)) {
  test(`full reset ${reason} clears every temporal state`, () => {
    const { history, diagnostics, invalidation, log } = createSystem();
    history.taaColourValid = true;
    history.taaDepthValid = true;
    history.ssrValid = true;
    history.jitterIndex = 7;
    history.previousViewProjection = { matrix: true };

    invalidation.invalidate(reason);

    assert.equal(history.taaColourValid, false);
    assert.equal(history.taaDepthValid, false);
    assert.equal(history.ssrValid, false);
    assert.equal(history.jitterIndex, 0);
    assert.equal(history.previousViewProjection, null);
    assert.equal(history.lastResetReason, reason);
    assert.equal(diagnostics.snapshot().lastResetReason, reason);
    assert.deepEqual(log, [`[post-processing] Temporal history reset: ${reason}`]);
  });
}

for (const event of Object.values(POST_PROCESSING_REACTIVE_EVENTS)) {
  test(`reactive event ${event} does not reset history`, () => {
    const { history, invalidation } = createSystem();
    history.taaColourValid = true;

    const lifetime = invalidation.notifyReactive(event);

    assert.equal(lifetime, POST_PROCESSING_REACTIVE_LIFETIMES[event]);
    assert.equal(history.taaColourValid, true);
    assert.equal(history.resetCount, 0);
  });
}

test('reactive lifetimes expire deterministically in frames', () => {
  const { invalidation } = createSystem();
  invalidation.notifyReactive(POST_PROCESSING_REACTIVE_EVENTS.CHUNK_STREAMED_IN);
  assert.equal(invalidation.reactiveLifetime('CHUNK_STREAMED_IN'), 3);
  invalidation.beginFrame();
  assert.equal(invalidation.reactiveLifetime('CHUNK_STREAMED_IN'), 2);
  invalidation.beginFrame();
  assert.equal(invalidation.reactiveLifetime('CHUNK_STREAMED_IN'), 1);
  invalidation.beginFrame();
  assert.equal(invalidation.isReactive(), false);
});

test('LOD reactive events include transition frames plus two', () => {
  const { invalidation } = createSystem();
  assert.equal(
    invalidation.notifyReactive(
      POST_PROCESSING_REACTIVE_EVENTS.VEGETATION_LOD_CHANGED,
      5,
    ),
    7,
  );
});
