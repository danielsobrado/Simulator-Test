import assert from 'node:assert/strict';
import test from 'node:test';
import { WATER_KIND_RIVER } from '../src/editor/water/WaterConstants.js';
import { resolveWaterDomainConfig } from '../src/editor/water/WaterConfig.js';
import { WaterTerrainModel } from '../src/editor/water/WaterTerrainModel.js';

const source = Object.freeze({
  atlas: Object.freeze({ width: 100, height: 100 }),
  bounds: Object.freeze({ minCellX: 0, minCellZ: 0, widthCells: 100, heightCells: 100 }),
  rivers: Object.freeze([Object.freeze({
    id: 7,
    widthAtlas: 8,
    points: Object.freeze([[10, 50], [90, 50]]),
  })]),
});

const config = resolveWaterDomainConfig({ cellSizeMeters: 2 });

function createModel() {
  return new WaterTerrainModel({
    source,
    seed: 5,
    seaLevel: 0,
    config,
    sampleBaseHeight: (x) => 30 - x * 0.1,
    sampleBaseTile: () => 4,
  });
}

test('river channels carve the authoritative terrain and descend continuously', () => {
  const model = createModel();
  const upstream = model.sampleWater(20, 50);
  const downstream = model.sampleWater(80, 50);

  assert.equal(upstream.kind, WATER_KIND_RIVER);
  assert.equal(downstream.kind, WATER_KIND_RIVER);
  assert.ok(upstream.depth >= config.river.minimumDepth);
  assert.ok(upstream.surfaceHeight > downstream.surfaceHeight);
  assert.ok(model.sampleHeight(50, 50) < 25);
  assert.equal(upstream.flowX > 0, true);
});

test('river banks blend back to untouched terrain', () => {
  const model = createModel();
  assert.equal(model.sampleWater(50, 60).coverage, 0);
  assert.equal(model.sampleHeight(50, 60), 25);
});
