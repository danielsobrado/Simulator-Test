import assert from 'node:assert/strict';
import test from 'node:test';

import { ObjectSelectionModel } from '../src/editor/interaction/ObjectSelectionModel.js';

test('selection model replaces, adds and toggles deterministically', () => {
  const selection = new ObjectSelectionModel();
  assert.equal(selection.replace(3), true);
  assert.deepEqual(selection.values(), [3]);
  assert.equal(selection.primaryId, 3);

  selection.add(7);
  assert.deepEqual(selection.values(), [3, 7]);
  assert.equal(selection.primaryId, 7);

  selection.toggle(3);
  assert.deepEqual(selection.values(), [7]);
  assert.equal(selection.primaryId, 7);

  selection.toggle(7);
  assert.deepEqual(selection.values(), []);
  assert.equal(selection.primaryId, null);
});

test('selection model retains only valid ids and repairs primary selection', () => {
  const selection = new ObjectSelectionModel();
  selection.add(2);
  selection.add(4);
  selection.add(6);
  selection.setPrimary(4);

  assert.equal(selection.retain([2, 6]), true);
  assert.deepEqual(selection.values(), [2, 6]);
  assert.equal(selection.primaryId, 2);
});

test('selection model rejects invalid object ids', () => {
  const selection = new ObjectSelectionModel();
  assert.equal(selection.add(0), false);
  assert.equal(selection.add(-2), false);
  assert.equal(selection.add('x'), false);
  assert.equal(selection.size, 0);
});
