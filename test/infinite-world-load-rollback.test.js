import assert from 'node:assert/strict';
import test from 'node:test';

import { AZGAAR_STANDARD_BIOMES } from '../src/editor/AzgaarBiomeCatalog.js';
import { createMacroAtlasPayload } from '../src/editor/import/AzgaarMacroWorldSource.js';
import { InfiniteWorldStore } from '../src/editor/world/InfiniteWorldStore.js';
import { ProceduralWorldGenerator } from '../src/editor/world/ProceduralWorldGenerator.js';
import { INFINITE_WORLD_FORMAT_VERSION } from '../src/editor/world/worldConstants.js';

function createBaseTerrain(mapName, height) {
  return {
    kind: 'azgaar-macro-v1',
    version: 1,
    source: { mapName },
    atlas: {
      width: 1,
      height: 1,
      ...createMacroAtlasPayload({
        heights: Uint8Array.of(height),
        biomes: Uint8Array.of(4),
        features: Uint16Array.of(1),
      }),
    },
    bounds: { minCellX: 0, minCellZ: 0, widthCells: 1, heightCells: 1 },
    oceanTransitionCells: 1,
    terrain: {
      minHeight: -16,
      maxHeight: 48,
      seaLevel: -1.5,
      verticalExaggeration: 1,
      reliefExponent: 1,
    },
    biomes: AZGAAR_STANDARD_BIOMES,
    rivers: [],
  };
}

test('failed infinite-world load restores the previous base terrain and generator', () => {
  const store = new InfiniteWorldStore({
    chunkSize: 2,
    tileSize: 2,
    generator: new ProceduralWorldGenerator(),
  });
  store.setBaseTerrain(createBaseTerrain('before', 40));
  const heightBefore = store.getHeight(0, 0);
  const revisionBefore = store.revision;

  assert.throws(() => store.loadDocument({
    version: INFINITE_WORLD_FORMAT_VERSION,
    world: {
      chunkSize: 2,
      tileSize: 2,
      baseTerrain: createBaseTerrain('replacement', 80),
    },
    chunks: [{ x: 0, z: 0, tiles: [[999, 4]], heights: [] }],
  }), /tile override index is invalid/);

  assert.equal(store.baseTerrain.source.mapName, 'before');
  assert.equal(store.getHeight(0, 0), heightBefore);
  assert.equal(store.revision, revisionBefore);
});
