import assert from 'node:assert/strict';
import test from 'node:test';
import { createObjectRenderCatalog } from '../src/editor/objectAssetSchema.js';

const placementCatalog = Object.freeze([
  Object.freeze({
    key: 'cottage',
    label: 'Cottage',
    model: 'cottage',
    footprint: Object.freeze({ width: 2, depth: 2 }),
  }),
]);

function definition(overrides = {}) {
  return {
    key: 'cottage',
    asset: {
      path: '/assets/models/settlement-core.glb',
      node: 'cottage',
      scale: 1,
      rotationY: 90,
      offset: [0, 0.1, 0],
    },
    ...overrides,
  };
}

test('render asset metadata is normalized without changing placement data', () => {
  const [entry] = createObjectRenderCatalog([definition()], placementCatalog);

  assert.equal(entry.footprint, placementCatalog[0].footprint);
  assert.deepEqual(entry.asset, {
    path: 'assets/models/settlement-core.glb',
    node: 'cottage',
    scale: 1,
    rotationY: 90,
    offset: [0, 0.1, 0],
  });
  assert.ok(Object.isFrozen(entry.asset));
  assert.ok(Object.isFrozen(entry.asset.offset));
});

test('objects without a GLB asset render procedurally and are skipped', () => {
  assert.deepEqual(createObjectRenderCatalog([definition({ asset: undefined })], placementCatalog), []);
  assert.deepEqual(createObjectRenderCatalog([definition({ asset: null })], placementCatalog), []);
});

test('invalid production asset metadata fails closed', () => {
  assert.throws(
    () => createObjectRenderCatalog([definition({ asset: { path: '../cottage.obj' } })], placementCatalog),
    /GLB file/,
  );
  assert.throws(
    () => createObjectRenderCatalog([
      definition({ asset: { path: 'cottage.glb', node: 'cottage', scale: 0 } }),
    ], placementCatalog),
    /scale must be positive/,
  );
});

test('every placement definition requires matching render metadata', () => {
  assert.throws(
    () => createObjectRenderCatalog([], placementCatalog),
    /missing from the render catalog/,
  );
});
