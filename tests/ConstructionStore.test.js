import assert from 'node:assert/strict';
import test from 'node:test';
import { executeConstructionCommand } from '../src/editor/construction/ConstructionCommands.js';
import { ConstructionSpatialIndex } from '../src/editor/construction/ConstructionSpatialIndex.js';
import { ConstructionStore } from '../src/editor/construction/ConstructionStore.js';
import { createCubicBezierPathFromStroke } from '../src/editor/construction/curve/CubicBezierPath.js';

function record(id = 'construction-1') {
  return {
    version: 1,
    id,
    revision: 1,
    seed: 17,
    kind: 'wall',
    label: 'Test wall',
    style: { key: 'coursed-rubble', version: 1 },
    dimensions: { height: 3.5, thickness: 0.8 },
    path: createCubicBezierPathFromStroke([
      [1, 1],
      [9, 1],
      [17, 5],
    ], {
      simplifyTolerance: 0.01,
      anchorPrefix: `${id}-anchor`,
      segmentPrefix: `${id}-segment`,
    }),
    features: [],
  };
}

test('construction store validates, orders, and round-trips sparse intent', () => {
  const store = new ConstructionStore();
  assert.equal(store.nextConstructionId(), 'construction-1');
  store.add(record('construction-2'));
  store.add(record('construction-1'));
  assert.deepEqual(store.list().map(({ id }) => id), ['construction-1', 'construction-2']);
  assert.deepEqual(new ConstructionStore(store.toDocument()).toDocument(), store.toDocument());
  assert.equal(store.nextConstructionId(), 'construction-3');
});

test('construction commands provide reversible snapshots and local dirty segments', () => {
  const store = new ConstructionStore();
  const created = executeConstructionCommand(store, { type: 'create', record: record() });
  assert.equal(store.size, 1);
  const current = store.get('construction-1');
  const anchorId = current.path.anchors[1].id;
  const moved = executeConstructionCommand(store, {
    type: 'move_anchor',
    constructionId: current.id,
    anchorId,
    position: { x: 9, z: 4 },
  });
  assert.equal(moved.before.revision, 1);
  assert.equal(moved.after.revision, 2);
  assert.equal(moved.dirtySegmentIds.length, 2);
  assert.deepEqual(moved.after.path.anchors[1].position, [9, 4]);

  store.applyChange(moved, 'undo');
  assert.deepEqual(store.get(current.id), moved.before);
  store.applyChange(moved, 'redo');
  assert.deepEqual(store.get(current.id), moved.after);
  store.applyChange(created, 'undo');
  assert.equal(store.size, 0);
});

test('construction spatial index covers every touched chunk and updates locally', () => {
  const index = new ConstructionSpatialIndex({ chunkWorldSize: 8 });
  const wall = record();
  assert.deepEqual(index.update(wall), ['0:0', '1:0', '2:0']);
  assert.deepEqual(index.list(1, 0), ['construction-1']);
  index.remove(wall.id);
  assert.deepEqual(index.list(1, 0), []);
});

test('malformed construction payloads fail transactionally', () => {
  const store = new ConstructionStore([record()]);
  const before = store.toDocument();
  assert.throws(
    () => store.replaceAll([record(), { ...record(), dimensions: { height: NaN, thickness: 1 } }]),
    /Construction height/,
  );
  assert.deepEqual(store.toDocument(), before);
});

