import assert from 'node:assert/strict';
import test from 'node:test';
import { unregisterProceduralDefinitions } from '../src/editor/workshop/ProceduralDefinitionLifecycle.js';

function disposable() {
  return {
    disposed: 0,
    dispose() {
      this.disposed += 1;
    },
  };
}

function fixture() {
  const texture = { ...disposable(), isTexture: true };
  const geometry = disposable();
  const material = { ...disposable(), map: texture };
  const mesh = disposable();
  const foundationMesh = disposable();
  const foundationGeometry = disposable();
  const foundationMaterial = disposable();
  const previewMaterial = disposable();
  const removed = [];
  const definition = { key: 'workshop-test', procedural: true };
  const renderer = {
    definition,
    parts: [{ geometry, material }],
    meshes: [mesh],
    foundationMesh,
    foundationGeometry,
    foundationMaterial,
  };
  const objectMap = {
    definitionByKey: new Map([
      ['base-house', { key: 'base-house' }],
      [definition.key, definition],
    ]),
  };
  const objectView = {
    definitionByKey: new Map([
      ['base-house', { key: 'base-house' }],
      [definition.key, definition],
    ]),
    renderers: new Map([
      ['base-house', { definition: { key: 'base-house' } }],
      [definition.key, renderer],
    ]),
    root: {
      remove(value) {
        removed.push(value);
      },
    },
    previewDefinitionKey: definition.key,
    previewGroup: {
      children: [{ material: previewMaterial }],
      visible: true,
      clear() {
        this.children = [];
      },
    },
    previewFoundation: { visible: true },
    footprintPreview: { visible: true },
    selectionOverlay: { visible: true },
    refreshCount: 0,
    refreshAll() {
      this.refreshCount += 1;
    },
  };
  return {
    definition,
    renderer,
    objectMap,
    objectView,
    removed,
    texture,
    geometry,
    material,
    mesh,
    foundationMesh,
    foundationGeometry,
    foundationMaterial,
    previewMaterial,
  };
}

function addProceduralDefinition(state, key) {
  const geometry = disposable();
  const material = disposable();
  const mesh = disposable();
  const definition = { key, procedural: true };
  const renderer = {
    definition,
    parts: [{ geometry, material }],
    meshes: [mesh],
  };
  state.objectMap.definitionByKey.set(key, definition);
  state.objectView.definitionByKey.set(key, definition);
  state.objectView.renderers.set(key, renderer);
  return { definition, renderer, geometry, material, mesh };
}

test('unregistering procedural definitions removes render state and releases resources', () => {
  const state = fixture();
  unregisterProceduralDefinitions({
    objectMap: state.objectMap,
    objectView: state.objectView,
    definitionKeys: [state.definition.key],
  });

  assert.equal(state.objectMap.definitionByKey.has(state.definition.key), false);
  assert.equal(state.objectView.definitionByKey.has(state.definition.key), false);
  assert.equal(state.objectView.renderers.has(state.definition.key), false);
  assert.equal(state.objectMap.definitionByKey.has('base-house'), true);
  assert.equal(state.objectView.renderers.has('base-house'), true);
  assert.deepEqual(state.removed, [state.mesh, state.foundationMesh]);
  assert.equal(state.mesh.disposed, 1);
  assert.equal(state.foundationMesh.disposed, 1);
  assert.equal(state.foundationGeometry.disposed, 1);
  assert.equal(state.foundationMaterial.disposed, 1);
  assert.equal(state.geometry.disposed, 1);
  assert.equal(state.material.disposed, 1);
  assert.equal(state.texture.disposed, 1);
  assert.equal(state.previewMaterial.disposed, 1);
  assert.equal(state.objectView.previewDefinitionKey, null);
  assert.equal(state.objectView.previewGroup.visible, false);
  assert.equal(state.objectView.previewFoundation.visible, false);
  assert.equal(state.objectView.footprintPreview.visible, false);
  assert.equal(state.objectView.selectionOverlay.visible, false);
  assert.equal(state.objectView.refreshCount, 1);
});

test('targeted unregister keeps unrelated procedural definitions installed', () => {
  const state = fixture();
  const other = addProceduralDefinition(state, 'workshop-other');

  unregisterProceduralDefinitions({
    objectMap: state.objectMap,
    objectView: state.objectView,
    definitionKeys: [state.definition.key],
  });

  assert.equal(state.objectMap.definitionByKey.has(other.definition.key), true);
  assert.equal(state.objectView.definitionByKey.has(other.definition.key), true);
  assert.equal(state.objectView.renderers.get(other.definition.key), other.renderer);
  assert.equal(other.geometry.disposed, 0);
  assert.equal(other.material.disposed, 0);
  assert.equal(other.mesh.disposed, 0);
});

test('omitting definition keys unregisters every procedural definition', () => {
  const state = fixture();
  const other = addProceduralDefinition(state, 'workshop-other');

  unregisterProceduralDefinitions({
    objectMap: state.objectMap,
    objectView: state.objectView,
  });

  assert.equal(state.objectMap.definitionByKey.has(state.definition.key), false);
  assert.equal(state.objectMap.definitionByKey.has(other.definition.key), false);
  assert.equal(state.objectView.renderers.has(state.definition.key), false);
  assert.equal(state.objectView.renderers.has(other.definition.key), false);
  assert.equal(other.geometry.disposed, 1);
  assert.equal(other.material.disposed, 1);
  assert.equal(other.mesh.disposed, 1);
  assert.equal(state.objectMap.definitionByKey.has('base-house'), true);
});

test('unregistering refuses non-procedural definitions without mutating preview or render state', () => {
  const state = fixture();
  assert.throws(
    () => unregisterProceduralDefinitions({
      objectMap: state.objectMap,
      objectView: state.objectView,
      definitionKeys: ['base-house'],
    }),
    /non-procedural object definition/,
  );
  assert.equal(state.objectMap.definitionByKey.has('base-house'), true);
  assert.equal(state.objectView.renderers.has('base-house'), true);
  assert.equal(state.objectView.previewDefinitionKey, state.definition.key);
  assert.equal(state.objectView.previewGroup.visible, true);
  assert.equal(state.previewMaterial.disposed, 0);
  assert.equal(state.objectView.refreshCount, 0);
});

test('unregistering checks renderer ownership even when definition maps are incomplete', () => {
  const state = fixture();
  state.objectMap.definitionByKey.delete('base-house');
  state.objectView.definitionByKey.delete('base-house');
  assert.throws(
    () => unregisterProceduralDefinitions({
      objectMap: state.objectMap,
      objectView: state.objectView,
      definitionKeys: ['base-house'],
    }),
    /non-procedural object definition/,
  );
  assert.equal(state.objectView.renderers.has('base-house'), true);
  assert.equal(state.objectView.refreshCount, 0);
});
