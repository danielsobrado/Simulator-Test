import assert from 'node:assert/strict';
import test from 'node:test';
import {
  POST_PROCESSING_EFFECT_KEYS,
  createPostProcessingTopologySignature,
} from '../../src/render/postprocessing/nodes/PostCommon.js';

function settings(enabled = true) {
  const value = { enabled };
  for (const key of POST_PROCESSING_EFFECT_KEYS) value[key] = { enabled: false };
  return value;
}

test('topology signature is stable while settings are unchanged', () => {
  const value = settings();
  assert.equal(
    createPostProcessingTopologySignature(value),
    createPostProcessingTopologySignature(value),
  );
});

test('topology signature changes when the master toggle changes', () => {
  assert.notEqual(
    createPostProcessingTopologySignature(settings(false)),
    createPostProcessingTopologySignature(settings(true)),
  );
});

test('future effect toggles participate in topology', () => {
  const before = settings();
  const after = settings();
  after.bloom.enabled = true;
  assert.notEqual(
    createPostProcessingTopologySignature(before),
    createPostProcessingTopologySignature(after),
  );
});

test('enabled graph with all effects off has a scene-only topology identity', () => {
  const signature = createPostProcessingTopologySignature(settings(true));
  assert.match(signature, /^post:1/);
  assert.ok(POST_PROCESSING_EFFECT_KEYS.every((key) => signature.includes(`${key}:0`)));
});
