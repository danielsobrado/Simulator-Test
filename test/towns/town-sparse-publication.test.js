import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry, InstancedMesh, MeshBasicMaterial } from 'three/webgpu';
import { TownModuleInstances } from '../../src/editor/towns/TownModuleInstances.js';
import { PerfCounters } from '../../src/editor/performance/qa/PerfCounters.js';

function fixture(t) {
  const geometry = new BoxGeometry(), glass = new BoxGeometry(0.5, 0.5, 0.1), material = new MeshBasicMaterial();
  const count = 2000, values = new Float32Array(count * 4), seeds = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    values.set([index * 2, index % 7, index % 11, index / 100], index * 4); seeds[index] = index / count;
  }
  const module = new TownModuleInstances({ module: 'Floor', values, seeds, near: { opaque: geometry, glass: [glass] }, far: null, interior: true,
    createMesh: (source, _kind, capacity) => new InstancedMesh(source, material, capacity) });
  const indices = Uint32Array.from({ length: 1000 }, (_, index) => index * 2);
  t.after(() => { for (const mesh of module.meshes) mesh.dispose(); geometry.dispose(); glass.dispose(); material.dispose(); });
  return { module, indices };
}

test('distant changed interior slots copy and upload only those rows for every mesh', t => {
  const { module, indices } = fixture(t), meshes = module.nearMeshes;
  module.writeSubset(meshes, indices, indices.length);
  const before = meshes.map(mesh => mesh.instanceMatrix.array.slice());
  for (const mesh of meshes) { mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceColor?.clearUpdateRanges(); }
  indices[5]++; indices[900]++;
  PerfCounters.reset(); module.writeSubset(meshes, indices, indices.length);
  assert.equal(PerfCounters.get('townInstanceRowsCopied'), 4);
  assert.equal(PerfCounters.get('attributeBytesUploaded'), 280, 'two matrices per mesh plus two colours for the opaque mesh');
  for (const [index, mesh] of meshes.entries()) {
    const expected = before[index];
    for (const slot of [5, 900]) expected.set(module.matrices.subarray(indices[slot] * 16, indices[slot] * 16 + 16), slot * 16);
    assert.deepEqual(mesh.instanceMatrix.array, expected);
    assert.deepEqual(mesh.instanceMatrix.updateRanges, [{ start: 80, count: 16 }, { start: 14400, count: 16 }]);
    if (mesh.instanceColor) {
      assert.deepEqual(mesh.instanceColor.updateRanges, [{ start: 15, count: 3 }, { start: 2700, count: 3 }]);
      for (const slot of [5, 900]) assert.deepEqual(mesh.instanceColor.array.subarray(slot * 3, slot * 3 + 3), module.colours.subarray(indices[slot] * 3, indices[slot] * 3 + 3));
    }
  }
  const versions = meshes.map(mesh => mesh.instanceMatrix.version);
  module.writeSubset(meshes, indices, indices.length);
  assert.deepEqual(meshes.map(mesh => mesh.instanceMatrix.version), versions);
  indices[700]++; module.writeSubset(meshes, indices, indices.length);
  assert.deepEqual(meshes[0].instanceMatrix.updateRanges, [{ start: 80, count: 16 }, { start: 11200, count: 16 }, { start: 14400, count: 16 }], 'undrawn writes survive another publication');
});

test('interior subset shrink, regrowth and empty publication preserve all live matrices', t => {
  const { module, indices } = fixture(t), meshes = module.nearMeshes;
  module.writeSubset(meshes, indices, 1000);
  for (const mesh of meshes) mesh.instanceMatrix.clearUpdateRanges();
  PerfCounters.reset(); module.writeSubset(meshes, indices, 20);
  assert.equal(PerfCounters.get('townInstanceRowsCopied'), 0);
  assert.ok(meshes.every(mesh => mesh.count === 20 && mesh.instanceMatrix.updateRanges.length === 0));
  module.writeSubset(meshes, indices, 0);
  assert.ok(meshes.every(mesh => mesh.count === 0));
  module.writeSubset(meshes, indices, 1000);
  for (const mesh of meshes) {
    assert.equal(mesh.count, 1000);
    for (let slot = 0; slot < 1000; slot++) assert.deepEqual(mesh.instanceMatrix.array.subarray(slot * 16, slot * 16 + 16), module.matrices.subarray(indices[slot] * 16, indices[slot] * 16 + 16));
  }
});
