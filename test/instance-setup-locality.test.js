import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry, Group, Matrix4, MeshBasicNodeMaterial } from 'three/webgpu';
import { ObjectView } from '../src/editor/ObjectView.js';
import { createInstancedRenderers, disposeInstancedRenderers } from '../src/editor/stylized/lod/StylizedLodRuntime.js';

for (const tintLeaves of [false, true]) test(`prototype bounds scan once for trees and never for buildings: ${tintLeaves}`, () => {
  const root = new Group(), material = new MeshBasicNodeMaterial();
  let scans = 0;
  const geometries = Array.from({ length: 3 }, (_, i) => {
    const geometry = new BoxGeometry(2, 2, 2).translate(12, i + 2, -7);
    const compute = geometry.computeBoundingBox.bind(geometry);
    geometry.computeBoundingBox = () => { scans++; return compute(); };
    return geometry;
  });
  const parts = geometries.map((geometry, i) => ({ geometry, material, kind: i === 0 ? 'trunk' : 'leaf' }));
  const renderers = createInstancedRenderers({ root, partsByPrototype: [parts], capacity: 8, tintLeaves });
  try {
    assert.equal(scans, tintLeaves ? geometries.length : 0);
    if (tintLeaves) {
      assert.deepEqual(renderers[0][0].material.userData.treeMorphologyPivot, [12, 0, -7]);
      assert.deepEqual(renderers[0][1].material.userData.treeMorphologyPivot, [12, 2, -7]);
    }
  } finally {
    disposeInstancedRenderers(root, renderers);
    for (const geometry of geometries) geometry.dispose();
    material.dispose();
  }
});

test('object LOD capacity retains source arrays with separate geometry and instance lifetimes', () => {
  const root = new Group(), geometry = new BoxGeometry(), material = new MeshBasicNodeMaterial();
  const part = { geometry, material, matrix: new Matrix4() };
  const renderer = { definition: { key: 'building' }, capacity: 0, lodMeshes: { near: [], coarse: [], shell: [] },
    lodSources: { near: [part], coarse: [part], shell: [part] },
    lodShadows: { near: true, coarse: true, shell: false } };
  const view = { root, terrainView: { renderer: { backend: { isWebGLBackend: false } } } };
  try {
    ObjectView.prototype.ensureCapacity.call(view, renderer, 8);
    const previous = renderer.lodMeshes.near[0];
    ObjectView.prototype.ensureCapacity.call(view, renderer, 9);
    for (const meshes of Object.values(renderer.lodMeshes)) {
      const mesh = meshes[0];
      assert.equal(mesh.geometry.attributes.position.array, geometry.attributes.position.array);
      assert.equal(mesh.geometry.index.array, geometry.index.array);
      assert.notEqual(mesh.geometry.attributes.position, geometry.attributes.position);
      assert.notEqual(mesh.geometry.attributes.position, previous.geometry.attributes.position);
      assert.equal(mesh.instanceMatrix.count, 16);
      assert.equal(mesh.geometry.attributes.instanceDither.count, 16);
    }
    assert.equal(previous.parent, null);
    assert.equal(geometry.attributes.position.count, 24);
  } finally {
    for (const meshes of Object.values(renderer.lodMeshes)) disposeInstancedRenderers(root, [meshes]);
    geometry.dispose(); material.dispose();
  }
});
