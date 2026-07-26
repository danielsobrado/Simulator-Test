import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { ObjectLodController } from '../src/editor/ObjectLodController.js';

function placement(id, z) {
  return {
    object: { id },
    matrix: new THREE.Matrix4().makeTranslation(0, 0, z),
    worldPosition: new THREE.Vector3(0, 3, z),
    worldHeight: 6,
  };
}

function plan(controller, camera, placements, timestamp, options = {}) {
  return controller.plan({
    placements,
    camera,
    viewportHeight: 1000,
    timestamp,
    ...options,
  });
}

test('object LOD selects near, coarse, and shell from projected size', () => {
  const controller = new ObjectLodController({ transitionMs: 1 });
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(0, 3, 0);
  const placements = [placement(1, -20), placement(2, -80), placement(3, -300)];
  plan(controller, camera, placements, 0);
  const settled = plan(controller, camera, placements, 2, { force: true });
  assert.deepEqual(settled.buckets.near.map(({ objectId }) => objectId), [1]);
  assert.deepEqual(settled.buckets.coarse.map(({ objectId }) => objectId), [2]);
  assert.deepEqual(settled.buckets.shell.map(({ objectId }) => objectId), [3]);
});

test('hysteresis prevents immediate oscillation and selected objects pin near', () => {
  const controller = new ObjectLodController({ transitionMs: 1 });
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(0, 3, 0);
  const placements = [placement(1, -80), placement(2, -300)];
  plan(controller, camera, placements, 0);
  let settled = plan(controller, camera, placements, 2, { force: true });
  assert.equal(settled.buckets.coarse[0].objectId, 1);

  placements[0].worldPosition.z = -73;
  settled = plan(controller, camera, placements, 4, { force: true });
  assert.ok(settled.buckets.coarse.some(({ objectId }) => objectId === 1));

  plan(controller, camera, placements, 6, { force: true, selectedObjectId: 2 });
  settled = plan(controller, camera, placements, 8, {
    force: true,
    selectedObjectId: 2,
  });
  assert.ok(settled.buckets.near.some(({ objectId }) => objectId === 2));
});

test('a still settled camera reuses the exact plan without allocation', () => {
  const controller = new ObjectLodController({ transitionMs: 1 });
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  const placements = [placement(1, -20)];
  plan(controller, camera, placements, 0);
  const settled = plan(controller, camera, placements, 2, { force: true });
  const reused = plan(controller, camera, placements, 100);
  assert.equal(reused, settled);
  assert.notEqual(
    plan(controller, camera, placements, 102, { selectedObjectId: 1 }),
    settled,
    'selection changes must invalidate a still-camera plan',
  );
});
