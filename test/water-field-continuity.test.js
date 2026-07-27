import assert from 'node:assert/strict';
import test from 'node:test';
import { createWaterField, halfToFloat } from '../src/editor/water/WaterField.js';
import { resolveWaterDomainConfig } from '../src/editor/water/WaterConfig.js';
import { WaterTerrainModel } from '../src/editor/water/WaterTerrainModel.js';

const config = resolveWaterDomainConfig({ cellSizeMeters: 1 });
const model = new WaterTerrainModel({
  seed: 91,
  seaLevel: 0,
  config,
  sampleBaseHeight: (x, z) => -3 - Math.sin(x / 11) - Math.cos(z / 13),
  sampleBaseTile: () => 0,
});

function channel(field, x, z, component) {
  return halfToFloat(field.pixels[(z * field.width + x) * 4 + component]);
}

function assertSharedEdge(left, right) {
  for (let z = 0; z <= 64; z += 1) {
    for (let component = 0; component < 4; component += 1) {
      assert.equal(
        left.pixels[(z * left.width + 64) * 4 + component],
        right.pixels[(z * right.width) * 4 + component],
      );
    }
  }
}

test('shared water-field edges are bit-identical across chunks', () => {
  const left = createWaterField({
    originX: 0,
    originZ: 0,
    chunkSize: 64,
    sampleWater: (x, z) => model.sampleWater(x, z),
  });
  const right = createWaterField({
    originX: 64,
    originZ: 0,
    chunkSize: 64,
    sampleWater: (x, z) => model.sampleWater(x, z),
  });

  assertSharedEdge(left, right);
});

test('half-float field values agree with CPU samples within format tolerance', () => {
  const field = createWaterField({
    originX: 0,
    originZ: 0,
    chunkSize: 64,
    sampleWater: (x, z) => model.sampleWater(x, z),
  });
  const sample = model.sampleWater(23, 37);
  assert.ok(Math.abs(channel(field, 23, 37, 1) - sample.surfaceHeight) < 0.02);
  assert.ok(Math.abs(channel(field, 23, 37, 2) - sample.depth) < 0.02);
});

const riverSource = Object.freeze({
  atlas: Object.freeze({ width: 128, height: 64 }),
  bounds: Object.freeze({ minCellX: 0, minCellZ: 0, widthCells: 128, heightCells: 64 }),
  rivers: Object.freeze([Object.freeze({
    id: 11,
    widthAtlas: 10,
    points: Object.freeze([[8, 32], [120, 32]]),
  })]),
});

test('river surface and bed remain bit-identical at a chunk border', () => {
  const riverModel = new WaterTerrainModel({
    source: riverSource,
    seed: 12,
    seaLevel: 0,
    config,
    sampleBaseHeight: (x) => 40 - x * 0.08,
    sampleBaseTile: () => 4,
  });
  const left = createWaterField({
    originX: 0,
    originZ: 0,
    chunkSize: 64,
    sampleWater: (x, z) => riverModel.sampleWater(x, z),
  });
  const right = createWaterField({
    originX: 64,
    originZ: 0,
    chunkSize: 64,
    sampleWater: (x, z) => riverModel.sampleWater(x, z),
  });

  assertSharedEdge(left, right);
  assert.ok(riverModel.sampleWater(64, 32).depth > 0);
});
