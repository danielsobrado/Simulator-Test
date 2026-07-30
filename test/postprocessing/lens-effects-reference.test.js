import assert from 'node:assert/strict';
import test from 'node:test';
import {
  grainReference,
  vignetteFactorReference,
} from '../../src/render/postprocessing/nodes/LensEffectsNode.js';

test('vignette leaves the image unchanged at zero intensity', () => {
  assert.equal(vignetteFactorReference([0, 0], { intensity: 0 }), 1);
  assert.equal(vignetteFactorReference([0.5, 0.5], { intensity: 0 }), 1);
});

test('vignette preserves the centre and darkens configured edges', () => {
  const settings = { intensity: 0.4, innerRadius: 0.35, outerRadius: 1.05 };
  assert.equal(vignetteFactorReference([0.5, 0.5], settings), 1);
  const corner = vignetteFactorReference([0, 0], settings);
  assert.ok(corner >= 0.6 && corner < 1);
});

test('disabled grain is an exact identity operation', () => {
  const colour = [0.125, 0.5, 0.875];
  assert.deepEqual(grainReference(colour, 0.99, 0), colour);
});

test('grain uses signed noise around the source colour', () => {
  assert.deepEqual(
    grainReference([0.5, 0.5, 0.5], 0, 0.05),
    [0.45, 0.45, 0.45],
  );
  assert.deepEqual(
    grainReference([0.5, 0.5, 0.5], 1, 0.05),
    [0.55, 0.55, 0.55],
  );
});
