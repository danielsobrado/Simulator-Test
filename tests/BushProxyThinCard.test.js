import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { createBushProxyGeometry } from '../src/editor/stylized/BushRenderAssets.js';

test('bush proxy generation expands zero-thickness authored cards safely', () => {
  const geometry = new THREE.PlaneGeometry(2, 1);
  geometry.translate(0, 0.5, 0);

  const proxy = createBushProxyGeometry(geometry);
  proxy.computeBoundingBox();
  const size = proxy.boundingBox.getSize(new THREE.Vector3());

  assert.ok(size.x >= 2);
  assert.ok(size.y >= 1);
  assert.ok(size.z >= 0.05);

  proxy.dispose();
  geometry.dispose();
});
