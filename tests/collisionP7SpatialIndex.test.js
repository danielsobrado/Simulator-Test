import assert from 'node:assert/strict';
import test from 'node:test';
import { ConstructionSpatialIndex } from '../src/editor/construction/ConstructionSpatialIndex.js';
import { straightConstruction } from './helpers/constructionCollisionFixtures.js';

test('construction spatial index preserves record indexing and chunk lists', () => {
  const index = new ConstructionSpatialIndex({ chunkWorldSize: 128 });
  const record = straightConstruction({
    id: 'construction-index',
    start: [2, 2],
    end: [18, 2],
  });

  assert.deepEqual(index.update(record), ['0:0']);
  assert.deepEqual(index.list(0, 0), [record.id]);
  assert.ok(index.signature(0, 0) > 0);
});

test('compiled bounds replacement marks old and new chunks only', () => {
  const index = new ConstructionSpatialIndex({ chunkWorldSize: 128 });
  index.updateBounds('construction-move', {
    minX: 2,
    minZ: 2,
    maxX: 18,
    maxZ: 4,
  });
  const oldRevision = index.signature(0, 0);
  const untouchedRevision = index.signature(2, 0);

  index.updateBounds('construction-move', {
    minX: 132,
    minZ: 2,
    maxX: 148,
    maxZ: 4,
  });

  assert.deepEqual(index.list(0, 0), []);
  assert.deepEqual(index.list(1, 0), ['construction-move']);
  assert.ok(index.signature(0, 0) > oldRevision);
  assert.ok(index.signature(1, 0) > 0);
  assert.equal(index.signature(2, 0), untouchedRevision);
});

test('construction removal marks the previous chunk dirty', () => {
  const index = new ConstructionSpatialIndex({ chunkWorldSize: 128 });
  index.updateBounds('construction-remove', {
    minX: 2,
    minZ: 2,
    maxX: 18,
    maxZ: 4,
  });
  const before = index.signature(0, 0);

  assert.deepEqual(index.remove('construction-remove'), ['0:0']);
  assert.ok(index.signature(0, 0) > before);
  assert.deepEqual(index.list(0, 0), []);
});
