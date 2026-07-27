import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveWaterDomainConfig } from '../src/editor/water/WaterConfig.js';
import { WaterTerrainModel } from '../src/editor/water/WaterTerrainModel.js';

const config = resolveWaterDomainConfig({
  cellSizeMeters: 1,
  shoreDistanceMeters: 48,
});

function createModel() {
  return new WaterTerrainModel({
    seed: 17,
    seaLevel: 0,
    config,
    sampleBaseHeight: (x) => (x < 0 ? 3 : -2 - Math.sin(x / 7)),
    sampleBaseTile: (x) => (x < 0 ? 4 : 0),
  });
}

test('ocean bathymetry preserves coastline classification and deepens offshore', () => {
  const model = createModel();
  const shore = model.sampleWater(0, 0);
  const shelf = model.sampleWater(16, 0);
  const deep = model.sampleWater(48, 0);

  assert.equal(model.sampleWater(-1, 0).coverage, 0);
  assert.equal(shore.coverage, 1);
  assert.ok(shelf.depth > shore.depth);
  assert.ok(deep.depth > shelf.depth);
  assert.ok(deep.depth <= config.ocean.maximumDepth);
});

test('ocean bed samples are deterministic', () => {
  const model = createModel();
  assert.equal(model.sampleHeight(28.25, -7.5), model.sampleHeight(28.25, -7.5));
});
