import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WorkshopCommandBus,
  WorkshopDocument,
} from '../src/editor/workshop/kernel/index.js';
import {
  WorkshopHistory,
  WorkshopReplayRecorder,
  replayWorkshopCommands,
} from '../src/editor/workshop/history/index.js';

function createDocument() {
  return new WorkshopDocument({
    entities: [
      { id: 'root', type: 'structure', properties: { width: 8 } },
      { id: 'roof', type: 'roof', parentId: 'root', properties: { pitch: 38 } },
    ],
  });
}

function semanticSnapshot(document) {
  return document.listEntities().map((entity) => entity.toJSON());
}

test('history undo and redo round-trip semantic content exactly', () => {
  const bus = new WorkshopCommandBus(createDocument());
  const history = new WorkshopHistory(bus, { maxEntries: 4 });
  const initial = semanticSnapshot(bus.document);

  bus.dispatch({ type: 'entity.set-properties', id: 'root', properties: { width: 12 } });
  const edited = semanticSnapshot(bus.document);
  assert.equal(history.undoDepth, 1);
  assert.equal(history.redoDepth, 0);

  history.undo();
  assert.deepEqual(semanticSnapshot(bus.document), initial);
  assert.equal(history.redoDepth, 1);

  history.redo();
  assert.deepEqual(semanticSnapshot(bus.document), edited);
  assert.equal(history.undoDepth, 1);
  history.dispose();
});

test('new committed edit clears redo branch', () => {
  const bus = new WorkshopCommandBus(createDocument());
  const history = new WorkshopHistory(bus);
  bus.dispatch({ type: 'entity.set-properties', id: 'root', properties: { width: 9 } });
  history.undo();
  assert.equal(history.canRedo, true);

  bus.dispatch({ type: 'entity.set-properties', id: 'roof', properties: { pitch: 45 } });
  assert.equal(history.canRedo, false);
  history.dispose();
});

test('recorded commands replay to the same semantic state', () => {
  const initial = createDocument();
  const bus = new WorkshopCommandBus(initial);
  const recorder = new WorkshopReplayRecorder(bus);
  recorder.dispatch({ type: 'entity.set-properties', id: 'root', properties: { width: 11 } });
  recorder.dispatch({ type: 'entity.set-properties', id: 'roof', properties: { pitch: 42 } });

  const replayed = replayWorkshopCommands(initial, recorder.toJSON());
  assert.deepEqual(semanticSnapshot(replayed), semanticSnapshot(bus.document));
});

test('failed commands are not recorded for replay', () => {
  const bus = new WorkshopCommandBus(createDocument());
  const recorder = new WorkshopReplayRecorder(bus);
  assert.throws(() => recorder.dispatch({
    type: 'entity.set-properties',
    id: 'missing',
    properties: { width: 10 },
  }), /unknown workshop entity/i);
  assert.deepEqual(recorder.toJSON().commands, []);
});
