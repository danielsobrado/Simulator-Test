import assert from 'node:assert/strict';
import test from 'node:test';
import {
  importAzgaarFullJson,
  isAzgaarFullJson,
} from '../src/editor/import/AzgaarJsonImporter.js';
import { decodeAzgaarCartographySource } from '../src/editor/import/AzgaarCartographySource.js';
import { InfiniteWorldStore } from '../src/editor/world/InfiniteWorldStore.js';
import { ProceduralWorldGenerator } from '../src/editor/world/ProceduralWorldGenerator.js';

function createConfig() {
  return {
    map: { tileSize: 2 },
    import: {
      azgaarAtlasLongEdge: 4,
      azgaarOceanTransitionKilometers: 50,
    },
    world: {
      seed: 918273,
      generatorVersion: 1,
      chunkSize: 2,
      heightScale: 12,
      seaLevel: -1.5,
    },
    terrain: { minHeight: -16, maxHeight: 48 },
    voxelPrototype: { cells: [24, 16, 24] },
  };
}

function createAzgaarDocument() {
  return {
    info: {
      description: "Azgaar's Fantasy Map Generator output: azgaar.github.io/Fantasy-map-generator",
      version: '1.99',
      mapId: 'test-map',
      mapName: 'Test Realm',
      width: 1000,
      height: 800,
      seed: 'abc123',
    },
    grid: {
      cellsX: 2,
      cellsY: 2,
      seed: 'abc123',
      cells: [
        { i: 0, h: 0 },
        { i: 1, h: 35 },
        { i: 2, h: 82 },
        { i: 3, h: 45 },
      ],
    },
    pack: {
      cells: [
        { i: 0, g: 0, h: 0, biome: 0, p: [250, 200], v: [0, 1, 2] },
        { i: 1, g: 1, h: 35, biome: 1, p: [750, 200], v: [0, 2, 3] },
        { i: 2, g: 2, h: 82, biome: 2, p: [250, 600], v: [0, 3, 1] },
        { i: 3, g: 3, h: 45, biome: 3, p: [750, 600], v: [1, 3, 2] },
      ],
      vertices: [
        { i: 0, p: [0, 0] },
        { i: 1, p: [1000, 0] },
        { i: 2, p: [1000, 800] },
        { i: 3, p: [0, 800] },
      ],
      states: [{ i: 1, name: 'Northreach' }],
      provinces: [{ i: 1, name: 'Vale' }],
      cultures: [{ i: 1, name: 'Riverfolk' }],
      religions: [{ i: 1, name: 'Old Light' }],
      burgs: [{ i: 1, name: 'Harborwatch', x: 700, y: 200 }],
      rivers: [{ i: 1, name: 'Silverrun' }],
      routes: [{ i: 1, group: 'roads' }],
      markers: [{ i: 1, type: 'volcano' }],
      zones: [{ i: 1, name: 'Blight' }],
    },
    biomesData: {
      name: ['Marine', 'Temperate deciduous forest', 'Hot desert', 'Wetland'],
    },
    notes: [{ id: 'note-1', name: 'Ancient ruin' }],
  };
}

test('detects Azgaar Full JSON documents', () => {
  assert.equal(isAzgaarFullJson(createAzgaarDocument()), true);
  assert.equal(isAzgaarFullJson({ info: {}, grid: { cells: [] } }), false);
});

test('converts Azgaar terrain into a portable streamed macro source', () => {
  const config = createConfig();
  const converted = importAzgaarFullJson(createAzgaarDocument(), config);
  assert.equal(converted.version, 6);
  assert.equal(converted.world.chunkSize, 2);
  assert.equal(converted.chunks.length, 0);
  assert.equal(converted.world.baseTerrain.kind, 'azgaar-macro-v2');
  assert.equal(converted.world.baseTerrain.atlas.width, 4);
  assert.equal(converted.world.baseTerrain.atlas.height, 3);
  assert.equal(converted.objects.length, 0);
  assert.equal(converted.campaign.source.mapName, 'Test Realm');
  assert.equal(converted.campaign.cartography.kind, 'azgaar-cartography-v1');
  assert.equal(converted.campaign.cartography.cells.count, 4);
  const cartography = decodeAzgaarCartographySource(
    JSON.parse(JSON.stringify(converted.campaign.cartography)),
  );
  assert.deepEqual([...cartography.cellIds], [0, 1, 2, 3]);
  assert.equal(converted.campaign.states[0].name, 'Northreach');
  assert.equal(converted.campaign.burgs[0].name, 'Harborwatch');
  assert.equal(converted.importWarnings.length, 3);

  const generator = new ProceduralWorldGenerator(converted.world.generator);
  const store = new InfiniteWorldStore({
    chunkSize: converted.world.chunkSize,
    tileSize: converted.world.tileSize,
    cacheLimit: 8,
    generator,
  });
  store.loadDocument(converted);

  assert.equal(store.getStats().tileOverrideCount, 0);
  assert.equal(store.getStats().heightOverrideCount, 0);
  assert.equal(store.toDocument().world.baseTerrain.kind, 'azgaar-macro-v2');
});

test('rejects minimal or unrelated JSON exports', () => {
  assert.throws(
    () => importAzgaarFullJson({
      info: {
        description: "Azgaar's Fantasy Map Generator output: azgaar.github.io/Fantasy-map-generator",
      },
      pack: {},
    }, createConfig()),
    /non-empty grid cells and positive grid dimensions/,
  );
});

test('rejects malformed grid dimensions and duplicate cell ids before import allocation', () => {
  const invalidDimensions = createAzgaarDocument();
  invalidDimensions.grid.cellsX = 0;
  assert.throws(
    () => importAzgaarFullJson(invalidDimensions, createConfig()),
    /positive grid dimensions/,
  );

  const duplicateIds = createAzgaarDocument();
  duplicateIds.grid.cells[1].i = duplicateIds.grid.cells[0].i;
  assert.throws(
    () => importAzgaarFullJson(duplicateIds, createConfig()),
    /duplicate grid cell id 0/,
  );
});

test('keeps older Full JSON imports usable when vector vertices are unavailable', () => {
  const document = createAzgaarDocument();
  delete document.pack.vertices;
  const converted = importAzgaarFullJson(document, createConfig());
  assert.equal(converted.campaign.cartography, undefined);
  assert.equal(converted.world.baseTerrain.kind, 'azgaar-macro-v2');
});

test('rejects malformed vector geometry when a Full JSON export includes it', () => {
  const document = createAzgaarDocument();
  document.pack.cells[0].v[0] = 999;
  assert.throws(
    () => importAzgaarFullJson(document, createConfig()),
    /missing vertex 999/,
  );
});
