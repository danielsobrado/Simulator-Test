import assert from 'node:assert/strict';
import test from 'node:test';
import {
  insetRing,
  insetRingVariable,
  variableInsetSurvived,
} from '../src/editor/workshop/ProceduralWorkshopGeometry.js';

function rectangle(width, height) {
  return [
    [-width / 2, -height / 2],
    [width / 2, -height / 2],
    [width / 2, height / 2],
    [-width / 2, height / 2],
  ];
}

const safeguards = {
  minimumFaceAreaRatio: 0.58,
  minimumEdgeLength: 0.06,
  maximumInsetEdgeRatio: 0.28,
};

test('uniform variable inset matches classic insetRing', () => {
  const ring = rectangle(1.2, 0.56);
  const classic = insetRing(ring, 0.04);
  const variable = insetRingVariable(ring, [0.04, 0.04, 0.04, 0.04]);
  assert.equal(classic.length, variable.length);
  for (let index = 0; index < classic.length; index += 1) {
    assert.ok(Math.abs(classic[index][0] - variable[index][0]) < 1e-9);
    assert.ok(Math.abs(classic[index][1] - variable[index][1]) < 1e-9);
  }
});

test('variable inset stays inside rectangle with strong but valid variation', () => {
  const ring = rectangle(1.0, 0.5);
  const inset = insetRingVariable(ring, [0.04, 0.055, 0.045, 0.035]);
  const check = variableInsetSurvived(ring, inset, safeguards);
  assert.equal(check.valid, true);
  assert.ok(check.areaRatio >= safeguards.minimumFaceAreaRatio);
});

test('sloped and leaning quads survive mild variable inset', () => {
  const sloped = [[-0.4, -0.2], [0.42, -0.18], [0.38, 0.22], [-0.36, 0.2]];
  const leaning = [[-0.5, -0.22], [0.48, -0.28], [0.52, 0.24], [-0.46, 0.3]];
  for (const ring of [sloped, leaning]) {
    const inset = insetRingVariable(ring, [0.03, 0.035, 0.032, 0.028]);
    const check = variableInsetSurvived(ring, inset, safeguards);
    assert.equal(check.valid, true, check.reason);
  }
});

test('very narrow stone fails minimum edge / area safeguards', () => {
  const ring = rectangle(0.8, 0.08);
  const inset = insetRingVariable(ring, [0.03, 0.03, 0.03, 0.03]);
  const check = variableInsetSurvived(ring, inset, safeguards);
  assert.equal(check.valid, false);
});

test('over-aggressive inset is rejected', () => {
  const ring = rectangle(0.6, 0.3);
  const inset = insetRingVariable(ring, [0.12, 0.12, 0.12, 0.12]);
  const check = variableInsetSurvived(ring, inset, safeguards);
  assert.equal(check.valid, false);
});

test('deterministic result', () => {
  const ring = rectangle(0.9, 0.4);
  const a = insetRingVariable(ring, [0.04, 0.05, 0.045, 0.035]);
  const b = insetRingVariable(ring, [0.04, 0.05, 0.045, 0.035]);
  assert.deepEqual(a, b);
});
