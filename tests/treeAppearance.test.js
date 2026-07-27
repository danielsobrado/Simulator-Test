import assert from 'node:assert/strict';
import test from 'node:test';
import {
  treeBaseSeed,
  treeColorVariation,
  treeLeanAngles,
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

test('tree morphology thins crowns with foliage density', () => {
  const [horizontal, vertical, trunk] = treeMorphology({
    crownScale: 1,
    crownAspect: 1,
    trunkScale: 1,
    foliageDensity: 0.64,
  });
  assert.equal(trunk, 1);
  assert.ok(Math.abs(horizontal - 0.8) < 1e-12);
  assert.ok(Math.abs(vertical - 0.64) < 1e-12);
});

test('tree lean angles follow leanX/leanZ and branch droop', () => {
  const lean = treeLeanAngles({ leanX: 0.1, leanZ: -0.05, branchDroop: 0.2 });
  assert.ok(lean.rotationZ < 0);
  assert.ok(lean.rotationX < 0);
});

test('tree render seed prefers the ecological wind seed across every LOD', () => {
  const placement = { priority: 0.2, index: 17, windSeed: 0.75 };
  assert.equal(treeRenderSeed(placement), 0.75);
  assert.equal(treeBaseSeed(placement), 0.2);
});

test('tree colour variation derives from the shared render seed', () => {
  const placement = { windSeed: 0.75, colorSeed: 0.1 };
  assert.ok(Math.abs(treeColorVariation(placement) - 1.05) < 1e-12);
});

test('tree render seed falls back deterministically when wind metadata is absent', () => {
  const placement = { index: 17 };
  assert.equal(treeRenderSeed(placement), treeBaseSeed(placement));
  assert.equal(treeRenderSeed(placement), treeRenderSeed({ index: 17 }));
});
