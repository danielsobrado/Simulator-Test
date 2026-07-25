import assert from 'node:assert/strict';
import test from 'node:test';
import { disposeModelParts } from '../src/editor/assets/modelParts.js';
import { ProceduralAssetManager } from '../src/editor/workshop/ProceduralAssetManager.js';
import { createProceduralAssetRecord } from '../src/editor/workshop/ProceduralAssetStore.js';

function recipe(overrides = {}) {
  return {
    archetype: 'wall',
    style: 'granite',
    topStyle: 'battlements',
    finish: 'masonry',
    shape: 'classic',
    towerSide: 'none',
    width: 4,
    depth: 1,
    height: 4,
    roofScale: 1,
    roofOverhang: 0.35,
    seed: 1848,
    detail: 1,
    weathering: 0.2,
    windows: false,
    ivy: false,
    remesh: true,
    albedo: true,
    surfaceTextures: { sources: {}, slots: {} },
    componentTransforms: {},
    ...overrides,
  };
}

function managerFixture() {
  const objectMap = {
    definitionByKey: new Map(),
    registerDefinition(definition) {
      this.definitionByKey.set(definition.key, definition);
    },
  };
  const objectView = {
    definitionByKey: new Map(),
    renderers: new Map(),
    parts: null,
    registerDefinition(definition, parts) {
      this.definitionByKey.set(definition.key, definition);
      this.parts = parts;
    },
  };
  const ui = { setProceduralObjectDefinitions() {} };
  return {
    objectMap,
    objectView,
    manager: new ProceduralAssetManager({
      tileSize: 2,
      objectMap,
      objectView,
      ui,
    }),
  };
}

test('baked placement footprint includes moved and scaled components', () => {
  const fixture = managerFixture();
  const record = createProceduralAssetRecord({
    label: 'Expanded wall',
    recipe: recipe({
      componentTransforms: {
        'structure-main': {
          position: [8, 0, 0],
          rotation: [0, 0, 0],
          scale: [2, 1, 1],
        },
      },
    }),
  });

  try {
    const definition = fixture.manager.install(record);
    assert.ok(definition.footprint.width > 2);
    assert.ok(definition.footprint.width >= 10);
    assert.ok(definition.footprint.depth >= 1);
  } finally {
    disposeModelParts(fixture.objectView.parts ?? []);
  }
});

test('new baked records prune transforms for components absent from generated geometry', () => {
  const fixture = managerFixture();
  try {
    const record = fixture.manager.create({
      label: 'Pruned wall',
      recipe: recipe({
        componentTransforms: {
          'removed-window': {
            position: [2, 0, 0],
            rotation: [0, 0, 0],
            scale: [1.2, 1, 1],
          },
          'structure-main': {
            position: [1, 0, 0],
            rotation: [0, 0, 0],
            scale: [1.1, 1, 1],
          },
        },
      }),
    });

    assert.deepEqual(Object.keys(record.recipe.componentTransforms), ['structure-main']);
    assert.deepEqual(
      Object.keys(fixture.manager.toDocument()[0].recipe.componentTransforms),
      ['structure-main'],
    );
  } finally {
    disposeModelParts(fixture.objectView.parts ?? []);
  }
});
