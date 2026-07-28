import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bandWithHysteresis,
  canStartTransition,
  evaluateBuildRequest,
  isStaleBuildResult,
  lodDitherVisible,
  moduleBuildKey,
  resolveRequestedLodBand,
  shouldAcceptBandChange,
} from '../src/editor/construction/compile/ConstructionLodState.js';
import { selectDominantPlacement } from '../src/editor/construction/render/ConstructionLod.js';

test('hysteresis holds near past the nominal boundary', () => {
  assert.equal(bandWithHysteresis({
    currentBand: 'near',
    distance: 81,
    nearDistance: 80,
    shellDistance: 200,
    hysteresis: 8,
  }), 'near');
  assert.equal(bandWithHysteresis({
    currentBand: 'near',
    distance: 89,
    nearDistance: 80,
    shellDistance: 200,
    hysteresis: 8,
  }), 'coarse');
});

test('hysteresis holds coarse until inside near - hysteresis', () => {
  assert.equal(bandWithHysteresis({
    currentBand: 'coarse',
    distance: 79,
    nearDistance: 80,
    shellDistance: 200,
    hysteresis: 8,
  }), 'coarse');
  assert.equal(bandWithHysteresis({
    currentBand: 'coarse',
    distance: 71,
    nearDistance: 80,
    shellDistance: 200,
    hysteresis: 8,
  }), 'near');
});

test('residence time delays band change', () => {
  assert.equal(shouldAcceptBandChange({
    resident: { visibleBand: 'near', visibleSince: 1000 },
    requestedBand: 'coarse',
    now: 1200,
    minimumResidenceMs: 650,
  }), false);
  assert.equal(shouldAcceptBandChange({
    resident: { visibleBand: 'near', visibleSince: 1000 },
    requestedBand: 'coarse',
    now: 1700,
    minimumResidenceMs: 650,
  }), true);
});

test('selection forces near via resolveRequestedLodBand', () => {
  assert.equal(resolveRequestedLodBand({
    pixels: 10,
    previousVisible: 'coarse',
    pinned: true,
    now: 5000,
    visibleSince: 0,
    styleKey: 'soft-limestone-rubble',
  }), 'near');
});

test('duplicate build requests are suppressed', () => {
  const key = moduleBuildKey({
    constructionId: 'c1',
    revision: 2,
    moduleId: 'm1',
    contentHash: 'abc',
    requestedBand: 'coarse',
  });
  assert.deepEqual(
    evaluateBuildRequest({ resident: { pendingBuildKey: key }, buildKey: key }),
    { enqueue: false, reason: 'duplicate' },
  );
});

test('stale build results are discarded', () => {
  assert.equal(isStaleBuildResult({
    buildKey: 'a',
    expectedKey: 'b',
    moduleExists: true,
  }), true);
  assert.equal(isStaleBuildResult({
    buildKey: 'a',
    expectedKey: 'a',
    moduleExists: false,
  }), true);
});

test('transition cap respects maximumConcurrentModules', () => {
  assert.equal(canStartTransition({ activeCount: 2, maximumConcurrentModules: 3 }), true);
  assert.equal(canStartTransition({ activeCount: 3, maximumConcurrentModules: 3 }), false);
});

test('dither fade endpoints and stable seeds', () => {
  assert.equal(lodDitherVisible({
    fade: 0, fadeDirection: 1, x: 0, y: 0, seed: 1,
  }), false);
  assert.equal(lodDitherVisible({
    fade: 1, fadeDirection: 1, x: 0, y: 0, seed: 1,
  }), true);
  assert.equal(lodDitherVisible({
    fade: 0, fadeDirection: -1, x: 0, y: 0, seed: 1,
  }), true);
  assert.equal(lodDitherVisible({
    fade: 1, fadeDirection: -1, x: 0, y: 0, seed: 1,
  }), false);
  const a = lodDitherVisible({ fade: 0.5, fadeDirection: 1, x: 1, y: 2, seed: 1 });
  const b = lodDitherVisible({ fade: 0.5, fadeDirection: 1, x: 1, y: 2, seed: 1 });
  assert.equal(a, b);
  const pattern = (seed) => Array.from({ length: 16 }, (_, index) => (
    lodDitherVisible({
      fade: 0.4,
      fadeDirection: 1,
      x: index % 4,
      y: Math.floor(index / 4),
      seed,
    })
  ));
  assert.notDeepEqual(pattern(1), pattern(0x12345));
});

test('dominant placement: largest leaf wins, ties use lowest stableIndex', () => {
  const leaves = [
    { stableIndex: 9, width: 0.4, height: 0.3 },
    { stableIndex: 2, width: 0.5, height: 0.4 },
    { stableIndex: 7, width: 0.5, height: 0.4 },
  ];
  assert.equal(selectDominantPlacement(leaves).stableIndex, 2);
  assert.equal(
    selectDominantPlacement([...leaves].reverse()).stableIndex,
    2,
  );
});
