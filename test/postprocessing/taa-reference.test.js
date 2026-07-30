import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TAA_HALTON_JITTER_PIXELS,
  taaDepthRejectionThresholdReference,
  taaFeedbackWeightReference,
  taaVarianceClipRangesReference,
} from '../../src/render/postprocessing/nodes/TaaResolveNode.js';

test('TAA uses the fixed eight-sample Halton jitter in pixel units', () => {
  assert.deepEqual(TAA_HALTON_JITTER_PIXELS, [
    [0.0000000, -0.1666667],
    [-0.2500000, 0.1666667],
    [0.2500000, -0.3888889],
    [-0.3750000, -0.0555556],
    [0.1250000, 0.2777778],
    [-0.1250000, -0.2777778],
    [0.3750000, 0.0555556],
    [-0.4375000, 0.3888889],
  ]);
});

test('TAA feedback reference combines motion, reactivity, and clipping', () => {
  assert.equal(taaFeedbackWeightReference({
    feedback: 0.9,
    motionPixels: 0,
    motionRejectionPixels: 32,
    reactiveMask: 0,
    reactiveStrength: 0.9,
    clipDistance: 0,
  }), 0.9);

  assert.equal(taaFeedbackWeightReference({
    feedback: 0.9,
    motionPixels: 32,
    motionRejectionPixels: 32,
    reactiveMask: 0.5,
    reactiveStrength: 0.9,
    clipDistance: 0.25,
  }), 0.09900000000000002);

  assert.equal(taaFeedbackWeightReference({
    feedback: 0.9,
    motionPixels: 500,
    motionRejectionPixels: 32,
    reactiveMask: 1,
    reactiveStrength: 1,
    clipDistance: 2,
  }), 0.05);

  assert.equal(taaFeedbackWeightReference({
    feedback: 0.9,
    motionPixels: 0,
    motionRejectionPixels: 32,
    reactiveMask: 0,
    reactiveStrength: 0.9,
    clipDistance: 0,
    historyValid: false,
  }), 0);

  assert.equal(taaFeedbackWeightReference({
    feedback: 0.9,
    motionPixels: 0,
    motionRejectionPixels: 32,
    reactiveMask: 0,
    reactiveStrength: 0.9,
    clipDistance: 0,
    globalReactive: true,
  }), 0);
});

test('TAA depth rejection threshold uses absolute and relative limits', () => {
  assert.equal(taaDepthRejectionThresholdReference(1, 0.05, 0.02), 0.05);
  assert.equal(taaDepthRejectionThresholdReference(100, 0.05, 0.02), 2);
  assert.equal(taaDepthRejectionThresholdReference(2.5, 0.01, 0.1), 0.25);
});

test('TAA variance clipping expands chroma by 1.25', () => {
  assert.deepEqual(
    taaVarianceClipRangesReference(
      [2, -0.5, 0.25],
      [0.4, 0.2, 0.1],
      1.25,
    ),
    {
      min: [1.5, -0.8125, 0.09375],
      max: [2.5, -0.1875, 0.40625],
    },
  );
});

test('history clamp strength tightens the accepted variance range', () => {
  const normal = taaVarianceClipRangesReference([1, 1, 1], [0.2, 0.2, 0.2], 1, 1);
  const strong = taaVarianceClipRangesReference([1, 1, 1], [0.2, 0.2, 0.2], 1, 2);
  assert.ok(strong.min[0] > normal.min[0]);
  assert.ok(strong.max[0] < normal.max[0]);
});
