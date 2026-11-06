import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { bakeCanopyVisibility } from '../src/editor/stylized/forest/CanopyVisibility.js';
import { instanceGeometryArrays } from '../src/editor/stylized/lod/instanceGeometryArrays.js';

function crown(scale = 1) {
  return [0, 1, 2, 3].map(y => {
    const geometry = new THREE.PlaneGeometry(y === 0 ? 0.5 : 4, y === 0 ? 0.5 : 4, 12, 12);
    geometry.rotateX(-Math.PI / 2).translate(0, y, 0).scale(scale, scale, scale);
    return { kind: 'leaf', geometry };
  });
}

test('canopy bake preserves donor normals and shades sheltered leaves with bounded visibility', () => {
  const parts = crown();
  const before = parts.map(({ geometry }) => Array.from(geometry.attributes.normal.array));
  bakeCanopyVisibility(parts);
  const means = parts.map(({ geometry }, part) => {
    const normal = geometry.attributes.normal, sky = geometry.attributes.canopyVisibility;
    assert.equal(normal.data, sky.data, 'no extra vertex-buffer stream');
    let sum = 0;
    for (let i = 0; i < normal.count; i++) {
      assert.deepEqual([normal.getX(i), normal.getY(i), normal.getZ(i)], before[part].slice(i * 3, i * 3 + 3));
      assert.ok(sky.getX(i) >= 0 && sky.getX(i) <= 1);
      sum += sky.getX(i);
    }
    return sum / sky.count;
  });
  assert.ok(means[0] < means[3] - 0.15, `sheltered ${means[0]}, exposed ${means[3]}`);
  assert.ok(means[3] > 0.95);
  const clone = instanceGeometryArrays(parts[0].geometry);
  assert.equal(clone.attributes.normal.data, clone.attributes.canopyVisibility.data);
  assert.notEqual(clone.attributes.normal.data, parts[0].geometry.attributes.normal.data);
});

test('canopy visibility is deterministic and independent of uniform prototype scale', () => {
  const a = crown(), b = crown(3), repeat = crown();
  for (const parts of [a, b, repeat]) bakeCanopyVisibility(parts);
  for (let part = 0; part < a.length; part++) {
    const x = a[part].geometry.attributes.canopyVisibility;
    for (let i = 0; i < x.count; i++) {
      assert.equal(x.getX(i), repeat[part].geometry.attributes.canopyVisibility.getX(i));
      assert.ok(Math.abs(x.getX(i) - b[part].geometry.attributes.canopyVisibility.getX(i)) < 1e-5);
    }
  }
});
