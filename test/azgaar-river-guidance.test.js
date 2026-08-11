import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';

import { deriveAzgaarWorldGuidance } from '../src/editor/import/AzgaarWorldGuidance.js';

const guidanceConfig = yaml.load(readFileSync(
  new URL('../config/azgaar-guidance.yaml', import.meta.url),
  'utf8',
));

function createRaw(width, height) {
  const length = width * height;
  return {
    elevation: new Uint8Array(length).fill(40),
    temperature: new Int8Array(length).fill(10),
    precipitation: new Uint8Array(length).fill(50),
    biomeId: new Uint8Array(length).fill(4),
    riverId: new Uint32Array(length),
    settlementScore: new Int16Array(length),
    harborScore: new Uint8Array(length),
  };
}

test('river distance merges sampled river cells with available vector geometry', () => {
  const width = 5;
  const height = 5;
  const raw = createRaw(width, height);
  const rasterRiverIndex = 2 * width + 4;
  raw.riverId[rasterRiverIndex] = 9;

  const derived = deriveAzgaarWorldGuidance({
    raw,
    rivers: [{ id: 7, widthAtlas: 0.5, points: [[0, 0], [0, 4]] }],
    width,
    height,
    physicalWidthMeters: 5_000,
    biomes: [],
    config: guidanceConfig,
  });

  assert.equal(derived.riverDistance[rasterRiverIndex], 0);
  assert.equal(derived.riverDistance[2 * width], 0);
});
