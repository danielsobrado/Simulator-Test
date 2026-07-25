import * as THREE from 'three/webgpu';
import { createCpuTreeImpostorMaterial, updateImpostorCameraUniforms } from './TreeImpostorMaterial.js';

function createGeometry(capacity) {
  const positions = new Float32Array([
    -0.5, -0.5, 0,
    0.5, -0.5, 0,
    -0.5, 0.5, 0,
    -0.5, 0.5, 0,
    0.5, -0.5, 0,
    0.5, 0.5, 0,
  ]);
  const uvs = new Float32Array([
    0, 0,
    1, 0,
    0, 1,
    0, 1,
    1, 0,
    1, 1,
  ]);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute(
    'instanceTransform',
    new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4),
  );
  geometry.setAttribute(
    'instanceImpostorParams',
    new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4),
  );
  geometry.instanceCount = 0;
  return geometry;
}

export class CpuTreeImpostorBatch {
  constructor({ scene, atlas, capacity, name }) {
    this.atlas = atlas;
    this.capacity = capacity;
    this.records = [];
    this.geometry = createGeometry(capacity);
    const built = createCpuTreeImpostorMaterial(atlas);
    this.material = built.material;
    this.uniforms = built.uniforms;
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this.scene = scene;
    this.frustum = new THREE.Frustum();
    this.projectionView = new THREE.Matrix4();
    this.sphere = new THREE.Sphere();
  }

  setRecords(records) {
    this.records = records.slice(0, this.capacity);
    return this.records.length;
  }

  update(camera, origin, timestamp = 0) {
    updateImpostorCameraUniforms(this.uniforms, camera, timestamp);
    this.projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projectionView);
    const transforms = this.geometry.getAttribute('instanceTransform');
    const parameters = this.geometry.getAttribute('instanceImpostorParams');
    let count = 0;

    for (const record of this.records) {
      this.sphere.center.set(
        record.x - origin.x,
        record.y,
        record.z - origin.z,
      );
      this.sphere.radius = record.radius;
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      const transformOffset = count * 4;
      transforms.array[transformOffset] = record.x - origin.x;
      transforms.array[transformOffset + 1] = record.y;
      transforms.array[transformOffset + 2] = record.z - origin.z;
      transforms.array[transformOffset + 3] = record.scale;
      parameters.array[transformOffset] = record.yaw;
      parameters.array[transformOffset + 1] = record.fade;
      parameters.array[transformOffset + 2] = record.seed;
      parameters.array[transformOffset + 3] = record.radius;
      count += 1;
    }

    this.geometry.instanceCount = count;
    transforms.needsUpdate = true;
    parameters.needsUpdate = true;
    return count;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.records.length = 0;
  }
}
