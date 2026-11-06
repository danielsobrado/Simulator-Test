import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { attachTreeRoots, extractPrototypeParts } from '../src/editor/stylized/StylizedTreePrototypes.js';

function tree() {
  const root = new THREE.Group();
  for (const kind of ['leaf', 'trunk']) {
    const geometry = new THREE.BoxGeometry(1, 4, 1);
    // Deliberate shading normals unrelated to triangle orientation.
    for (let i = 0; i < geometry.attributes.normal.count; i++) geometry.attributes.normal.setXYZ(i, 0, 1, 0);
    const material = new THREE.MeshLambertMaterial(); material.name = kind;
    root.add(new THREE.Mesh(geometry, material));
  }
  root.rotation.y = .7; root.rotation.z = .12; root.scale.set(2, 3, 1);
  root.updateMatrixWorld(true);
  return root;
}
const config = { assets: { leafMaterial: 'leaf', trunkMaterial: 'trunk' } };

test('tree grounding retains authored shading normals after world transforms', () => {
  const root = tree();
  const original = root.children.map(mesh => mesh.geometry.attributes.normal.array.slice());
  const expected = root.children.map(mesh => mesh.geometry.clone().applyMatrix4(mesh.matrixWorld).attributes.normal.array);
  const parts = extractPrototypeParts(root, config);
  parts.forEach((part, i) => {
    assert.deepEqual(part.geometry.attributes.normal.array, expected[i]);
    assert.deepEqual(root.children[i].geometry.attributes.normal.array, original[i]);
  });
});

test('tree geometry without normals still receives valid generated normals', () => {
  const root = tree(); root.children[0].geometry.deleteAttribute('normal');
  const [leaf] = extractPrototypeParts(root, config);
  assert.equal(leaf.geometry.attributes.normal.count, leaf.geometry.attributes.position.count);
  assert.ok(leaf.geometry.attributes.normal.array.every(Number.isFinite));
});

test('generated roots have neutral colour when merged into a vertex-painted trunk', () => {
  const geometry = new THREE.CylinderGeometry(.3, .3, 10, 12, 20); geometry.translate(0, 5, 0);
  const count = geometry.attributes.position.count;
  geometry.setAttribute('color', new THREE.Uint8BufferAttribute(new Uint8Array(count * 3).fill(160), 3, true));
  const parts = [{ kind: 'trunk', geometry }, { kind: 'leaf', geometry: new THREE.SphereGeometry(3) }];
  assert.equal(attachTreeRoots(parts, 'coloured-trunk'), true);
  const color = parts[0].geometry.attributes.color;
  assert.equal(color.getX(0), 160 / 255);
  for (let i = count; i < color.count; i++) assert.deepEqual([color.getX(i), color.getY(i), color.getZ(i)], [1, 1, 1]);
});

test('normal-mapped trunks give generated roots a finite, nonzero tangent frame', () => {
  for (const indexed of [true, false]) {
    let geometry = new THREE.CylinderGeometry(.3, .3, 10, 12, 20); geometry.translate(0, 5, 0);
    geometry.computeTangents();
    if (!indexed) geometry = geometry.toNonIndexed();
    const count = geometry.attributes.position.count;
    const parts = [{ kind: 'trunk', geometry }, { kind: 'leaf', geometry: new THREE.SphereGeometry(3) }];
    assert.equal(attachTreeRoots(parts, 'normal-mapped-trunk'), true);
    const tangent = parts[0].geometry.attributes.tangent;
    for (let i = count; i < tangent.count; i++) {
      assert.ok(Math.hypot(tangent.getX(i), tangent.getY(i), tangent.getZ(i)) > .9);
      assert.equal(Math.abs(tangent.getW(i)), 1);
    }
  }
});
