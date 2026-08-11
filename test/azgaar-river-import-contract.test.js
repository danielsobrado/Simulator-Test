import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';

import { importAzgaarFullJson } from '../src/editor/import/AzgaarJsonImporter.js';
import {
  createAzgaarMacroWorldSource,
  decodeMacroAtlas,
} from '../src/editor/import/AzgaarMacroWorldSource.js';

const guidanceConfig = yaml.load(readFileSync(
  new URL('../config/azgaar-guidance.yaml', import.meta.url),
  'utf8',
));

function createConfig() {
  return {
    map: { tileSize: 2 },
    import: {
      azgaarAtlasLongEdge: 10,
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
      seed: 'river-contract',
    },
    settings: { distanceScale: 2, distanceUnit: 'mi' },
    grid: {
      cellsX: 1,
      cellsY: 1,
      cells: [{ i: 0, h: 40, f: 1, t: 1, temp: 10, prec: 50 }],
    },
    pack: {
      cells: [{
        i: 0,
        g: 0,
        p: [50, 50],
        h: 40,
        f: 1,
        biome: 4,
        r: 7,
      }],
      rivers: [{
        i: 7,
        width: 1,
        points: [[0, 50], [100, 50]],
      }],
    },
  };
}

test('Azgaar river width stays in kilometers regardless of map distance display units', () => {
  const source = createAzgaarMacroWorldSource(createDocument(), createConfig());
  const metersPerAtlasPixel = source.physical.widthMeters / source.atlas.width;
  const expectedWidthAtlas = 1000 / metersPerAtlasPixel;

  assert.ok(Math.abs(source.rivers[0].widthAtlas - expectedWidthAtlas) < 1e-12);
});

test('Full JSON import accepts the documented -1 off-canvas river cell sentinel', () => {
  const document = createDocument();
  delete document.pack.rivers[0].points;
  document.pack.rivers[0].cells = [-1, 0];

  const converted = importAzgaarFullJson(document, createConfig());
  const source = converted.world.baseTerrain;
  const fields = decodeMacroAtlas(source, { includeGuidance: true }).fields;

  assert.equal(source.rivers.length, 0);
  assert.equal(fields.riverId[0], 7);
  assert.equal(fields.riverDistance[0], 0);
});
