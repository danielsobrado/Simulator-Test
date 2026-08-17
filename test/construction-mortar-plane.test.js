import assert from 'node:assert/strict';
import test from 'node:test';

import { createMortarDescriptor } from '../src/editor/construction/compile/ConstructionMasonryBuilder.js';

const PLACEMENT = Object.freeze({
  category: 'field',
  corners: Object.freeze([
    Object.freeze([-0.48, -0.22]),
    Object.freeze([0.48, -0.22]),
    Object.freeze([0.48, 0.22]),
    Object.freeze([-0.48, 0.22]),
  ]),
  mortarCorners: Object.freeze([
    Object.freeze([-0.5, -0.24]),
    Object.freeze([0.5, -0.24]),
    Object.freeze([0.5, 0.24]),
    Object.freeze([-0.5, 0.24]),
  ]),
});

const STONE_SHAPE = Object.freeze({
  category: 'field',
  corners: PLACEMENT.corners,
  depth: 0.8,
  position: Object.freeze([2, 1, 0.09]),
  rotation: Object.freeze([0.01, 0.7, 0.02]),
});

test('mortar can stay on the nominal wall plane while a stone protrudes', () => {
  const nominalPosition = [2, 1, 0];
  const nominalRotation = [0, 0.7, 0];
  const descriptor = createMortarDescriptor({
    placement: PLACEMENT,
    stoneShape: STONE_SHAPE,
    nominalPosition,
    nominalRotation,
  });

  assert.deepEqual(descriptor.position, nominalPosition);
  assert.deepEqual(descriptor.rotation, nominalRotation);
  assert.notDeepEqual(descriptor.position, STONE_SHAPE.position);
});

test('mortar descriptor keeps the legacy shaped transform when nominal data is absent', () => {
  const descriptor = createMortarDescriptor({
    placement: PLACEMENT,
    stoneShape: STONE_SHAPE,
  });

  assert.deepEqual(descriptor.position, STONE_SHAPE.position);
  assert.deepEqual(descriptor.rotation, STONE_SHAPE.rotation);
});
