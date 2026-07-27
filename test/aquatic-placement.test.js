import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AQUATIC_PLACEMENT_ROOTED,
  AQUATIC_PLACEMENT_SURFACE,
  evaluateAquaticPlacement,
} from '../src/editor/water/AquaticPlacement.js';

const river = Object.freeze({
  kind: 3,
  bodyId: 77,
  coverage: 1,
  surfaceHeight: 12,
  bedHeight: 9,
  depth: 3,
  shoreDistance: 4,
  flowX: 1,
  flowZ: 0,
});

const calmLake = Object.freeze({
  ...river,
  kind: 2,
  bodyId: 12,
  flowX: 0,
  depth: 1.4,
  bedHeight: 10.6,
});

test('rooted plants use the authoritative bed height', () => {
  const placement = evaluateAquaticPlacement({
    waterSample: river,
    layerRule: {
      placement: AQUATIC_PLACEMENT_ROOTED,
      minimumDepth: 0.2,
      maximumDepth: 4,
      maximumShoreDistance: 8,
      maximumCurrent: 1,
    },
  });
  assert.equal(placement.waterPlacementHeight, river.bedHeight);
  assert.equal(placement.waterBodyId, river.bodyId);
});

test('surface plants use body level and reject strong currents', () => {
  const rule = {
    placement: AQUATIC_PLACEMENT_SURFACE,
    minimumDepth: 0.2,
    maximumDepth: 2,
    maximumShoreDistance: 12,
    maximumCurrent: 0.1,
    allowedKinds: [1, 2],
  };
  assert.equal(evaluateAquaticPlacement({ waterSample: river, prototypeRule: rule }), null);
  const placement = evaluateAquaticPlacement({ waterSample: calmLake, prototypeRule: rule });
  assert.equal(placement.waterPlacementHeight, calmLake.surfaceHeight);
  assert.equal(placement.waterPlacement, AQUATIC_PLACEMENT_SURFACE);
});

test('aquatic placement rejects dry, too-deep, and offshore candidates', () => {
  const rule = { maximumDepth: 2, maximumShoreDistance: 6 };
  assert.equal(evaluateAquaticPlacement({ waterSample: { ...river, kind: 0 }, layerRule: rule }), null);
  assert.equal(evaluateAquaticPlacement({ waterSample: river, layerRule: rule }), null);
  assert.equal(evaluateAquaticPlacement({
    waterSample: { ...calmLake, shoreDistance: 20 },
    layerRule: rule,
  }), null);
});
