import assert from 'node:assert/strict';
import test from 'node:test';
import { constructionRuinProfile } from '../src/editor/construction/config/ConstructionRuinConfig.generated.js';
import {
  createRuinDamageField,
  isProtectedFooting,
} from '../src/editor/construction/masonry/RuinDamageField.js';

const profile = constructionRuinProfile('default');

test('same seed and arc produce identical samples', () => {
  const field = createRuinDamageField({
    seed: 3141,
    profile,
    ruinFactorAt: () => 0.7,
  });
  assert.deepEqual(field.sampleAt(12.5, 3), field.sampleAt(12.5, 3));
});

test('module boundaries do not affect output', () => {
  const field = createRuinDamageField({
    seed: 3141,
    profile,
    ruinFactorAt: () => 0.55,
  });
  // Absolute arc only — no module index in the field.
  assert.deepEqual(field.sampleAt(11.9, 2), field.sampleAt(11.9, 2));
});

test('different seeds produce different clusters', () => {
  const a = createRuinDamageField({ seed: 1, profile, ruinFactorAt: () => 0.8 });
  const b = createRuinDamageField({ seed: 2, profile, ruinFactorAt: () => 0.8 });
  assert.notDeepEqual(a.sampleAt(10, 1).clusterScore, b.sampleAt(10, 1).clusterScore);
});

test('nearby samples are correlated more than distant ones', () => {
  const field = createRuinDamageField({
    seed: 99,
    profile,
    ruinFactorAt: () => 0.75,
  });
  let nearSum = 0;
  let farSum = 0;
  let count = 0;
  for (let base = 4; base < 20; base += 1.5) {
    const origin = field.sampleAt(base, 1).clusterScore;
    nearSum += Math.abs(origin - field.sampleAt(base + 0.3, 1).clusterScore);
    farSum += Math.abs(origin - field.sampleAt(base + 7, 1).clusterScore);
    count += 1;
  }
  assert.ok(nearSum / count < farSum / count);
});

test('cluster score stays in 0–1 and non-ruined is zero', () => {
  const field = createRuinDamageField({
    seed: 7,
    profile,
    ruinFactorAt: (s) => (s > 0 ? 0.6 : 0),
  });
  const sample = field.sampleAt(5, 0);
  assert.ok(sample.clusterScore >= 0 && sample.clusterScore <= 1);
  const intact = createRuinDamageField({
    seed: 7,
    profile,
    ruinFactorAt: () => 0,
  });
  assert.equal(intact.sampleAt(5, 0).clusterScore, 0);
});

test('protected footing never becomes preliminary removal', () => {
  const field = createRuinDamageField({
    seed: 3141,
    profile,
    ruinFactorAt: () => 1,
  });
  const result = field.evaluateStone({
    s: 8,
    courseIndex: 0,
    stableIndex: 12,
    yTop: 0.2,
    collapsedTop: 0.5,
    protectedFooting: true,
  });
  assert.equal(result.remove, false);
  assert.equal(isProtectedFooting({
    support: { courseIndex: 0, top: 0.2 },
  }, profile), true);
});

test('stone noise does not dominate broad damage', () => {
  const field = createRuinDamageField({
    seed: 42,
    profile,
    ruinFactorAt: () => 0.7,
  });
  const scores = [];
  for (let index = 0; index < 40; index += 1) {
    scores.push(field.evaluateStone({
      s: 12,
      courseIndex: 4,
      stableIndex: index,
      yTop: 2.8,
      collapsedTop: 2.9,
      protectedFooting: false,
    }).score);
  }
  const spread = Math.max(...scores) - Math.min(...scores);
  assert.ok(spread < 0.2, `stone noise spread too large: ${spread}`);
});
