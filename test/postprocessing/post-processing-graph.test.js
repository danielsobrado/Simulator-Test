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
  assert.match(signature, /\|mrt:1/);
  assert.ok(POST_PROCESSING_EFFECT_KEYS.every((key) => signature.includes(`${key}:0`)));
});

test('disabled topology does not allocate the scene MRT', () => {
  assert.match(createPostProcessingTopologySignature(settings(false)), /\|mrt:0/);
});

test('temporal AA mode participates in graph topology', () => {
  const traa = settings();
  traa.antiAliasing = { enabled: true, mode: 'traa' };
  const traau = settings();
  traau.antiAliasing = { enabled: true, mode: 'traau' };
  const disabled = settings();
  disabled.antiAliasing = { enabled: false, mode: 'traau' };

  assert.notEqual(
    createPostProcessingTopologySignature(traa),
    createPostProcessingTopologySignature(traau),
  );
  assert.match(createPostProcessingTopologySignature(disabled), /\|aaMode:off/);
});

test('tone mapping mode participates in graph topology', () => {
  const agx = settings();
  agx.toneMapping = { enabled: true, mode: 'agx' };
  const aces = settings();
  aces.toneMapping = { enabled: true, mode: 'aces' };
  const disabled = settings();
  disabled.toneMapping = { enabled: false, mode: 'agx' };

  assert.notEqual(
    createPostProcessingTopologySignature(agx),
    createPostProcessingTopologySignature(aces),
  );
  assert.match(createPostProcessingTopologySignature(disabled), /\|toneMode:none/);
});

test('DOF tap count participates in graph topology', () => {
  const low = settings();
  low.depthOfField = { enabled: true, taps: 8 };
  const high = settings();
  high.depthOfField = { enabled: true, taps: 24 };

  assert.notEqual(
    createPostProcessingTopologySignature(low),
    createPostProcessingTopologySignature(high),
  );
});
