import assert from 'node:assert/strict';
import test from 'node:test';
import { constructionStoneEdgeWearProfile } from '../src/editor/construction/config/ConstructionStoneEdgeWearProfiles.generated.js';
import {
  correlatedVariation,
  sampleStoneEdgeWear,
} from '../src/editor/construction/masonry/StoneEdgeWearField.js';

const soft = constructionStoneEdgeWearProfile('soft-limestone-rubble');

function sample(overrides = {}) {
  return sampleStoneEdgeWear({
    profile: soft,
    seed: 3141,
    stableIndex: 17,
    category: 'field',
    side: 'front',
    width: 0.55,
    height: 0.32,
    depth: 0.8,
    mortarFaceRecess: 0.035,
    ...overrides,
  });
}

test('same seed and stable index produce identical results', () => {
  assert.deepEqual(sample(), sample());
});

test('different indices produce controlled variation', () => {
  assert.notDeepEqual(sample({ stableIndex: 17 }), sample({ stableIndex: 18 }));
});

test('front and rear differ but remain within range', () => {
  const front = sample({ side: 'front' });
  const back = sample({ side: 'back' });
  assert.equal(front.enabled, true);
  assert.equal(back.enabled, true);
  assert.notDeepEqual(front.cornerWidth, back.cornerWidth);
  for (const value of [...front.cornerWidth, ...back.cornerWidth]) {
    assert.ok(value <= soft.bevel.absoluteMaximum + 1e-9);
    assert.ok(value >= soft.bevel.absoluteMinimum * 0.4);
  }
});

test('adjacent corners remain correlated', () => {
  const shared = 0.4;
  const localA = -0.8;
  const localB = 0.9;
  const corr = soft.cornerVariation.correlation;
  const a = correlatedVariation({ shared, local: localA, correlation: corr });
  const b = correlatedVariation({ shared, local: localB, correlation: corr });
  assert.ok(Math.abs(a - b) < Math.abs(localA - localB));
});

test('top corners have larger mean width than bottom across a fixture set', () => {
  let top = 0;
  let bottom = 0;
  for (let index = 0; index < 48; index += 1) {
    const wear = sample({ stableIndex: index });
    bottom += wear.cornerWidth[0] + wear.cornerWidth[1];
    top += wear.cornerWidth[2] + wear.cornerWidth[3];
  }
  assert.ok(top > bottom);
});

test('depths stay within mortar and depth limits', () => {
  const wear = sample({ mortarFaceRecess: 0.02, depth: 0.4 });
  const mortarLimit = 0.02 * soft.safeguards.maximumMortarFraction;
  const depthLimit = 0.4 * soft.safeguards.maximumDepthFraction;
  for (const value of wear.cornerDepth) {
    assert.ok(value <= Math.min(mortarLimit, depthLimit) + 1e-9);
  }
});

test('category scale zero disables the effect', () => {
  assert.equal(sample({ category: 'recess' }).enabled, false);
});

test('flattening chance remains deterministic', () => {
  assert.deepEqual(sample().cornerFlattening, sample().cornerFlattening);
});

test('no NaN or infinite values and objects are immutable', () => {
  const wear = sample();
  assert.equal(Object.isFrozen(wear), true);
  assert.equal(Object.isFrozen(wear.cornerWidth), true);
  for (const key of ['cornerWidth', 'cornerDepth', 'edgeMidpointScale', 'cornerFlattening']) {
    for (const value of wear[key]) assert.ok(Number.isFinite(value));
  }
});

test('very small stones are rejected', () => {
  assert.equal(sample({ width: 0.2 }).enabled, false);
  assert.equal(sample({ depth: 0.1 }).enabled, false);
});
