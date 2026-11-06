import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry, Group, MeshBasicNodeMaterial } from 'three/webgpu';
import Geometries from '../node_modules/three/src/renderers/common/Geometries.js';
import { WebGLGeometries } from '../node_modules/three/src/renderers/webgl/WebGLGeometries.js';
import { createInstancedRenderers, disposeInstancedRenderers } from '../src/editor/stylized/lod/StylizedLodRuntime.js';

for (const backend of ['webgpu', 'webgl']) test(`capacity growth shares CPU vertex arrays with independent ${backend} disposal`, () => {
  const root = new Group(), geometry = new BoxGeometry(), material = new MeshBasicNodeMaterial();
  const create = (source, capacity, reuseVertexArrays) => createInstancedRenderers({ root,
    partsByPrototype: [[{ geometry: source, material }]], capacity, reuseVertexArrays,
    renderer: { backend: { isWebGLBackend: backend === 'webgl' } } });
  const first = create(geometry, 8, false), old = first[0][0];
  const second = create(old.geometry, 16, true), replacement = second[0][0];
  const deleted = new Set(), info = { memory: { geometries: 0 } };
  if (backend === 'webgpu') {
    const manager = new Geometries({ getBufferAttribute: value => value }, { delete: value => deleted.add(value) }, info);
    for (const mesh of [old, replacement]) manager.initGeometry(mesh.geometry);
  } else {
    const manager = WebGLGeometries({}, { remove: value => deleted.add(value) }, info, { releaseStatesOfGeometry() {} });
    for (const mesh of [old, replacement]) manager.get(mesh, mesh.geometry);
  }
  for (const name of ['position', 'normal', 'uv']) {
    assert.equal(replacement.geometry.attributes[name].array, old.geometry.attributes[name].array);
    assert.notEqual(replacement.geometry.attributes[name], old.geometry.attributes[name]);
  }
  assert.equal(replacement.geometry.index.array, old.geometry.index.array);
  assert.notEqual(replacement.geometry.index, old.geometry.index);
  assert.equal(replacement.geometry.attributes.instanceDither.count, 16);
  assert.equal(old.geometry.attributes.instanceDither.count, 8);
  disposeInstancedRenderers(root, first);
  assert.equal(info.memory.geometries, 1);
  assert.ok(deleted.has(old.geometry.attributes.position));
  assert.ok(!deleted.has(replacement.geometry.attributes.position));
  disposeInstancedRenderers(root, second);
  assert.equal(info.memory.geometries, 0);
  assert.ok(deleted.has(replacement.geometry.attributes.position));
  geometry.dispose(); material.dispose();
});
