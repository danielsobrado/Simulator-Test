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

function createCurrentExport() {
  return {
    info: {
      description: "Azgaar's Fantasy Map Generator output: azgaar.github.io/Fantasy-map-generator",
      version: 'current-test',
      mapName: 'Current Export',
      width: 100,
      height: 100,
      seed: 'current-seed',
    },
    settings: { distanceScale: 1, distanceUnit: 'km' },
    grid: {
      cellsX: 1,
      cellsY: 1,
      seed: 'current-seed',
      cells: [{ i: 0, h: 40, f: 1, t: 1, temp: 12, prec: 60 }],
    },
    pack: {
      cells: [{
        i: 0,
        g: 0,
        p: [50, 50],
        h: 40,
        f: 1,
        biome: 13,
      }],
      biomes: [
        {
          i: 4,
          name: 'Grassland',
          color: '#112233',
          habitability: 31,
          iconsDensity: 121,
          icons: ['grass'],
          cost: 51,
        },
        {
          i: 13,
          name: 'Moonlit forest',
          color: '#314d3a',
          habitability: 55,
          iconsDensity: 90,
          icons: ['deciduous'],
          cost: 80,
        },
      ],
      rivers: [],
    },
  };
}

test('imports biome metadata from the current pack.biomes Full JSON shape', () => {
  const converted = importAzgaarFullJson(createCurrentExport(), createConfig());
  const biomes = converted.world.baseTerrain.biomes;
  const grassland = biomes.find((biome) => biome.sourceId === 4);
  const custom = biomes.find((biome) => biome.sourceId === 13);

  assert.equal(grassland.color, '#112233');
  assert.equal(grassland.habitability, 31);
  assert.equal(custom.name, 'Moonlit forest');
  assert.equal(custom.color, '#314d3a');
  assert.equal(custom.terrainClass, 'forest');
  assert.equal(custom.supportsTrees, true);
  assert.equal(converted.campaign.cartography, undefined);
});
