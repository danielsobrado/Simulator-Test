import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { StylizedWaterSlot } from '../src/editor/stylized/StylizedWaterSlot.js';
import { createWaterField, floatToHalf, waterFieldSurfaceRange } from '../src/editor/water/WaterField.js';
import { createSlotGeometry, fitSlotBounds } from '../src/editor/world/TerrainSlotBounds.js';

function fieldFor(wet) {
  return createWaterField({
    originX: 0,
    originZ: 0,
    chunkSize: 1,
    sampleWater: (x, z) => ({
      coverage: wet && x === z && x >= 0 && x <= 1 ? 1 : 0,
      surfaceHeight: x === 0 ? 480 : 520,
      bedHeight: 470,
      flowX: 0,
      flowZ: 0,
      shoreDistance: 8,
    }),
  });
}

function upload(slot, field, origin = field.surfaceOrigin) {
  slot.uploadField({
    waterFieldPixels: field.pixels,
    waterFieldWidth: field.width,
    waterFieldHeight: field.height,
    waterFieldSurfaceOrigin: origin,
    waterFlowPixels: field.flowPixels,
    waterFlowWidth: field.width,
    waterFlowHeight: field.height,
    waterAppearancePixels: field.appearancePixels,
  });
}

function createSlot(t) {
  const geometry = new THREE.PlaneGeometry(128, 128, 1, 1);
  geometry.computeBoundingSphere();
  const material = new THREE.MeshBasicMaterial();
  const slot = new StylizedWaterSlot({
    terrainSlot: { mesh: new THREE.Mesh(geometry), slotIndex: 0 },
    terrainView: { geometry, chunkSize: 1, chunkWorldSize: 128, scene: new THREE.Scene() },
    config: { water: {} },
    sharedMaterials: { get: () => material },
  });
  t.after(() => { slot.dispose(); geometry.dispose(); material.dispose(); });
  return slot;
}

test('water upload fits independent culling bounds to surface heights plus origin and swell padding', (t) => {
  const slot = createSlot(t);
  const field = fieldFor(true);
  assert.equal(field.surfaceOrigin, 500);
  assert.deepEqual(waterFieldSurfaceRange(field.pixels), { min: -20, max: 20 });
  upload(slot, field);

  const source = slot.terrainView.geometry;
  const geometry = slot.mesh.geometry;
  assert.notStrictEqual(geometry, source);
  assert.strictEqual(geometry.index, source.index);
  assert.strictEqual(geometry.attributes.position, source.attributes.position);
  assert.equal(slot.mesh.frustumCulled, true);
  assert.deepEqual(geometry.boundingBox.min.toArray(), [-64, -64, 474]);
  assert.deepEqual(geometry.boundingBox.max.toArray(), [64, 64, 526]);
  assert.equal(geometry.boundingSphere.center.z, 500);
  assert.equal(source.boundingSphere.center.z, 0);
  assert.equal(source.boundingBox, null);
});

test('dry heights and signed zero coverage do not extend the water surface range', () => {
  const pixels = Uint16Array.from([
    floatToHalf(1), floatToHalf(-4), 0, 0,
    floatToHalf(0.25), floatToHalf(12), 0, 0,
    floatToHalf(-0), floatToHalf(-1000), 0, 0,
    floatToHalf(0), floatToHalf(1000), 0, 0,
  ]);
  assert.deepEqual(waterFieldSurfaceRange(pixels), { min: -4, max: 12 });
  pixels[0] = pixels[4] = 0;
  assert.equal(waterFieldSurfaceRange(pixels), null);
});

test('dry uploads leave existing bounds unchanged and a reused wet slot refits them', (t) => {
  const slot = createSlot(t);
  const geometry = slot.mesh.geometry;
  const initialSphere = geometry.boundingSphere.clone();
  upload(slot, fieldFor(false));
  assert.equal(slot.hasWaterCoverage, false);
  assert.equal(geometry.boundingBox, null);
  assert.deepEqual(geometry.boundingSphere, initialSphere);

  upload(slot, fieldFor(true));
  const box = geometry.boundingBox;
  const sphere = geometry.boundingSphere;
  const wetBox = box.clone();
  const wetSphere = sphere.clone();
  upload(slot, fieldFor(false));
  assert.deepEqual(box, wetBox);
  assert.deepEqual(sphere, wetSphere);

  upload(slot, fieldFor(true), null);
  assert.strictEqual(geometry.boundingBox, box);
  assert.strictEqual(geometry.boundingSphere, sphere);
  assert.deepEqual(box.min.toArray(), [-64, -64, -26]);
  assert.deepEqual(box.max.toArray(), [64, 64, 26]);
});

test('water culling keeps an elevated surface ahead and rejects the same chunk behind the camera', (t) => {
  const slot = createSlot(t);
  upload(slot, fieldFor(true));
  const camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.1, 5000);
  camera.position.set(0, 502, 0);
  camera.lookAt(0, 500, -256);
  camera.updateMatrixWorld(true);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
  slot.mesh.position.z = -256;
  slot.mesh.updateMatrixWorld(true);
  assert.equal(frustum.intersectsObject(slot.mesh), true);
  slot.mesh.position.z = 256;
  slot.mesh.updateMatrixWorld(true);
  assert.equal(frustum.intersectsObject(slot.mesh), false);
});

test('terrain bounds retain the exact fixed-height box and sphere with 2 m padding', () => {
  const geometry = createSlotGeometry(new THREE.PlaneGeometry(128, 128));
  fitSlotBounds(geometry, Float32Array.from([10, 20, 30]), 128);
  assert.deepEqual(geometry.boundingBox.min.toArray(), [-64, -64, 8]);
  assert.deepEqual(geometry.boundingBox.max.toArray(), [64, 64, 32]);
  assert.deepEqual(geometry.boundingSphere.center.toArray(), [0, 0, 20]);
  assert.equal(geometry.boundingSphere.radius, Math.sqrt(64 ** 2 * 2 + 12 ** 2));
});
