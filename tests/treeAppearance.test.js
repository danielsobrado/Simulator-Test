import assert from 'node:assert/strict';
import test from 'node:test';
import {
  treeBaseSeed,
  treeMorphology,
  treeRenderSeed,
} from '../src/editor/stylized/forest/TreeAppearance.js';

test('tree morphology separates horizontal crown, vertical crown, and trunk scales', () => {
  assert.deepEqual(treeMorphology({
    crownScale: 0.8,
    crownAspect: 0.5,
    trunkScale: 1.2,
  }), [0.4, 0.8, 1.2]);
});

test('tree render seed prefers the ecological wind seed across every LOD', () => {
  const placement = { priority: 0.2, index: 17, windSeed: 0.75 };
  assert.equal(treeRenderSeed(placement), 0.75);
  assert.equal(treeBaseSeed(placement), 0.2);
});

test('tree render seed falls back deterministically when wind metadata is absent', () => {
  const placement = { index: 17 };
  assert.equal(treeRenderSeed(placement), treeBaseSeed(placement));
  assert.equal(treeRenderSeed(placement), treeRenderSeed({ index: 17 }));
});
