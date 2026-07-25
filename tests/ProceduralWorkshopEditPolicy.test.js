import assert from 'node:assert/strict';
import test from 'node:test';
import {
  axesForWorkshopMode,
  getWorkshopComponentEditPolicy,
  supportsWorkshopTransformMode,
} from '../src/editor/workshop/ProceduralWorkshopEditPolicy.js';

test('structural openings expose only facade-plane architectural edits', () => {
  const policy = getWorkshopComponentEditPolicy({
    kind: 'opening',
    transformPolicy: 'opening2d',
  });

  assert.equal(policy.handle, 'facade-opening');
  assert.equal(policy.defaultSpace, 'parent');
  assert.equal(axesForWorkshopMode(policy, 'translate'), 'xy');
  assert.equal(axesForWorkshopMode(policy, 'rotate'), '');
  assert.equal(axesForWorkshopMode(policy, 'scale'), 'xy');
  assert.equal(supportsWorkshopTransformMode(policy, 'rotate'), false);
  assert.equal(policy.adaptivePlacement, true);
});

test('roof editing defaults to parent space with fine architectural snapping', () => {
  const policy = getWorkshopComponentEditPolicy({ kind: 'roof' });

  assert.equal(policy.handle, 'ridge');
  assert.equal(policy.defaultSpace, 'parent');
  assert.equal(policy.translationSnap, 0.05);
  assert.equal(policy.rotationSnapDegrees, 5);
  assert.equal(policy.scaleSnap, 0.025);
});
