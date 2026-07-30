import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cinematicDofCoCReference,
  smoothFocusDistanceReference,
} from '../../src/render/postprocessing/nodes/CinematicDofNode.js';

const SETTINGS = Object.freeze({
  nearStartRatio: 0.55,
  nearFullRatio: 0.16,
  farStartMeters: 130,
  farFullMeters: 620,
  maxCoCPixels: 3.5,
});

test('DOF CoC is sharp through the configured focus band', () => {
  const coc = cinematicDofCoCReference(20, 20, SETTINGS);
  assert.equal(coc.signedCoC, 0);
  assert.equal(coc.radiusPixels, 0);
});

test('DOF CoC reaches full near and far blur', () => {
  assert.deepEqual(
    cinematicDofCoCReference(2, 20, SETTINGS),
    { farCoC: 0, nearCoC: 1, signedCoC: -1, radiusPixels: 3.5 },
  );
  assert.deepEqual(
    cinematicDofCoCReference(620, 20, SETTINGS),
    { farCoC: 1, nearCoC: 0, signedCoC: 1, radiusPixels: 3.5 },
  );
});

test('focus smoothing is frame-rate independent exponential interpolation', () => {
  const oneStep = smoothFocusDistanceReference(10, 30, 4, 0.5);
  const halfStep = smoothFocusDistanceReference(10, 30, 4, 0.25);
  const twoHalfSteps = smoothFocusDistanceReference(halfStep, 30, 4, 0.25);
  assert.ok(Math.abs(oneStep - twoHalfSteps) < 1e-12);
});
