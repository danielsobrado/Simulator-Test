import assert from 'node:assert/strict';
import test from 'node:test';

import { createAzgaarBiomeDefinitions } from '../src/editor/AzgaarBiomeCatalog.js';
import { createMacroAtlasPayload } from '../src/editor/import/AzgaarMacroWorldSource.js';
import { ProceduralWorldGenerator } from '../src/editor/world/ProceduralWorldGenerator.js';
import { WorkerBackedWorldStore } from '../src/editor/world/WorkerBackedWorldStore.js';

function createStore({ onSetBaseTerrain = null } = {}) {
  const calls = { setBaseTerrain: 0, dispose: 0 };
  const chunkWorker = {
    setBaseTerrain(baseTerrain) {
      calls.setBaseTerrain += 1;
      onSetBaseTerrain?.(baseTerrain);
    },
    dispose() { calls.dispose += 1; },
  };
  const store = new WorkerBackedWorldStore({
    chunkWorker,
    chunkSize: 8,
    tileSize: 2,
    cacheLimit: 16,
    generator: new ProceduralWorldGenerator(),
  });
  return { calls, store };
}

function legacyBaseTerrain() {
  return {
    kind: 'azgaar-macro-v1',
    version: 1,
    source: { mapId: 41 },
    atlas: {
      width: 1,
      height: 1,
      ...createMacroAtlasPayload({
        heights: Uint8Array.of(40),
        biomes: Uint8Array.of(4),
        features: Uint16Array.of(1),
      }),
    },
    physical: { widthMeters: 16, heightMeters: 16 },
    bounds: { minCellX: 0, minCellZ: 0, widthCells: 8, heightCells: 8 },
    oceanTransitionCells: 8,
    terrain: {
      minHeight: -16,
      maxHeight: 48,
      seaLevel: -1.5,
      verticalExaggeration: 1,
      reliefExponent: 1,
    },
    biomes: createAzgaarBiomeDefinitions(),
    rivers: [],
  };
}

test('malformed sparse tile values are rejected before world state starts mutating', () => {
  const { calls, store } = createStore();
  try {
    const document = store.toDocument();
    document.chunks = [{
      x: 0,
      z: 0,
      tiles: [[0, 999]],
      heights: [],
    }];

    assert.throws(
      () => store.loadDocument(document),
      /tile override value must be an unsigned byte/,
    );
    assert.equal(store.baseTerrainRevision, 0);
    assert.equal(calls.setBaseTerrain, 0);
    assert.equal(store.tileOverrides.size, 0);
  } finally {
    store.dispose();
  }
});

test('the full unsigned-byte tile range remains valid for sparse saves', () => {
  const { store } = createStore();
  try {
    const document = store.toDocument();
    document.chunks = [{
      x: 0,
      z: 0,
      tiles: [[0, 255]],
      heights: [],
    }];

    store.loadDocument(document);
    assert.equal(store.getTile(0, 0), 255);
  } finally {
    store.dispose();
  }
});

test('failed worker reconfiguration restores the previous base terrain', () => {
  let failProceduralConfigure = false;
  const configuredKinds = [];
  const { store } = createStore({
    onSetBaseTerrain(baseTerrain) {
      configuredKinds.push(baseTerrain?.kind ?? null);
      if (failProceduralConfigure && baseTerrain === null) {
        throw new Error('configure failed');
      }
    },
  });

  try {
    store.setBaseTerrain(legacyBaseTerrain());
    const before = store.getTile(0, 0);
    const document = store.toDocument();
    delete document.world.baseTerrain;
    failProceduralConfigure = true;

    assert.throws(() => store.loadDocument(document), /configure failed/);
    assert.equal(store.baseTerrain?.kind, 'azgaar-macro-v1');
    assert.equal(store.getTile(0, 0), before);
    assert.deepEqual(configuredKinds.slice(-2), [null, 'azgaar-macro-v1']);
  } finally {
    store.dispose();
  }
});
