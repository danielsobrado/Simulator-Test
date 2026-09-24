import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import {
  createFlowerCrossGeometry,
  setFlowerGeometryBounds,
} from '../src/editor/stylized/StylizedFlowerGeometry.js';
import { StylizedFlowerSlot } from '../src/editor/stylized/StylizedFlowerSlot.js';

const CHUNK_WORLD_SIZE = 128;
const MAX_SIZE = 0.6;

function assertFiniteSphere(sphere, label) {
  assert.ok(sphere, `${label}: bounding sphere missing`);
  assert.ok(Number.isFinite(sphere.radius), `${label}: radius ${sphere.radius}`);
  for (const axis of ['x', 'y', 'z']) {
    assert.ok(Number.isFinite(sphere.center[axis]), `${label}: center.${axis} ${sphere.center[axis]}`);
  }
}

function scatterOf(heights) {
  const base = new Float32Array(Math.max(1, heights.length) * 3);
  const parameters = new Float32Array(Math.max(1, heights.length) * 4);
  heights.forEach((height, index) => {
    base[index * 3] = index;
    base[index * 3 + 1] = height;
    parameters[index * 4 + 1] = MAX_SIZE;
  });
  return {
    base,
    parameters,
    count: heights.length,
    minimumHeight: heights.length ? Math.min(...heights) : Number.POSITIVE_INFINITY,
    maximumHeight: heights.length ? Math.max(...heights) : Number.NEGATIVE_INFINITY,
  };
}

// A slot wired to fakes: rebuild() only needs the geometry, config and a page
// whose cached scatter matches the requested sample limit.
function slotOver(scatter) {
  const slot = Object.create(StylizedFlowerSlot.prototype);
  slot.geometry = createFlowerCrossGeometry(8);
  slot.mesh = new THREE.Mesh(slot.geometry, new THREE.MeshBasicNodeMaterial());
  slot.mesh.visible = false;
  slot.chunkSize = 16;
  slot.tileSize = CHUNK_WORLD_SIZE / 16;
  slot.chunkWorldSize = CHUNK_WORLD_SIZE;
  slot.config = { flowers: { maxSize: MAX_SIZE }, trees: {} };
  slot.forestFieldProvider = null;
  const descriptor = { key: '3:4', chunkX: 3, chunkZ: 4, centerWorldX: 0, centerWorldZ: 0 };
  slot.terrainSlot = { mesh: { visible: true }, descriptor, pageRevision: 1 };
  slot.pendingRebuild = {
    page: { flowerScatter: { ...scatter, sampleLimit: 8 } },
    descriptor,
    revision: 1,
    sampleLimit: 8,
  };
  return slot;
}

test('flower cross geometry is two whole quads with finite positions', () => {
  const geometry = createFlowerCrossGeometry(4);
  const position = geometry.getAttribute('position');
  assert.equal(position.count, 8, 'a fractional count makes three read past the array');
  assert.equal(geometry.getAttribute('uv').count, position.count);
  assert.ok(position.array.every(Number.isFinite));
  assert.ok(geometry.index.array.every((index) => index < position.count));

  // The second quad stands in the ZY plane, crossing the first at right angles.
  for (let vertex = 4; vertex < 8; vertex += 1) {
    assert.equal(position.getX(vertex), 0);
  }

  geometry.computeBoundingSphere();
  assertFiniteSphere(geometry.boundingSphere, 'computed');
});

test('flower bounds stay finite when the chunk scatters nothing', () => {
  const geometry = createFlowerCrossGeometry(4);
  const hasBounds = setFlowerGeometryBounds(geometry, {
    chunkWorldSize: CHUNK_WORLD_SIZE,
    minimumHeight: Number.POSITIVE_INFINITY,
    maximumHeight: Number.NEGATIVE_INFINITY,
    maximumSize: MAX_SIZE,
  });
  assert.equal(hasBounds, false);
  assertFiniteSphere(geometry.boundingSphere, 'empty');
  assert.ok(geometry.boundingSphere.isEmpty());
});

test('flower bounds cover the chunk and the tallest flower', () => {
  const geometry = createFlowerCrossGeometry(4);
  setFlowerGeometryBounds(geometry, {
    chunkWorldSize: CHUNK_WORLD_SIZE,
    minimumHeight: 2,
    maximumHeight: 9,
    maximumSize: MAX_SIZE,
  });
  assertFiniteSphere(geometry.boundingSphere, 'populated');
  assert.ok(geometry.boundingBox.containsPoint(new THREE.Vector3(64, 9 + MAX_SIZE, -64)));
  assert.ok(geometry.boundingBox.containsPoint(new THREE.Vector3(-64, 2, 64)));
});

test('a flower slot over open sea stays hidden and never computes NaN bounds', () => {
  const slot = slotOver(scatterOf([]));
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.map(String).join(' '));
  try {
    assert.equal(slot.applyPendingRebuild(), true);
    assert.equal(slot.geometry.instanceCount, 0);
    assert.equal(slot.mesh.visible, false, 'an empty slot must not reach frustum culling');
    assertFiniteSphere(slot.geometry.boundingSphere, 'open sea');

    // What the renderer's frustum test does with a visible mesh.
    new THREE.Frustum().intersectsObject(slot.mesh);
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(errors.filter((line) => line.includes('NaN')), []);
});

test('a flower slot drops the previous chunk\'s bounds when its new chunk is empty', () => {
  const slot = slotOver(scatterOf([4, 7]));
  slot.applyPendingRebuild();
  assert.equal(slot.mesh.visible, true);
  assert.equal(slot.geometry.boundingSphere.isEmpty(), false);

  const empty = slotOver(scatterOf([]));
  slot.pendingRebuild = empty.pendingRebuild;
  slot.applyPendingRebuild();
  assert.equal(slot.mesh.visible, false);
  assert.ok(slot.geometry.boundingSphere.isEmpty());
});
