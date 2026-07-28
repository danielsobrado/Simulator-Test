import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONSTRUCTION_STYLES,
  constructionStyle,
  defineConstructionStyle,
} from '../src/editor/construction/masonry/ConstructionStyleCatalog.js';

test('existing styles keep their authored values and packer defaults', () => {
  const coursed = constructionStyle('coursed-rubble');
  assert.equal(coursed.courseHeight, 0.56);
  assert.equal(coursed.targetWidth, 1.2);
  assert.equal(coursed.minWidth, 0.26);
  assert.equal(coursed.irregularity, 0.45);
  assert.equal(coursed.bedAmplitude, 0.14);
  assert.equal(coursed.jointTilt, 0.16);
  assert.equal(coursed.splitChance, 0.42);
  assert.equal(coursed.splitMaxDepth, 2);
  assert.equal(coursed.jointInsetMin, 0.012);
  assert.equal(coursed.jointInsetMax, 0.03);
  assert.equal(coursed.jointInsetVerticalRatio, 0.7);
  assert.equal(coursed.depthScaleMin, 0.95);
  assert.equal(coursed.depthScaleMax, 0.985);
  assert.equal(coursed.faceOffsetAmplitude, 0.009);
  assert.equal(coursed.stonePalette, 'limestone');
});

test('all descriptors are frozen', () => {
  assert.equal(Object.isFrozen(CONSTRUCTION_STYLES), true);
  for (const style of Object.values(CONSTRUCTION_STYLES)) {
    assert.equal(Object.isFrozen(style), true);
  }
});

test('catalogue keys are unique and match descriptor keys', () => {
  const keys = Object.values(CONSTRUCTION_STYLES).map(({ key }) => key);
  assert.equal(new Set(keys).size, keys.length);
  for (const [mapKey, descriptor] of Object.entries(CONSTRUCTION_STYLES)) {
    assert.equal(mapKey, descriptor.key);
  }
});

test('invalid definitions fail immediately', () => {
  const base = {
    key: 'test-style',
    label: 'Test',
    courseHeight: 0.5,
    targetWidth: 1,
    minWidth: 0.2,
    irregularity: 0.4,
    detail: 2,
    merlonSpacing: 1,
    stonePalette: 'limestone',
    bedAmplitude: 0.1,
    jointTilt: 0.1,
    splitChance: 0.4,
  };

  assert.throws(
    () => defineConstructionStyle({ ...base, courseHeight: -1 }),
    /courseHeight/,
  );
  assert.throws(
    () => defineConstructionStyle({ ...base, minWidth: 1.5 }),
    /minWidth must be below targetWidth/,
  );
  assert.throws(
    () => defineConstructionStyle({ ...base, splitMaxDepth: 3 }),
    /splitMaxDepth/,
  );
  assert.throws(
    () => defineConstructionStyle({
      ...base,
      jointInsetMin: 0.04,
      jointInsetMax: 0.02,
    }),
    /joint inset range is reversed/,
  );
  assert.throws(
    () => defineConstructionStyle({
      ...base,
      depthScaleMin: 1.0,
      depthScaleMax: 0.9,
    }),
    /depth scale range is reversed/,
  );
  assert.throws(
    () => defineConstructionStyle({ ...base, stonePalette: 'obsidian' }),
    /unknown stone palette/,
  );
  assert.throws(
    () => defineConstructionStyle({ ...base, detail: 2.5 }),
    /detail must be an integer/,
  );
  assert.throws(
    () => defineConstructionStyle({ ...base, splitMaxDepth: 1.5 }),
    /splitMaxDepth must be an integer/,
  );
});
