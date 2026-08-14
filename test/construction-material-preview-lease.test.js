import assert from 'node:assert/strict';
import test from 'node:test';

import {
  captureConstructionMaterialLease,
  constructionMaterialCacheSize,
  createConstructionMaterials,
  disposeConstructionMaterials,
  releaseConstructionMaterials,
} from '../src/editor/construction/render/ConstructionMaterials.js';

function record(stone = null) {
  return {
    seed: 7,
    style: {
      key: 'coursed-rubble',
      version: 1,
      materials: { stone, mortar: null, roof: null },
    },
  };
}

test('temporary construction material leases release preview bundles', () => {
  disposeConstructionMaterials();
  const committed = createConstructionMaterials(record());

  try {
    assert.equal(constructionMaterialCacheSize(), 1);

    const releasePreview = captureConstructionMaterialLease(() => {
      createConstructionMaterials(record('temporary-preview'));
    });
    assert.equal(constructionMaterialCacheSize(), 2);

    releasePreview();
    releasePreview();
    assert.equal(constructionMaterialCacheSize(), 1);
  } finally {
    releaseConstructionMaterials(committed);
    disposeConstructionMaterials();
  }

  assert.equal(constructionMaterialCacheSize(), 0);
});
