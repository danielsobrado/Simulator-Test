import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { float, texture } from 'three/tsl';
import { setRuntimeUserData } from '../src/render/materials/runtimeUserData.js';

test('runtime nodes in userData stay readable and are not serialized by clone()', () => {
  const material = new THREE.MeshStandardNodeMaterial();
  const map = new THREE.CompressedTexture([], 4, 4);
  const node = texture(map).a.mul(float(0.5));
  material.userData.gradedCanopy = true;
  setRuntimeUserData(material, 'crownOpacity', node);
  assert.equal(material.userData.crownOpacity, node);
  const warn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  let clone;
  try { clone = material.clone(); } finally { console.warn = warn; }
  assert.deepEqual(warnings, [], 'no texture serialization');
  assert.equal(clone.userData.gradedCanopy, true, 'plain userData still copies');
  assert.equal(clone.userData.crownOpacity, undefined, 'a clone never gets a JSON blob for a node');
  setRuntimeUserData(material, 'crownOpacity', null);
  assert.equal(material.userData.crownOpacity, null, 'it can be overwritten');
});
