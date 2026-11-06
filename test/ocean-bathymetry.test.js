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
  let previousSlope = null;
  for (let distance = 0.25; distance <= config.shoreDistanceMeters; distance += 0.25) {
    const current = oceanDepthProfile(distance, {
      ...config.ocean,
      shoreDistanceMeters: config.shoreDistanceMeters,
    });
    const slope = (current - previous) / 0.25;
    assert.ok(slope <= config.ocean.maximumBedSlope + 1e-9);
    // No kink at the shelf break: it drew a hard dark contour round every pool.
    if (previousSlope !== null) assert.ok(Math.abs(slope - previousSlope) < 0.05, `slope jumps at ${distance} m`);
    previous = current;
    previousSlope = slope;
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

test('low land by the sea rises into a beach, higher ground is untouched', () => {
  const low = new WaterTerrainModel({
    seed: 17,
    seaLevel: 0,
    config,
    // Flat coastal plain lying right at sea level.
    sampleBaseHeight: (x) => (x < 0 ? 0 : -3),
    sampleBaseTile: (x) => (x < 0 ? 4 : 0),
  });
  const { beachHeight, beachWidthMeters } = config.ocean;
  assert.equal(low.sampleHeight(0, 0), -3, 'the shoreline vertex keeps its base height');
  const near = low.sampleHeight(-3, 0);
  const mid = low.sampleHeight(-15, 0);
  const far = low.sampleHeight(-(beachWidthMeters + 5), 0);
  assert.ok(near > 0 && near < mid && mid < far, 'the beach rises away from the sea');
  assert.ok(Math.abs(far - beachHeight) < 1e-9);
  // Ground already above the berm keeps its own height.
  assert.equal(createModel().sampleHeight(-10, 0), 3);
});

test('the bed eases away from the shore instead of stepping along the first ring of cells', () => {
  // A flat coastal plain just under the sea. A full-depth carve one cell out
  // made every depth contour run along that ring: square teeth round each pool.
  const flat = new WaterTerrainModel({
    seed: 17,
    seaLevel: 0,
    config,
    sampleBaseHeight: (x) => (x < 0 ? 0.2 : -0.05),
    sampleBaseTile: (x) => (x < 0 ? 4 : 0),
  });
  const shelf = (x) => oceanDepthProfile(flat.oceanDistance.sample(x, 0), { ...config.ocean, shoreDistanceMeters: config.shoreDistanceMeters });
  const oneOut = -flat.sampleHeight(1, 0);
  assert.ok(oneOut - 0.05 < (shelf(1) - 0.05) * 0.5, `bed one cell out is ${oneOut} m deep, shelf ${shelf(1)} m`);
  let previous = oneOut;
  for (let x = 2; x <= 40; x += 1) {
    const depth = -flat.sampleHeight(x, 0);
    assert.ok(depth >= previous - 1e-9, `bed rises at ${x}`);
    previous = depth;
  }
  assert.ok(-flat.sampleHeight(40, 0) > 10, 'still deep offshore');
});
