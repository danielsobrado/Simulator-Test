import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { CpuTreeImpostorBatch } from '../src/editor/stylized/impostor/CpuTreeImpostorBatch.js';
import { GpuTreeImpostorBatch } from '../src/editor/stylized/impostor/GpuTreeImpostorBatch.js';
import { TreeImpostorBatch } from '../src/editor/stylized/impostor/TreeImpostorBatch.js';

function createFixture(Batch) {
  const scene = new THREE.Scene();
  const atlas = {
    width: 4, height: 8, columns: 8, rows: 2, tileSize: 128,
    lowElevationDegrees: 12, highElevationDegrees: 58,
    albedo: new THREE.Texture(), normal: new THREE.Texture(),
  };
  const computes = [];
  const batch = new Batch({
    scene, atlas, capacity: 4, name: 'test tree impostors',
    renderer: { backend: { isWebGPUBackend: true }, compute: (...args) => computes.push(args) },
  });
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.updateMatrixWorld();
  return { batch, scene, camera, atlas, computes };
}

function isTraversed(scene, mesh) {
  const visible = [];
  scene.traverseVisible((object) => visible.push(object));
  return visible.includes(mesh);
}

const record = { x: 0, y: 0, z: -10, scale: 1, yaw: 0, fade: 1, seed: 0.3, radius: 1 };

test('reflection cameras recover off-screen impostors and restore the main selection after failure', () => {
  const { batch, camera, atlas } = createFixture(TreeImpostorBatch);
  batch.dispose();
  const owned = new TreeImpostorBatch({ renderer: {}, scene: new THREE.Scene(), atlas, capacity: 4, auxiliaryViews: true });
  try {
    owned.setRecords([{ ...record, z: 10 }]); owned.update(camera, { x: 0, z: 0 });
    assert.equal(owned.batch.mesh.visible, false);
    const reflection = camera.clone(); reflection.lookAt(0, 0, 10); reflection.updateMatrixWorld();
    assert.throws(() => owned.withCamera(reflection, { x: 0, z: 0 }, 0, () => {
      assert.equal(owned.auxiliary.geometry.instanceCount, 1); assert.equal(owned.auxiliary.mesh.visible, true);
      assert.equal(owned.batch.mesh.visible, false); throw new Error('capture');
    }), /capture/);
    assert.equal(owned.auxiliary.mesh.visible, false); assert.equal(owned.batch.mesh.visible, false);
    assert.equal(owned.batch.geometry.instanceCount, 0);
  } finally { owned.dispose(); atlas.albedo.dispose(); atlas.normal.dispose(); }
});

test('impostor batches can share one compute submission', () => {
  const { batch, camera, atlas, computes } = createFixture(GpuTreeImpostorBatch);
  try {
    const queue = [];
    batch.setRecords([record]);
    batch.update(camera, { x: 0, z: 0 }, 0, queue);
    assert.deepEqual(queue, [batch.computeReset, batch.computeCull]);
    assert.equal(computes.length, 0);
    batch.setRecords([]);
    const reset = [];
    batch.update(camera, { x: 0, z: 0 }, 0, reset);
    assert.deepEqual(reset, [batch.computeReset]);
  } finally {
    batch.dispose();
    atlas.albedo.dispose();
    atlas.normal.dispose();
  }
});

test('empty GPU impostor batches leave render traversal and can become populated again', () => {
  const { batch, scene, camera, atlas, computes } = createFixture(GpuTreeImpostorBatch);
  try {
    batch.setRecords([record]);
    batch.update(camera, { x: 0, z: 0 });
    assert.ok(isTraversed(scene, batch.mesh));
    assert.equal(computes.length, 1, 'reset and cull share one encoder');
    assert.deepEqual(computes[0][0], [batch.computeReset, batch.computeCull]);
    assert.equal(batch.computeCull.dispatchSize, 1);

    batch.setRecords([]);
    batch.update(camera, { x: 0, z: 0 });
    assert.equal(isTraversed(scene, batch.mesh), false);
    assert.equal(computes.length, 2, 'the previous indirect instance count still resets');
    batch.update(camera, { x: 0, z: 0 });
    assert.equal(computes.length, 2, 'an empty batch does not keep dispatching');

    batch.setRecords([record]);
    batch.update(camera, { x: 0, z: 0 });
    assert.ok(isTraversed(scene, batch.mesh));
    assert.equal(computes.length, 3);

    batch.update(camera, { x: 0, z: 0 });
    assert.equal(computes.length, 3, 'an unchanged view keeps the last cull');
    batch.update(camera, { x: 64, z: 0 });
    assert.equal(computes.length, 4, 'an origin move culls again');
    camera.position.x += 1; camera.updateMatrixWorld();
    batch.update(camera, { x: 64, z: 0 });
    assert.equal(computes.length, 5, 'a camera move culls again');
    batch.setRecords([record, record]);
    batch.update(camera, { x: 64, z: 0 });
    assert.equal(computes.length, 6, 'new records cull again');
    assert.equal(batch.computeCull.dispatchSize, 2);
  } finally {
    batch.dispose();
    atlas.albedo.dispose();
    atlas.normal.dispose();
  }
});

test('CPU impostor batches leave render traversal when empty or entirely culled', () => {
  const { batch, scene, camera, atlas } = createFixture(CpuTreeImpostorBatch);
  try {
    batch.setRecords([record]);
    assert.equal(batch.update(camera, { x: 0, z: 0 }), 1);
    assert.ok(isTraversed(scene, batch.mesh));

    batch.setRecords([]);
    assert.equal(batch.update(camera, { x: 0, z: 0 }), 0);
    assert.equal(isTraversed(scene, batch.mesh), false);

    batch.setRecords([{ ...record, x: 1000 }]);
    assert.equal(batch.update(camera, { x: 0, z: 0 }), 0);
    assert.equal(isTraversed(scene, batch.mesh), false);

    batch.setRecords([record]);
    assert.equal(batch.update(camera, { x: 0, z: 0 }), 1);
    assert.ok(isTraversed(scene, batch.mesh));
  } finally {
    batch.dispose();
    atlas.albedo.dispose();
    atlas.normal.dispose();
  }
});
