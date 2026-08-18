import assert from 'node:assert/strict';
import test from 'node:test';

import { unregisterProceduralDefinitions } from '../src/editor/workshop/ProceduralDefinitionLifecycle.js';

function createLifecycleFixture() {
  const definition = { key: 'workshop-test', procedural: true };
  const renderer = { definition, parts: [], meshes: [] };
  const disposed = [];
  let refreshes = 0;
  const objectMap = {
    definitionByKey: new Map([[definition.key, definition]]),
  };
  const objectView = {
    definitionByKey: new Map([[definition.key, definition]]),
    renderers: new Map([[definition.key, renderer]]),
    previewDefinitionKey: null,
    previewGroup: { children: [], clear() {}, visible: false },
    previewFoundation: { visible: false },
    footprintPreview: { visible: false },
    selectionOverlay: { visible: true },
    disposeRendererRecord(value) {
      disposed.push(value);
    },
    refreshAll() {
      refreshes += 1;
    },
  };
  return {
    definition,
    renderer,
    disposed,
    objectMap,
    objectView,
    refreshes: () => refreshes,
  };
}

test('procedural definition removal delegates complete renderer disposal to ObjectView', () => {
  const fixture = createLifecycleFixture();

  unregisterProceduralDefinitions({
    objectMap: fixture.objectMap,
    objectView: fixture.objectView,
    definitionKeys: [fixture.definition.key],
  });

  assert.deepEqual(fixture.disposed, [fixture.renderer]);
  assert.equal(fixture.objectView.renderers.has(fixture.definition.key), false);
  assert.equal(fixture.objectView.definitionByKey.has(fixture.definition.key), false);
  assert.equal(fixture.objectMap.definitionByKey.has(fixture.definition.key), false);
  assert.equal(fixture.objectView.selectionOverlay.visible, false);
  assert.equal(fixture.refreshes(), 1);
});

test('procedural definition removal refuses non-procedural definitions before teardown', () => {
  const fixture = createLifecycleFixture();
  fixture.objectMap.definitionByKey.set(fixture.definition.key, {
    ...fixture.definition,
    procedural: false,
  });

  assert.throws(() => unregisterProceduralDefinitions({
    objectMap: fixture.objectMap,
    objectView: fixture.objectView,
    definitionKeys: [fixture.definition.key],
  }), /non-procedural object definition/i);
  assert.deepEqual(fixture.disposed, []);
  assert.equal(fixture.objectView.renderers.has(fixture.definition.key), true);
  assert.equal(fixture.refreshes(), 0);
});
