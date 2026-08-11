import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAzgaarImportSummary,
  createAzgaarMacroWorldSource,
  decodeMacroAtlas,
} from '../src/editor/import/AzgaarMacroWorldSource.js';

function createDocument() {
  const cells = [];
  const packCells = [];
  for (let z = 0; z < 3; z += 1) {
    for (let x = 0; x < 5; x += 1) {
      const i = z * 5 + x;
      const land = x > 0 && x < 4;
      const height = land ? 35 + x * 12 : 5;
      cells.push({ i, h: height, f: land ? 1 : 2 });
      packCells.push({
        i,
        g: i,
        h: height,
        biome: land ? (x === 2 ? 6 : 4) : 0,
        f: land ? 1 : 2,
        p: [x * 200, z * 200],
      });
    }
  }
  return {
    info: {
      description: "Azgaar's Fantasy Map Generator output: azgaar.github.io/Fantasy-map-generator",
      version: '1.138.0',
      mapId: 'macro-test',
      mapName: 'Macro Test',
      width: 1000,
      height: 600,
      seed: 'macro-seed',
    },
    settings: { distanceScale: 3, distanceUnit: 'km' },
    grid: { cellsX: 5, cellsY: 3, cells, seed: 'macro-seed' },
    pack: {
      cells: packCells,
      rivers: [{
        i: 7,
        width: 1,
        points: [[400, 100], [500, 300], [600, 500]],
      }],
    },
    biomesData: {
      name: ['Marine', 'Hot desert', 'Cold desert', 'Savanna', 'Grassland',
        'Tropical seasonal forest', 'Temperate deciduous forest', 'Tropical rainforest',
        'Temperate rainforest', 'Taiga', 'Tundra', 'Glacier', 'Wetland', 'Crystal barrens'],
      color: ['#466eab', '#fbe79f', '#b5b887', '#d2d082', '#c8d68f', '#b6d95d',
        '#29bc56', '#7dcb35', '#409c43', '#4b6b32', '#96784b', '#d5e7eb',
        '#0b9131', '#7f5ac6'],
      habitability: [...Array(13), 44],
      cost: [...Array(13), 275],
      iconsDensity: [...Array(13), 75],
      icons: [...Array.from({ length: 13 }, () => []), ['crystal', 'crystal', 'deadTree']],
    },
  };
}

const config = {
  map: { tileSize: 2 },
  import: {
    azgaarAtlasLongEdge: 10,
    azgaarOceanTransitionKilometers: 50,
  },
  terrain: { minHeight: -16, maxHeight: 48 },
  world: { seaLevel: -1.5 },
};

test('summarizes a non-square Azgaar atlas and preserves its physical scale', () => {
  const summary = buildAzgaarImportSummary(createDocument(), config);
  assert.equal(summary.atlasWidth, 10);
  assert.equal(summary.atlasHeight, 6);
  assert.equal(summary.physicalWidthMeters, 3_000_000);
  assert.equal(summary.physicalHeightMeters, 1_800_000);
  assert.equal(summary.distanceUnit, 'km');
  assert.equal(summary.standardBiomeCount, 13);
  assert.equal(summary.customBiomeCount, 1);
  assert.ok(summary.estimatedRawBytes >= 10 * 6 * 4);
});

test('supports an import-time physical width override without changing aspect ratio', () => {
  const summary = buildAzgaarImportSummary(createDocument(), config, {
    physicalWidthMeters: 6_000_000,
  });
  assert.equal(summary.physicalWidthMeters, 6_000_000);
  assert.equal(summary.physicalHeightMeters, 3_600_000);
});

test('encodes a portable guidance atlas with terrain, climate, and river data', () => {
  const source = createAzgaarMacroWorldSource(createDocument(), config);
  assert.equal(source.kind, 'azgaar-macro-v2');
  assert.equal(source.atlas.width, 10);
  assert.equal(source.atlas.height, 6);
  assert.equal(source.bounds.widthCells, 1_500_000);
  assert.equal(source.bounds.heightCells, 900_000);
  assert.ok(source.oceanTransitionCells > 0);
  assert.equal(source.rivers.length, 1);
  assert.equal(source.biomes.length, 14);
  assert.equal(source.biomes[0].name, 'Marine');
  assert.equal(source.biomes[0].tileId, 0);
  assert.equal(source.biomes[12].name, 'Wetland');
  assert.deepEqual(
    source.biomes[13],
    {
      sourceId: 13,
      tileId: 32,
      key: 'azgaar_custom_13',
      name: 'Crystal barrens',
      color: '#7f5ac6',
      icon: '🗺️',
      standard: false,
      terrainClass: 'plains',
      supportsGrass: true,
      supportsTrees: false,
      habitability: 44,
      movementCost: 275,
      reliefIconDensity: 75,
      reliefIcons: ['crystal', 'crystal', 'deadTree'],
    },
  );

  const decoded = decodeMacroAtlas(source);
  assert.equal(decoded.heights.length, 60);
  assert.equal(decoded.biomes.length, 60);
  assert.equal(decoded.features.length, 60);
  assert.ok(decoded.heights.some((height) => height >= 59));
  assert.ok(decoded.biomes.includes(6));
  assert.ok(decoded.features.includes(1));

  const guidance = decodeMacroAtlas(source, { includeGuidance: true }).fields;
  assert.equal(Object.keys(guidance).length, 25);
  assert.equal(guidance.temperature.length, 60);
  assert.equal(guidance.coastDistance.length, 60);
  assert.equal(guidance.riverDistance.length, 60);
});
