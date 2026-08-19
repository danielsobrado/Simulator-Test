import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WorkshopCommandBus,
  WorkshopDocument,
  WorkshopPreviewTransaction,
} from '../src/editor/workshop/kernel/index.js';

function createBus() {
  return new WorkshopCommandBus(new WorkshopDocument({
    entities: [
      { id: 'root', type: 'structure', properties: { width: 8 } },
      { id: 'roof', type: 'roof', parentId: 'root', properties: { pitch: 38 } },
    ],
  }));
}

test('command bus applies semantic commands and reports affected entities', () => {
  const bus = createBus();
  const events = [];
  bus.subscribe((event) => events.push(event));

  const result = bus.dispatch({
    type: 'entity.set-properties',
    id: 'root',
    properties: { width: 10 },
  });

  assert.equal(bus.document.getEntity('root').properties.width, 10);
  assert.deepEqual(result.impactedIds, ['roof', 'root']);
  assert.equal(events.length, 1);
});

test('batch command commits multiple semantic edits as one revision', () => {
  const bus = createBus();
  bus.dispatch({
    type: 'document.batch',
    label: 'Resize building',
    commands: [
      { type: 'entity.set-properties', id: 'root', properties: { width: 12 } },
      { type: 'entity.set-properties', id: 'roof', properties: { pitch: 42 } },
    ],
  });

  assert.equal(bus.document.revision, 1);
  assert.equal(bus.document.getEntity('root').properties.width, 12);
  assert.equal(bus.document.getEntity('roof').properties.pitch, 42);
});

test('command bus rejects dependency cycles without publishing partial state', () => {
  const bus = createBus();
  bus.dispatch({ type: 'entity.set-dependencies', id: 'roof', dependsOn: ['root'] });
  const before = bus.document;

  assert.throws(() => bus.dispatch({
    type: 'entity.set-dependencies',
    id: 'root',
    dependsOn: ['roof'],
  }), /dependency graph contains a cycle/i);
  assert.equal(bus.document, before);
  assert.deepEqual(bus.document.getEntity('root').dependsOn, []);
});

test('preview transaction isolates edits, commits once, and cancels losslessly', () => {
  const bus = createBus();
  const transaction = new WorkshopPreviewTransaction(bus, 'Preview resize');
  transaction.dispatch({ type: 'entity.set-properties', id: 'root', properties: { width: 11 } });
  transaction.dispatch({ type: 'entity.set-properties', id: 'roof', properties: { pitch: 44 } });

  assert.equal(bus.document.revision, 0);
  assert.equal(bus.document.getEntity('root').properties.width, 8);
  assert.equal(transaction.previewDocument.getEntity('root').properties.width, 11);

  transaction.commit();
  assert.equal(bus.document.revision, 1);
  assert.equal(bus.document.getEntity('root').properties.width, 11);
  assert.equal(bus.document.getEntity('roof').properties.pitch, 44);

  const cancelled = new WorkshopPreviewTransaction(bus, 'Cancelled');
  cancelled.dispatch({ type: 'entity.set-properties', id: 'root', properties: { width: 14 } });
  cancelled.cancel();
  assert.equal(bus.document.revision, 1);
  assert.equal(bus.document.getEntity('root').properties.width, 11);
});

test('preview transaction rejects stale commits', () => {
  const bus = createBus();
  const transaction = new WorkshopPreviewTransaction(bus, 'Stale edit');
  transaction.dispatch({ type: 'entity.set-properties', id: 'root', properties: { width: 9 } });
  bus.dispatch({ type: 'entity.set-properties', id: 'roof', properties: { pitch: 41 } });
  assert.throws(() => transaction.commit(), /stale/i);
});
