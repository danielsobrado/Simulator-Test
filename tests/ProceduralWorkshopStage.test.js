import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { createWorkshopStage } from '../src/editor/workshop/ProceduralWorkshopStage.js';

function meshCount(root) {
  let count = 0;
  root.traverse((object) => {
    if (object.isMesh) count += 1;
  });
  return count;
}

test('procedural workshop stage batches static scenery into a bounded mesh count', () => {
  const scene = new THREE.Scene();
  const stage = createWorkshopStage(scene);
  try {
    const count = meshCount(stage.group);
    assert.ok(count > 0);
    assert.ok(count <= 16, `Expected at most 16 static stage meshes, received ${count}.`);
    assert.ok(scene.background?.isTexture);
    assert.ok(scene.fog?.isFog);
  } finally {
    stage.dispose();
  }

  assert.equal(stage.group.parent, null);
  assert.equal(scene.background, null);
  assert.equal(scene.fog, null);
});

test('procedural workshop stage restores prior scene state and disposes idempotently', () => {
  const scene = new THREE.Scene();
  const background = new THREE.Color('#123456');
  const fog = new THREE.Fog('#654321', 2, 20);
  scene.background = background;
  scene.fog = fog;

  const stage = createWorkshopStage(scene);
  assert.notEqual(scene.background, background);
  assert.notEqual(scene.fog, fog);

  stage.dispose();
  stage.dispose();

  assert.equal(scene.background, background);
  assert.equal(scene.fog, fog);
  assert.equal(stage.group.parent, null);
});
