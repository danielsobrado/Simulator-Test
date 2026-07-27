import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createWaterField,
  enrichPageWaterField,
  halfToFloat,
} from '../src/editor/water/WaterField.js';
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

function surfaceHeight(field, x, z) {
  return field.surfaceOrigin + channel(field, x, z, 1);
}

function assertSharedEdge(left, right) {
  for (let z = 0; z <= 64; z += 1) {
    for (const component of [0, 2, 3]) {
      assert.equal(
        left.pixels[(z * left.width + 64) * 4 + component],
        right.pixels[(z * right.width) * 4 + component],
      );
    }
    assert.ok(Math.abs(surfaceHeight(left, 64, z) - surfaceHeight(right, 0, z)) < 0.02);
  }
}

test('shared water-field edges remain semantically identical across chunks', () => {
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

test('relative half-float surfaces preserve high-elevation precision', () => {
  const expectedSurface = 2300.123;
  const field = createWaterField({
    originX: 0,
    originZ: 0,
    chunkSize: 1,
    sampleWater: () => ({
      coverage: 1,
      surfaceHeight: expectedSurface,
      depth: 3,
      shoreDistance: 2,
    }),
  });

  assert.ok(Math.abs(surfaceHeight(field, 0, 0) - expectedSurface) < 0.01);
});

test('dry shoreline vertices inherit a neighbouring water surface', () => {
  const field = createWaterField({
    originX: 0,
    originZ: 0,
    chunkSize: 1,
    sampleWater: (x, z) => (
      x === 0 && z === 0
        ? { coverage: 1, surfaceHeight: 18, depth: 4, shoreDistance: 1 }
        : { coverage: 0, surfaceHeight: -6, depth: 0, shoreDistance: 0 }
    ),
  });

  assert.equal(surfaceHeight(field, 1, 0), 18);
  assert.equal(surfaceHeight(field, 0, 1), 18);
  assert.equal(surfaceHeight(field, 1, 1), 18);
});


test('dry shoreline depth follows inherited surface and local bed', () => {
  const field = createWaterField({
    originX: 0,
    originZ: 0,
    chunkSize: 1,
    sampleWater: (x, z) => (
      x === 0 && z === 0
        ? { coverage: 1, surfaceHeight: 8, bedHeight: 4, depth: 4, shoreDistance: 1 }
        : { coverage: 0, surfaceHeight: 2, bedHeight: 5, depth: 0, shoreDistance: 0 }
    ),
  });

  assert.equal(channel(field, 1, 0, 2), 3);
});

test('page dimensions must agree before generating a field', () => {
  const page = {
    originX: 0,
    originZ: 0,
    tiles: new Uint8Array(4),
    heights: new Float32Array(16),
  };
  assert.throws(
    () => enrichPageWaterField(page, () => ({
      coverage: 0,
      surfaceHeight: 0,
      bedHeight: 0,
      depth: 0,
      shoreDistance: 0,
    })),
    /dimensions disagree/,
  );
});

test('water-field revision changes after live regeneration', () => {
  const page = {
    originX: 0,
    originZ: 0,
    tiles: new Uint8Array(1),
    heights: new Float32Array(4),
  };
  const sampleWater = () => ({
    coverage: 1,
    surfaceHeight: 0,
    depth: 1,
    shoreDistance: 1,
  });

  enrichPageWaterField(page, sampleWater);
  assert.equal(page.waterFieldRevision, 1);
  enrichPageWaterField(page, sampleWater);
  assert.equal(page.waterFieldRevision, 2);
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

test('river surface and bed remain continuous at a chunk border', () => {
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
