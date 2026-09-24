import * as THREE from 'three/webgpu';

// Two unit quads crossed at right angles: one in the XY plane, one in the ZY
// plane. Eight vertices, three floats each.
const CROSS_POSITIONS = [
  -0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0,
  0, 0, -0.5, 0, 0, 0.5, 0, 1, -0.5, 0, 1, 0.5,
];
const CROSS_UVS = [
  0, 0, 1, 0, 0, 1, 1, 1,
  0, 0, 1, 0, 0, 1, 1, 1,
];
const CROSS_INDICES = [0, 1, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7];

export function createFlowerCrossGeometry(maxInstances) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CROSS_POSITIONS), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(CROSS_UVS), 2));
  geometry.setIndex(CROSS_INDICES);
  geometry.setAttribute(
    'instanceBase',
    new THREE.InstancedBufferAttribute(new Float32Array(maxInstances * 3), 3),
  );
  geometry.setAttribute(
    'instanceParams',
    new THREE.InstancedBufferAttribute(new Float32Array(maxInstances * 4), 4),
  );
  geometry.instanceCount = 0;
  return geometry;
}

// The vertex shader places every instance, so the cross's own positions say
// nothing about where flowers are drawn. Bounds always come from the scatter;
// an empty scatter (a chunk of open sea) gets empty bounds rather than stale
// ones from the chunk this slot held before.
export function setFlowerGeometryBounds(geometry, {
  chunkWorldSize,
  minimumHeight,
  maximumHeight,
  maximumSize,
}) {
  if (!Number.isFinite(minimumHeight) || !Number.isFinite(maximumHeight)) {
    geometry.boundingBox = new THREE.Box3();
    geometry.boundingSphere = new THREE.Sphere();
    return false;
  }
  const half = chunkWorldSize / 2 + maximumSize + 1;
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(-half, minimumHeight - 1, -half),
    new THREE.Vector3(half, maximumHeight + maximumSize + 2, half),
  );
  geometry.boundingSphere = new THREE.Sphere();
  geometry.boundingBox.getBoundingSphere(geometry.boundingSphere);
  return true;
}
