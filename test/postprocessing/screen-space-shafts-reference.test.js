import assert from 'node:assert/strict';
import test from 'node:test';
import {
  screenSpaceShaftVisibilityReference,
  sunElevationFadeReference,
} from '../../src/render/postprocessing/nodes/ScreenSpaceShaftNode.js';

test('sun elevation fade is full below 35 degrees and zero at 55 degrees', () => {
  assert.equal(sunElevationFadeReference(10, 35, 55), 1);
  assert.equal(sunElevationFadeReference(35, 35, 55), 1);
  assert.equal(sunElevationFadeReference(55, 35, 55), 0);
  assert.equal(sunElevationFadeReference(70, 35, 55), 0);
  assert.ok(sunElevationFadeReference(45, 35, 55) > 0);
  assert.ok(sunElevationFadeReference(45, 35, 55) < 1);
});

test('shaft visibility squares the decay-weighted sky share', () => {
  assert.equal(screenSpaceShaftVisibilityReference([1, 1, 1]), 1);
  assert.equal(screenSpaceShaftVisibilityReference([0, 0, 0]), 0);
  const partial = screenSpaceShaftVisibilityReference([1, 0, 1, 0]);
  assert.ok(partial > 0);
  assert.ok(partial < 0.5);
});
