import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  createForestBushPrototypeGeometry,
  FOREST_BUSH_PROTOTYPES,
} from '../src/editor/stylized/forest/ForestBushGeometry.js';

test('default bush prototypes are grounded paired shrubs with bounded geometry cost', () => {
  assert.deepEqual(FOREST_BUSH_PROTOTYPES, [
    'bush_dome',
    'bush_dome_small',
    'bush_dome_wide',
  ]);

  const prototypes = createForestBushPrototypeGeometry();
  try {
    assert.equal(prototypes.length, 3);
    for (const prototype of prototypes) {
      const positions = prototype.geometry.getAttribute('position');
      const colors = prototype.geometry.getAttribute('color');
      assert.ok(Math.abs(prototype.geometry.boundingBox.min.y) < 1e-6);
      assert.ok(prototype.width > prototype.height);
      assert.ok(positions.count >= 1_000, 'Outer clusters should create a leafy silhouette.');
      assert.ok(positions.count <= 3_600, 'Bush instances must stay within the near-LOD budget.');
      assert.equal(colors.count, positions.count);
      assert.equal(prototype.doubleSided, false);
    }
  } finally {
    for (const prototype of prototypes) prototype.geometry.dispose();
  }
});

test('bush vertex shading keeps dark bases and softly highlighted upper foliage', () => {
  const [prototype] = createForestBushPrototypeGeometry(['bush_dome']);
  try {
    const colors = prototype.geometry.getAttribute('color');
    const values = Array.from(colors.array);
    assert.ok(Math.min(...values) < 0.68);
    assert.ok(Math.max(...values) > 1.05);

    const size = prototype.geometry.boundingBox.getSize(new THREE.Vector3());
    assert.ok(size.x / size.y > 1.25, 'The main bush should read as a low paired mound.');
  } finally {
    prototype.geometry.dispose();
  }
});
