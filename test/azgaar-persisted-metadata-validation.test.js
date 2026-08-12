import assert from 'node:assert/strict';
import test from 'node:test';

import { AZGAAR_STANDARD_BIOMES } from '../src/editor/AzgaarBiomeCatalog.js';
import { encodeMacroField } from '../src/editor/import/MacroAtlasCodec.js';
import { AzgaarMacroWorldGenerator } from '../src/editor/world/AzgaarMacroWorldGenerator.js';
import { WorldGuidanceField } from '../src/editor/world/WorldGuidanceField.js';
import { WORLD_MAX_SAFE_CELL_COORDINATE } from '../src/editor/world/worldConstants.js';

const generatorMetadata = Object.freeze({
  seed: 42,
  version: 1,
  heightScale: 12,
  seaLevel: -1.5,
});

function createSource() {
  return {
    kind: 'azgaar-macro-v2',
    version: 2,
    atlas: {
      width: 1,
      height: 1,
      fields: {
        elevation: encodeMacroField(Uint8Array.of(40), 'u8'),
        biomeId: encodeMacroField(Uint8Array.of(4), 'u8'),
        moisture: encodeMacroField(Uint8Array.of(128), 'u8', { scale: 1 / 255 }),
      },
    },
    physical: { widthMeters: 2, heightMeters: 2 },
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

test('guidance sampling rejects non-finite persisted field scales', () => {
  const source = createSource();
  source.atlas.fields.moisture.scale = Number.NaN;
  const guidance = new WorldGuidanceField(source);

  assert.throws(
    () => guidance.sampleContinuous('moisture', 0, 0),
    /scale must be a positive finite number/,
  );
});

test('guidance sampling rejects zero persisted field scales', () => {
  const source = createSource();
  source.atlas.fields.moisture.scale = 0;
  const guidance = new WorldGuidanceField(source);

  assert.throws(
    () => guidance.sampleContinuous('moisture', 0, 0),
    /scale must be a positive finite number/,
  );
});

test('guidance construction rejects invalid persisted physical width', () => {
  const source = createSource();
  source.physical.widthMeters = Number.POSITIVE_INFINITY;

  assert.throws(
    () => new WorldGuidanceField(source),
    /physical width must be a positive finite number/,
  );
});

test('macro generator rejects persisted bounds beyond the engine coordinate limit', () => {
  const source = createSource();
  source.bounds = {
    minCellX: WORLD_MAX_SAFE_CELL_COORDINATE,
    minCellZ: 0,
    widthCells: 2,
    heightCells: 1,
  };

  assert.throws(
    () => new AzgaarMacroWorldGenerator(source, generatorMetadata),
    /world bounds exceed the engine coordinate limit/,
  );
});

test('macro generator rejects invalid persisted terrain metadata', () => {
  const source = createSource();
  source.terrain.reliefExponent = Number.NaN;

  assert.throws(
    () => new AzgaarMacroWorldGenerator(source, generatorMetadata),
    /reliefExponent must be positive/,
  );
});

test('macro generator rejects malformed persisted river vectors', () => {
  const source = createSource();
  source.rivers = [{
    id: 1,
    widthAtlas: 0.5,
    points: [[0, 0], [Number.NaN, 1]],
  }];

  assert.throws(
    () => new AzgaarMacroWorldGenerator(source, generatorMetadata),
    /invalid river coordinates/,
  );
});
