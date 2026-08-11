import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';

import { importAzgaarFullJson } from '../src/editor/import/AzgaarJsonImporter.js';

const guidanceConfig = yaml.load(readFileSync(
  new URL('../config/azgaar-guidance.yaml', import.meta.url),
  'utf8',
));

function createConfig() {
  return {
    map: { tileSize: 2 },
    import: {
      azgaarAtlasLongEdge: 2,
      azgaarOceanTransitionKilometers: 50,
      azgaarGuidance: guidanceConfig,
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

function createDocument() {
  return {
    info: {
      description: "Azgaar's Fantasy Map Generator output: azgaar.github.io/Fantasy-map-generator",
      width: 100,
      height: 100,
      seed: 'boundary-test',
    },
    settings: { distanceScale: 1, distanceUnit: 'km' },
    grid: {
      cellsX: 1,
      cellsY: 1,
      cells: [{ i: 0, h: 40, f: 1, t: 1, temp: 10, prec: 50 }],
    },
    pack: {
      cells: [{ i: 0, g: 0, p: [50, 50], h: 40, f: 1, biome: 13 }],
      biomes: [],
      rivers: [],
    },
    biomesData: {
      name: [...Array(13), 'Legacy crystal forest'],
      color: [...Array(13), '#314d3a'],
    },
  };
}

test('hybrid exports fall back to legacy biome metadata when pack.biomes is empty', () => {
  const converted = importAzgaarFullJson(createDocument(), createConfig());
  const custom = converted.world.baseTerrain.biomes.find((biome) => biome.sourceId === 13);

  assert.equal(custom.name, 'Legacy crystal forest');
  assert.equal(custom.color, '#314d3a');
  assert.equal(custom.terrainClass, 'forest');
});

test('import rejects physical worlds that exceed safe streamed coordinate bounds', () => {
  const document = createDocument();
  document.info.width = Number.MAX_SAFE_INTEGER;
  document.info.height = Number.MAX_SAFE_INTEGER;

  assert.throws(
    () => importAzgaarFullJson(document, createConfig()),
    /exceed safe streamed-world coordinates/,
  );
});
