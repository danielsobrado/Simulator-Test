import assert from 'node:assert/strict';
import test from 'node:test';
import { constructionStoneReliefProfile } from '../src/editor/construction/config/ConstructionStoneReliefProfiles.generated.js';
import {
  faceRecessionAt,
  sampleStoneFaceRelief,
} from '../src/editor/construction/masonry/StoneFaceReliefField.js';

const soft = constructionStoneReliefProfile('soft-limestone-rubble');
const defaults = constructionStoneReliefProfile('default');

function sample(overrides = {}) {
  return sampleStoneFaceRelief({
    profile: soft,
    seed: 3141,
    stableIndex: 17,
    category: 'field',
    side: 'front',
    width: 0.55,
    height: 0.32,
    bevelRadius: 0.05,
    mortarFaceRecess: 0.035,
    ...overrides,
  });
}

test('same seed and stable index produce identical results', () => {
  assert.deepEqual(sample(), sample());
});

test('front and back are deterministic but not identical', () => {
  const front = sample({ side: 'front' });
  const back = sample({ side: 'back' });
  assert.equal(front.enabled, true);
  assert.equal(back.enabled, true);
  assert.notDeepEqual(front, back);
  assert.deepEqual(sample({ side: 'back' }), back);
});

test('different stable indices produce variation', () => {
  assert.notDeepEqual(sample({ stableIndex: 17 }), sample({ stableIndex: 18 }));
});

test('values remain inside configured ranges', () => {
  for (let index = 0; index < 64; index += 1) {
    const relief = sample({ stableIndex: index });
    assert.equal(relief.enabled, true);
    assert.ok(relief.edgeRecession >= soft.recession.minimum - 1e-12);
    assert.ok(relief.edgeRecession <= soft.recession.maximum + 1e-12);
    assert.ok(Math.abs(relief.tiltU) <= soft.asymmetry + 1e-12);
    assert.ok(Math.abs(relief.tiltV) <= soft.asymmetry + 1e-12);
    assert.ok(Math.abs(relief.saddle) <= soft.saddleStrength + 1e-12);
    assert.equal(relief.columns, soft.grid.columns);
    assert.equal(relief.rows, soft.grid.rows);
  }
});

test('structural category scale zero disables relief', () => {
  for (const category of ['coping', 'ashlar', 'quoin', 'voussoir', 'merlon', 'recess']) {
    assert.equal(sample({ category }).enabled, false);
  }
});

test('small stones disable relief', () => {
  assert.equal(sample({ width: 0.2, height: 0.32 }).enabled, false);
  assert.equal(sample({ width: 0.55, height: 0.1 }).enabled, false);
});

test('recession never exceeds bevel clamp', () => {
  const relief = sample({ bevelRadius: 0.01 });
  assert.equal(relief.enabled, true);
  assert.ok(relief.edgeRecession <= 0.01 * soft.maximumBevelFraction + 1e-12);
  assert.equal(relief.clampedByBevel, true);
});

test('recession never exceeds mortar clamp', () => {
  const relief = sample({ mortarFaceRecess: 0.01, bevelRadius: 0.08 });
  assert.equal(relief.enabled, true);
  assert.ok(relief.edgeRecession <= 0.01 * soft.maximumMortarRecessFraction + 1e-12);
  assert.equal(relief.clampedByMortar, true);
});

test('invalid configuration is rejected', () => {
  assert.throws(() => sample({ profile: null }), /profile is required/);
  assert.throws(() => sample({ side: 'sideways' }), /front" or "back/);
  assert.throws(() => sample({
    profile: {
      ...soft,
      recession: { ...soft.recession, ratioMax: 0.01, ratioMin: 0.02 },
    },
  }), /invalid recession ratios/);
});

test('faceRecessionAt returns full recession at every boundary', () => {
  const relief = sample();
  for (const u of [0, 0.25, 0.5, 0.75, 1]) {
    assert.ok(Math.abs(faceRecessionAt(relief, u, 0) - relief.edgeRecession) < 1e-12);
    assert.ok(Math.abs(faceRecessionAt(relief, u, 1) - relief.edgeRecession) < 1e-12);
  }
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    assert.ok(Math.abs(faceRecessionAt(relief, 0, v) - relief.edgeRecession) < 1e-12);
    assert.ok(Math.abs(faceRecessionAt(relief, 1, v) - relief.edgeRecession) < 1e-12);
  }
});

test('faceRecessionAt approaches zero near the centre', () => {
  const relief = sample();
  const centre = faceRecessionAt(relief, 0.5, 0.5);
  assert.ok(centre < relief.edgeRecession * 0.15);
  assert.ok(centre >= 0);
});

test('no sampled value is NaN or infinite', () => {
  for (let index = 0; index < 32; index += 1) {
    const relief = sample({ stableIndex: index, side: index % 2 === 0 ? 'front' : 'back' });
    for (const key of ['edgeRecession', 'tiltU', 'tiltV', 'saddle', 'edgeFalloffPower']) {
      assert.ok(Number.isFinite(relief[key]), `${key} must be finite`);
    }
    for (let u = 0; u <= 1; u += 0.25) {
      for (let v = 0; v <= 1; v += 0.25) {
        const value = faceRecessionAt(relief, u, v);
        assert.ok(Number.isFinite(value));
        assert.ok(value >= -1e-12);
        assert.ok(value <= relief.edgeRecession + 1e-12);
      }
    }
  }
});

test('disabled default profile never enables relief', () => {
  assert.equal(sample({ profile: defaults }).enabled, false);
});
