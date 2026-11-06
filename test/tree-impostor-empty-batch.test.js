import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { CpuTreeImpostorBatch } from '../src/editor/stylized/impostor/CpuTreeImpostorBatch.js';
import { GpuTreeImpostorBatch } from '../src/editor/stylized/impostor/GpuTreeImpostorBatch.js';
import { TreeImpostorBatch } from '../src/editor/stylized/impostor/TreeImpostorBatch.js';

function createFixture(Batch, capacity = 4) {
  const scene = new THREE.Scene();
  const atlas = {
    width: 4, height: 8, columns: 8, rows: 2, tileSize: 128,
    lowElevationDegrees: 12, highElevationDegrees: 58,
    albedo: new THREE.Texture(), normal: new THREE.Texture(),
  };
  const computes = [];
  const batch = new Batch({
    scene, atlas, capacity, name: 'test tree impostors',
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

for (const Batch of [GpuTreeImpostorBatch, CpuTreeImpostorBatch]) {
  test(`${Batch.name} uploads only a changed fade and retains pending writes`, () => {
    const { batch, camera, atlas, computes } = createFixture(Batch, 1000);
    const origin = { x: 0, z: 0 };
    const records = Array.from({ length: 1000 }, (_, index) => ({ ...record, seed: index / 1000 }));
    const attributes = batch.transformBuffer
      ? [batch.transformBuffer, batch.parameterBuffer, batch.appearanceBuffer]
      : ['instanceTransform', 'instanceImpostorParams', 'instanceImpostorAppearance']
        .map(name => batch.geometry.getAttribute(name));
    try {
      batch.setRecords(records);
      batch.update(camera, origin);
      attributes.forEach(attribute => attribute.clearUpdateRanges());
      const unchanged = attributes.map(attribute => attribute.array.slice());
      const submissions = computes.length;
      records[500].fade = 0.5;
      batch.setRecords(records);
      batch.update(camera, origin, 16);
      assert.deepEqual(attributes[0].array, unchanged[0]);
      assert.deepEqual(attributes[2].array, unchanged[2]);
      assert.deepEqual(attributes.map(attribute => attribute.updateRanges),
        [[], [{ start: 2000, count: 4 }], []]);
      assert.equal(computes.length, submissions, 'a fade must not rerun GPU visibility');
      const versions = attributes.map(attribute => attribute.version);
      batch.setRecords(records);
      batch.update(camera, origin, 32);
      assert.deepEqual(attributes.map(attribute => attribute.version), versions,
        'the same float values must not dirty buffers again');
      assert.deepEqual(attributes[1].updateRanges, [{ start: 2000, count: 4 }],
        'a write not yet drawn must survive an unchanged update');
      records[900].fade = 0.25;
      batch.setRecords(records);
      batch.update(camera, origin, 48);
      assert.deepEqual(attributes[1].updateRanges,
        [{ start: 2000, count: 4 }, { start: 3600, count: 4 }]);
      assert.equal(attributes[1].array[3601], 0.25);
    } finally { batch.dispose(); atlas.albedo.dispose(); atlas.normal.dispose(); }
  });
}

test('GPU visibility refreshes for changed positions and radii but not appearance', () => {
  const { batch, camera, atlas, computes } = createFixture(GpuTreeImpostorBatch);
  try {
    batch.setRecords([record]); batch.update(camera, { x: 0, z: 0 });
    const submissions = computes.length;
    batch.setRecords([{ ...record, appearance: [0.2, 0.3, 0.4, 0.5] }]);
    batch.update(camera, { x: 0, z: 0 });
    assert.equal(computes.length, submissions);
    batch.setRecords([{ ...record, x: 1000 }]);
    batch.update(camera, { x: 0, z: 0 });
    assert.equal(computes.length, submissions + 1);
    batch.setRecords([{ ...record, x: 1000, radius: 2000 }]);
    batch.update(camera, { x: 0, z: 0 });
    assert.equal(computes.length, submissions + 2);
  } finally { batch.dispose(); atlas.albedo.dispose(); atlas.normal.dispose(); }
});

test('CPU visibility reuses stationary frames and refreshes for camera, projection, origin and records', () => {
  const { batch, camera, atlas } = createFixture(CpuTreeImpostorBatch);
  let checks = 0;
  const intersectsSphere = batch.frustum.intersectsSphere.bind(batch.frustum);
  batch.frustum.intersectsSphere = sphere => { checks++; return intersectsSphere(sphere); };
  try {
    batch.setRecords([record]);
    assert.equal(batch.update(camera, { x: 0, z: 0 }), 1);
    for (let frame = 1; frame <= 100; frame++) batch.update(camera, { x: 0, z: 0 }, frame);
    assert.equal(checks, 1);
    assert.equal(batch.uniforms.time.value, 0.1, 'animation time must still advance');
    camera.position.x = 0.1;
    batch.update(camera, { x: 0, z: 0 });
    assert.equal(checks, 2);
    camera.fov = 70; camera.updateProjectionMatrix();
    batch.update(camera, { x: 0, z: 0 });
    assert.equal(checks, 3);
    batch.update(camera, { x: 1, z: 0 });
    assert.equal(checks, 4);
    assert.equal(batch.geometry.getAttribute('instanceTransform').array[0], -1);
    batch.setRecords([{ ...record, x: 1000 }]);
    assert.equal(batch.update(camera, { x: 1, z: 0 }), 0);
    assert.equal(checks, 5);
    batch.setRecords([record]);
    const reflection = camera.clone(); reflection.lookAt(0, 0, 10);
    assert.equal(batch.update(reflection, { x: 0, z: 0 }), 0);
    assert.equal(batch.update(camera, { x: 0, z: 0 }), 1,
      'returning from a reflection camera must restore the main view');
    camera.coordinateSystem = THREE.WebGPUCoordinateSystem;
    batch.update(camera, { x: 0, z: 0 });
    assert.equal(checks, 8);
  } finally { batch.dispose(); atlas.albedo.dispose(); atlas.normal.dispose(); }
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
