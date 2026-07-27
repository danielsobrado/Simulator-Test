import assert from 'node:assert/strict';
import test from 'node:test';
import { oceanDepthProfile } from '../src/editor/water/OceanBathymetry.js';
import { resolveWaterDomainConfig } from '../src/editor/water/WaterConfig.js';
import { WaterTerrainModel } from '../src/editor/water/WaterTerrainModel.js';

const config = resolveWaterDomainConfig({
  cellSizeMeters: 1,
  shoreDistanceMeters: 48,
});

function baseHeight(x) {
  return x < 0 ? 3 : -2 - Math.sin(x / 7);
}

function createModel() {
  return new WaterTerrainModel({
    seed: 17,
    seaLevel: 0,
    config,
    sampleBaseHeight: baseHeight,
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
  assert.equal(oceanDepthProfile(config.shoreDistanceMeters, {
    ...config.ocean,
    shoreDistanceMeters: config.shoreDistanceMeters,
  }), config.ocean.maximumDepth);

  let previous = oceanDepthProfile(0, {
    ...config.ocean,
    shoreDistanceMeters: config.shoreDistanceMeters,
  });
  for (let distance = 0.25; distance <= config.shoreDistanceMeters; distance += 0.25) {
    const current = oceanDepthProfile(distance, {
      ...config.ocean,
      shoreDistanceMeters: config.shoreDistanceMeters,
    });
    assert.ok((current - previous) / 0.25 <= config.ocean.maximumBedSlope + 1e-9);
    previous = current;
  }
});

test('coastline vertices are not moved by one-sided ocean classification', () => {
  const model = createModel();
  assert.equal(model.sampleHeight(0, 0), baseHeight(0));
});

test('fractional terrain samples match the authoritative vertex heightfield', () => {
  const model = createModel();
  const expected = (
    model.sampleHeight(28, -8)
    + model.sampleHeight(29, -8)
    + model.sampleHeight(28, -7)
    + model.sampleHeight(29, -7)
  ) * 0.25;
  assert.equal(model.sampleHeight(28.5, -7.5), expected);
});

test('ocean bed samples are deterministic', () => {
  const model = createModel();
  assert.equal(model.sampleHeight(28.25, -7.5), model.sampleHeight(28.25, -7.5));
});
