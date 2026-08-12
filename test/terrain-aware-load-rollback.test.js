import assert from 'node:assert/strict';
import test from 'node:test';

import { TerrainAwareEditorController } from '../src/editor/TerrainAwareEditorController.js';
import { INFINITE_WORLD_FORMAT_VERSION } from '../src/editor/world/worldConstants.js';

test('auxiliary world rollback continues after one restore fails', () => {
  const originalLoadError = new Error('world load failed');
  const proceduralRollbackError = new Error('procedural rollback failed');
  const previousProceduralAssets = [{ id: 'old-procedural' }];
  const previousMaterials = { presets: [{ id: 'old-material' }] };
  const previousConstructions = [{ id: 'old-wall' }];
  const previousBiomeAssets = { version: 1, biomes: [] };
  const restored = [];

  const worldStore = {
    createTransactionSnapshot: () => ({ id: 'old-world' }),
    restoreTransactionSnapshot: () => restored.push('world'),
    loadDocument: () => { throw originalLoadError; },
  };
  const controller = Object.create(TerrainAwareEditorController.prototype);
  Object.assign(controller, {
    tileMap: { worldStore },
    heightField: {},
    objectMap: {
      toDocument: () => [],
      loadDocument() {},
      replaceAll: () => restored.push('objects'),
    },
    voxelStampStore: null,
    proceduralAssetManager: {
      toDocument: () => previousProceduralAssets,
      replaceAll(value) {
        if (value === previousProceduralAssets) throw proceduralRollbackError;
      },
    },
    constructionMaterialStore: {
      toDocument: () => previousMaterials,
      loadDocument(value) {
        if (value === previousMaterials) restored.push('materials');
      },
    },
    constructionStore: {
      toDocument: () => previousConstructions,
      replaceAll(value) {
        if (value === previousConstructions) restored.push('constructions');
      },
    },
    biomeAssetPalette: {
      toDocument: () => previousBiomeAssets,
      replaceDocument(value) {
        if (value === previousBiomeAssets) restored.push('biomes');
      },
      reset() {},
    },
    sceneSettingsProvider: null,
    sceneSettingsConsumer: null,
    inventoryStore: null,
  });

  const document = {
    version: INFINITE_WORLD_FORMAT_VERSION,
    proceduralAssets: [{ id: 'new-procedural' }],
    constructionMaterials: { presets: [{ id: 'new-material' }] },
    constructions: [{ id: 'new-wall' }],
    visualConfig: { biomeAssets: { version: 1, biomes: [{ id: 4 }] } },
  };

  assert.throws(
    () => controller.loadDocument(document),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors[0], originalLoadError);
      assert.equal(error.errors[1], proceduralRollbackError);
      return true;
    },
  );
  assert.deepEqual(restored, ['world', 'objects', 'materials', 'constructions', 'biomes']);
});
