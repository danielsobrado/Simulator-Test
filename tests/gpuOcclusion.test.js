import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';

import { GpuOcclusion } from '../src/render/occlusion/GpuOcclusion.js';
import {
  isSolidOccluder, occlusionDrawRange, projectOcclusionBounds,
} from '../src/render/occlusion/occlusionBounds.js';

function viewMatrix({ position = [0, 0, 5], target = [0, 0, 0] } = {}) {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
  camera.position.set(...position);
  camera.lookAt(...target);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
}

test('a projected box rounds outwards, and anything crossing the near plane is never culled', () => {
  const projectionView = viewMatrix();
  const box = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
  const rect = projectOcclusionBounds(box, projectionView, 256, 256, 2);
  assert.ok(rect);
  assert.ok(rect.minX < rect.maxX && rect.minY < rect.maxY);
  assert.ok(rect.minX >= 0 && rect.minY >= 0 && rect.maxX <= 255 && rect.maxY <= 255);
  assert.ok(rect.depth > 0 && rect.depth < 1, 'depth is the nearest corner');
  const wider = projectOcclusionBounds(box, projectionView, 256, 256, 12);
  assert.ok(wider.minX < rect.minX && wider.maxX > rect.maxX, 'padding widens the rect');
  assert.ok(wider.minX <= rect.minX, 'padding never narrows it');

  assert.equal(projectOcclusionBounds(new THREE.Box3(), projectionView, 256, 256), null, 'empty box');
  const behind = new THREE.Box3(new THREE.Vector3(-1, -1, 20), new THREE.Vector3(1, 1, 22));
  assert.equal(projectOcclusionBounds(behind, projectionView, 256, 256), null, 'behind the eye');
  const straddling = new THREE.Box3(new THREE.Vector3(-1, -1, 4), new THREE.Vector3(1, 1, 6));
  assert.equal(projectOcclusionBounds(straddling, projectionView, 256, 256), null, 'the box contains the eye');
});

test('a draw that owns its own indirect record is never a candidate', () => {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicNodeMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  assert.deepEqual(
    occlusionDrawRange(mesh, material, null),
    { count: geometry.index.count, first: 0, instances: 1 },
  );
  // This project's tree impostors and voxel chunks compact their own draws on the GPU.
  geometry.setIndirect(new THREE.IndirectStorageBufferAttribute(new Uint32Array(5), 5));
  assert.equal(occlusionDrawRange(mesh, material, null), null);
  geometry.setIndirect(null);
  assert.equal(occlusionDrawRange(mesh, new THREE.MeshBasicNodeMaterial({ wireframe: true }), null), null);
  assert.equal(occlusionDrawRange(new THREE.Mesh(geometry, material), material, null).count > 0, true);
  const instanced = new THREE.InstancedBufferGeometry();
  instanced.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1], 3));
  instanced.instanceCount = 7;
  assert.equal(occlusionDrawRange(new THREE.Mesh(instanced, material), material, null).instances, 7);
  instanced.instanceCount = 0;
  assert.equal(occlusionDrawRange(new THREE.Mesh(instanced, material), material, null), null);
});

test('only flatly opaque geometry occludes, unless a host opts in with its own proxy', () => {
  const solid = () => {
    const material = new THREE.MeshBasicNodeMaterial();
    return { material, mesh: new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material) };
  };
  const first = solid();
  assert.equal(isSolidOccluder(first.mesh), true);

  const cutout = solid();
  cutout.material.alphaTest = 0.5;
  assert.equal(isSolidOccluder(cutout.mesh), false, 'a cut-out card writes no honest depth');

  const displaced = solid();
  displaced.material.positionNode = new THREE.Vector3(0, 1, 0);
  assert.equal(isSolidOccluder(displaced.mesh), false, 'its vertices are not where the geometry says');

  const instanced = solid();
  instanced.mesh.isInstancedMesh = true;
  assert.equal(isSolidOccluder(instanced.mesh), false);

  const opted = solid();
  opted.material.positionNode = new THREE.Vector3(0, 1, 0);
  opted.mesh.userData.occlusionOccluder = true;
  assert.equal(isSolidOccluder(opted.mesh), true, 'the host supplies a matching depth proxy');

  const optedTransparent = solid();
  optedTransparent.mesh.userData.occlusionOccluder = true;
  optedTransparent.material.transparent = true;
  assert.equal(isSolidOccluder(optedTransparent.mesh), false, 'opting in does not excuse coverage');
});

test('without a WebGPU backend the pass is inert and draws the frame untouched', () => {
  const drawn = [];
  const world = { renderer: { backend: null }, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera() };
  const occlusion = new GpuOcclusion(world, { enabled: true });
  assert.doesNotThrow(() => occlusion.prepare());
  assert.equal(occlusion.stats.supported, false);
  occlusion.render(() => drawn.push('frame'));
  assert.deepEqual(drawn, ['frame'], 'the ordinary frame is submitted');
  assert.equal(occlusion.active.size, 0);
  occlusion.dispose();
});

test('the shipped configuration leaves the diagnostic readback off', async () => {
  const { readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const source = await readFile(
    path.resolve(import.meta.dirname, '..', 'editor.config.yaml'),
    'utf8',
  );
  assert.match(source, /gpuOcclusion:[\s\S]*?diagnostics: false/);
});

test('occlusion retains buffers outside the view and releases retired geometries and groups', () => {
  const allocated = [], released = [];
  const renderer = { backend: {
    createIndirectStorageAttribute: attribute => allocated.push(attribute),
    destroyAttribute: attribute => released.push(attribute),
  } };
  const scene = new THREE.Scene();
  const geometry = new THREE.BoxGeometry();
  const materials = [new THREE.MeshBasicNodeMaterial(), new THREE.MeshBasicNodeMaterial()];
  const mesh = new THREE.Mesh(geometry, materials);
  scene.add(mesh);
  const occlusion = new GpuOcclusion({ renderer, scene, camera: new THREE.PerspectiveCamera() });
  try {
    const firstGroup = geometry.groups[0], secondGroup = geometry.groups[1];
    const first = occlusion.indirectRecord(mesh, firstGroup);
    const second = occlusion.indirectRecord(mesh, secondGroup);
    mesh.visible = false;
    for (let turn = 0; turn < 10; turn++) {
      occlusion.pruneRecords();
      assert.equal(occlusion.indirectRecord(mesh, firstGroup), first);
    }
    assert.equal(allocated.length, 2);
    assert.equal(released.length, 0, 'hidden resident meshes retain their buffers');
    geometry.groups.splice(geometry.groups.indexOf(secondGroup), 1);
    occlusion.pruneRecords();
    assert.deepEqual(released, [second.indirect]);
    mesh.geometry = new THREE.BoxGeometry();
    occlusion.pruneRecords();
    assert.deepEqual(released, [second.indirect, first.indirect]);
    mesh.material = materials[0];
    const replacement = occlusion.indirectRecord(mesh, null);
    scene.remove(mesh);
    occlusion.pruneRecords();
    assert.equal(occlusion.records.size, 0);
    assert.equal(released.at(-1), replacement.indirect);
    assert.equal(released.length, allocated.length);
  } finally {
    occlusion.dispose();
    geometry.dispose();
    mesh.geometry.dispose();
    for (const material of materials) material.dispose();
  }
});

test('retained group buffers cannot supply stale visibility to current or other-camera draws', () => {
  const drawn = [];
  const renderer = { backend: {
    createIndirectStorageAttribute() {}, destroyAttribute() {},
    draw: object => drawn.push(object.geometry.indirect),
  } };
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshBasicNodeMaterial();
  const mesh = new THREE.Mesh(geometry, [material, material]);
  scene.add(mesh);
  const occlusion = new GpuOcclusion({ renderer, scene, camera });
  try {
    const currentGroup = geometry.groups[0], staleGroup = geometry.groups[1];
    const current = occlusion.indirectRecord(mesh, currentGroup);
    const stale = occlusion.indirectRecord(mesh, staleGroup);
    occlusion.collectionSerial = 4;
    current.collectionSerial = 4;
    stale.collectionSerial = 3;
    occlusion.active.set(mesh, occlusion.records.get(mesh));
    const ownIndirect = new THREE.IndirectStorageBufferAttribute(new Uint32Array(5), 1);
    geometry.indirect = ownIndirect;
    const originalDraw = renderer.backend.draw;
    const draw = { object: mesh, scene, camera, geometry, group: currentGroup };
    occlusion.render(() => {
      renderer.backend.draw(draw);
      renderer.backend.draw({ ...draw, group: staleGroup });
      renderer.backend.draw({ ...draw, camera: new THREE.PerspectiveCamera() });
    });
    assert.deepEqual(drawn, [current.indirect, ownIndirect, ownIndirect]);
    assert.equal(geometry.indirect, ownIndirect);
    assert.equal(renderer.backend.draw, originalDraw);
    assert.throws(() => occlusion.render(() => { throw new Error('draw failed'); }), /draw failed/);
    assert.equal(renderer.backend.draw, originalDraw, 'the bridge also restores after a failed render');
  } finally {
    occlusion.dispose();
    geometry.dispose();
    material.dispose();
  }
});
