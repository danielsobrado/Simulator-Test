import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AZGAAR_LEGACY_MACRO_SOURCE_KIND,
  AZGAAR_MACRO_SOURCE_KIND,
  decodeMacroAtlas,
} from '../src/editor/import/AzgaarMacroWorldSource.js';
import { encodeMacroField } from '../src/editor/import/MacroAtlasCodec.js';
import { createTerrainWorkerBaseTerrain } from '../src/editor/world/TerrainWorkerBaseTerrain.js';

function source() {
  return {
    kind: AZGAAR_MACRO_SOURCE_KIND,
    version: 2,
    source: { mapId: 7 },
    atlas: {
      width: 1,
      height: 1,
      fields: {
        elevation: encodeMacroField(Uint8Array.of(42), 'u8'),
        biomeId: encodeMacroField(Uint8Array.of(4), 'u8'),
        featureId: encodeMacroField(Uint16Array.of(9), 'u16'),
        simulationOnly: {
          type: 'u8',
          encoding: 'base64-u8-v1',
          data: 'AA==',
          length: 1,
        },
      },
    },
    physical: { widthMeters: 1000, heightMeters: 1000 },
    bounds: { minCellX: 0, minCellZ: 0, widthCells: 10, heightCells: 10 },
    oceanTransitionCells: 4,
    terrain: { minHeight: -20, maxHeight: 80, seaLevel: 0 },
    biomes: [],
    rivers: [{ id: 1, widthAtlas: 0.1, points: [[0, 0], [1, 1]] }],
  };
}

test('v2 guidance sources are compacted to terrain-only v1 payloads for workers', () => {
  const original = source();
  const compact = createTerrainWorkerBaseTerrain(original);

  assert.equal(compact.kind, AZGAAR_LEGACY_MACRO_SOURCE_KIND);
  assert.equal(compact.version, 1);
  assert.equal(compact.atlas.fields, undefined);
  assert.equal(compact.atlas.heightData.type, undefined);
  assert.equal(compact.atlas.biomeData.type, undefined);
  assert.equal(compact.atlas.featureData.type, undefined);

  const decoded = decodeMacroAtlas(compact);
  assert.deepEqual(decoded.heights, Uint8Array.of(42));
  assert.deepEqual(decoded.biomes, Uint8Array.of(4));
  assert.deepEqual(decoded.features, Uint16Array.of(9));

  original.atlas.fields.elevation.data = 'invalid';
  original.rivers[0].points[0][0] = 99;
  assert.notEqual(compact.atlas.heightData.data, 'invalid');
  assert.equal(compact.rivers[0].points[0][0], 0);
});

test('non-v2 terrain sources remain isolated structured clones', () => {
  const original = { kind: 'custom-source', version: 3, nested: { value: 1 } };
  const clone = createTerrainWorkerBaseTerrain(original);

  assert.deepEqual(clone, original);
  assert.notEqual(clone, original);
  original.nested.value = 2;
  assert.equal(clone.nested.value, 1);
});
