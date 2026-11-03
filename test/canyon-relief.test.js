import assert from 'node:assert/strict';
import test from 'node:test';

import { AZGAAR_STANDARD_BIOMES, createAzgaarBiomeDefinitions } from '../src/editor/AzgaarBiomeCatalog.js';
import { encodeMacroField } from '../src/editor/import/MacroAtlasCodec.js';
import {
  applyRegionalBiomes,
  canyonBiomeSourceIds,
  validateRegionalBiomes,
} from '../src/editor/import/AzgaarRegionalBiomes.js';
import { AzgaarMacroWorldGenerator } from '../src/editor/world/AzgaarMacroWorldGenerator.js';
import { canyonRelief } from '../src/editor/world/CanyonRelief.js';
import { resolveBiomeLooks } from '../src/editor/biomes/BiomeLooks.js';

const BADLANDS = Object.freeze({
  name: 'Stonehold Badlands',
  color: '#a8a090',
  states: ['Ironpeak'],
  fromBiomes: [9, 10],
  maxPrecipitation: 15,
  relief: 'canyon',
});

function createDocument() {
  return {
    biomesData: { name: AZGAAR_STANDARD_BIOMES.map((biome) => biome.name), color: [] },
    grid: { cells: [{ prec: 10 }, { prec: 40 }, { prec: 5 }, { prec: 5 }] },
    pack: {
      states: [{ i: 0, name: 'Neutrals' }, { i: 1, name: 'Ironpeak' }, { i: 2, name: 'Elsewhere' }],
      cells: [
        { i: 0, g: 0, state: 1, biome: 9 }, // dry taiga in Ironpeak: moves
        { i: 1, g: 1, state: 1, biome: 9 }, // too wet: stays
        { i: 2, g: 2, state: 1, biome: 11 }, // glacier: stays
        { i: 3, g: 3, state: 2, biome: 9 }, // another state: stays
      ],
    },
  };
}

test('dry cells of the named state move to a new custom biome; the map is untouched', () => {
  const document = createDocument();
  const result = applyRegionalBiomes(document, [BADLANDS]);
  assert.deepEqual(result.pack.cells.map((cell) => cell.biome), [13, 9, 11, 9]);
  assert.equal(result.biomesData.name[13], 'Stonehold Badlands');
  assert.deepEqual(document.pack.cells.map((cell) => cell.biome), [9, 9, 11, 9]);
  assert.equal(document.biomesData.name.length, 13);

  const definitions = createAzgaarBiomeDefinitions(result.biomesData, [13], {
    customBiomeDesertKeywords: ['badlands'],
  });
  const badlands = definitions.find((definition) => definition.sourceId === 13);
  assert.equal(badlands.tileId, 32);
  assert.equal(badlands.terrainClass, 'desert');
  assert.equal(badlands.supportsTrees, false);
  assert.deepEqual(canyonBiomeSourceIds(definitions, [BADLANDS]), [13]);
});

test('a map without the state, or with no matching cells, is returned as it was', () => {
  const document = createDocument();
  assert.equal(applyRegionalBiomes(document, [{ ...BADLANDS, states: ['Nowhere'] }]), document);
  assert.equal(applyRegionalBiomes(document, [{ ...BADLANDS, maxPrecipitation: 1 }]), document);
  assert.equal(applyRegionalBiomes(document, undefined), document);
  assert.throws(() => validateRegionalBiomes([{ ...BADLANDS, relief: 'hills' }]), /relief/);
  assert.throws(() => validateRegionalBiomes([{ ...BADLANDS, color: 'grey' }]), /color/);
});

test('canyon relief stands in flat terraces broken by cliffs', () => {
  let flat = 0;
  let cliff = 0;
  let low = Infinity;
  let high = -Infinity;
  const samples = 4000;
  for (let i = 0; i < samples; i += 1) {
    const x = (i % 80) * 31 + 7;
    const z = Math.floor(i / 80) * 29 + 3;
    // Without dunes, so the slope read is the mesas' own.
    const here = canyonRelief(x, z, 42, false);
    const slope = Math.abs(canyonRelief(x + 1, z, 42, false) - here) / 2;
    if (slope < 0.15) flat += 1;
    if (slope > 0.8) cliff += 1;
    low = Math.min(low, here);
    high = Math.max(high, here);
  }
  assert.ok(flat / samples > 0.5, `most ground is mesa top or floor (${flat})`);
  assert.ok(cliff > 20, `some ground is a cliff (${cliff})`);
  assert.ok(high - low > 50 && high < 60 && low > -80, `relief ${low.toFixed(1)} … ${high.toFixed(1)}`);
  assert.equal(canyonRelief(1234, 5678, 42), canyonRelief(1234, 5678, 42));
});

function createSource(canyonBiomes) {
  const biomes = createAzgaarBiomeDefinitions(
    { name: [...AZGAAR_STANDARD_BIOMES.map((biome) => biome.name), 'Stonehold Badlands'] },
    [13],
    { customBiomeDesertKeywords: ['badlands'] },
  );
  return {
    kind: 'azgaar-macro-v2',
    version: 2,
    atlas: {
      width: 2,
      height: 1,
      fields: {
        elevation: encodeMacroField(Uint8Array.of(45, 45), 'u8'),
        biomeId: encodeMacroField(Uint8Array.of(9, 13), 'u8'),
      },
    },
    physical: { widthMeters: 16384, heightMeters: 8192 },
    bounds: { minCellX: 0, minCellZ: 0, widthCells: 8192, heightCells: 4096 },
    oceanTransitionCells: 1,
    terrain: { minHeight: -16, maxHeight: 48, seaLevel: -1.5, ...(canyonBiomes ? { canyonBiomes } : {}) },
    biomes,
    rivers: [],
  };
}

const metadata = Object.freeze({ seed: 42, version: 1, heightScale: 12, seaLevel: -1.5 });

test('the generator raises canyons only inside the canyon biome, near and far', () => {
  const plain = new AzgaarMacroWorldGenerator(createSource(null), metadata);
  const canyon = new AzgaarMacroWorldGenerator(createSource([13]), metadata);
  let inside = 0;
  for (let i = 0; i < 64; i += 1) {
    const z = 300 + i * 53;
    // The taiga half, a texel clear of the border, is unchanged near and far.
    assert.equal(canyon.sampleHeight(500 + i * 17, z), plain.sampleHeight(500 + i * 17, z));
    assert.equal(canyon.sampleMacroColumn(500 + i * 17, z).height, plain.sampleMacroColumn(500 + i * 17, z).height);
    inside = Math.max(inside, Math.abs(canyon.sampleHeight(7000 + i * 13, z) - plain.sampleHeight(7000 + i * 13, z)));
  }
  assert.ok(inside > 10, `canyons reshape the badlands (${inside.toFixed(1)} m)`);
  assert.throws(() => new AzgaarMacroWorldGenerator(createSource(['x']), metadata), /canyonBiomes/);
});

test('biome looks list arid tiles and crag biomes', () => {
  const looks = resolveBiomeLooks({
    snow: { color: '#ffffff', frost: '#eeeeee' },
    byTileId: { 1: { arid: 'sand' }, 2: { arid: 'mineral' }, 32: { arid: 'sand', crags: true } },
  });
  assert.deepEqual(looks.arid.sand, [1, 32]);
  assert.deepEqual(looks.arid.mineral, [2]);
  assert.equal(looks.crags[32], 1);
  assert.equal(looks.crags[1], 0);
  assert.throws(() => resolveBiomeLooks({
    snow: { color: '#ffffff', frost: '#eeeeee' }, byTileId: { 32: { arid: 'gravel' } },
  }), /arid/);
});
