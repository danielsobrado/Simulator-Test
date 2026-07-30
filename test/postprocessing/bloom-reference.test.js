import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bloomKarisWeightReference,
  bloomSoftKneeReference,
} from '../../src/render/postprocessing/nodes/BloomNode.js';
import { createPostProcessingTopologySignature } from '../../src/render/postprocessing/nodes/PostCommon.js';

test('bloom Karis weight suppresses high luminance samples', () => {
  assert.equal(bloomKarisWeightReference([0, 0, 0]), 1);
  assert.equal(bloomKarisWeightReference([1, 1, 1]), 0.5);
  assert.equal(
    bloomKarisWeightReference([4, 0, 0]),
    1 / (1 + 4 * 0.2126),
  );
});

test('bloom soft knee fades smoothly through the threshold', () => {
  assert.deepEqual(
    bloomSoftKneeReference([1, 0.5, 0.25], 1, 0.5),
    [0.125, 0.0625, 0.03125],
  );
  assert.deepEqual(
    bloomSoftKneeReference([1, 0.5, 0.25], 3, 1),
    [0, 0, 0],
  );
  assert.deepEqual(
    bloomSoftKneeReference([5, 2.5, 1], 3, 1),
    [2, 1, 0.4],
  );
});

test('bloom soft knee remains finite for black and a zero knee', () => {
  assert.deepEqual(bloomSoftKneeReference([0, 0, 0], 0, 0), [0, 0, 0]);
});

test('enabled bloom level count participates in graph topology', () => {
  const settings = {
    enabled: true,
    antiAliasing: { enabled: false },
    bloom: { enabled: true, levels: 3 },
  };
  const threeLevels = createPostProcessingTopologySignature(settings);
  settings.bloom.levels = 6;
  const sixLevels = createPostProcessingTopologySignature(settings);

  assert.match(threeLevels, /\|bloomLevels:3/);
  assert.match(sixLevels, /\|bloomLevels:6/);
  assert.notEqual(threeLevels, sixLevels);
});
