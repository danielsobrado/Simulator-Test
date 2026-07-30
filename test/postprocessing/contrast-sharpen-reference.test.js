import assert from 'node:assert/strict';
import test from 'node:test';
import {
  contrastSharpenReference,
} from '../../src/render/postprocessing/nodes/ContrastSharpenNode.js';

function assertChannelsClose(actual, expected, epsilon = 1e-12) {
  actual.forEach((channel, index) => {
    assert.ok(Math.abs(channel - expected[index]) <= epsilon);
  });
}

test('contrast sharpening uses the five-tap reference kernel', () => {
  const output = contrastSharpenReference({
    centre: [0.5, 0.4, 0.3],
    left: [0.4, 0.3, 0.2],
    right: [0.7, 0.6, 0.5],
    up: [0.4, 0.3, 0.2],
    down: [0.4, 0.3, 0.2],
  }, 0.5);

  assertChannelsClose(output, [0.516, 0.416, 0.316]);
});

test('contrast sharpening leaves a flat neighbourhood unchanged', () => {
  const flat = [0.37, 0.42, 0.91];
  assert.deepEqual(contrastSharpenReference({
    centre: flat,
    left: flat,
    right: flat,
    up: flat,
    down: flat,
  }, 0.8), flat);
});

test('contrast sharpening clamps overshoot to local extrema', () => {
  assert.deepEqual(contrastSharpenReference({
    centre: [0.8, 0.2, 0.5],
    left: [0.2, 0.8, 0.5],
    right: [0.2, 0.8, 0.5],
    up: [0.2, 0.8, 0.5],
    down: [0.2, 0.8, 0.5],
  }, 0.8), [0.8, 0.2, 0.5]);
});
