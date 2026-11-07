import * as THREE from 'three/webgpu';
import { markAttributeSubrangeUpdated } from '../attributeUpload.js';
import { writeImpostorAttribute } from './ImpostorAttributeUpdates.js';
import { createCpuTreeImpostorMaterial, updateImpostorCameraUniforms } from './TreeImpostorMaterial.js';

const DEFAULT_APPEARANCE = Object.freeze([1, 1, 1, 1]);

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
  geometry.setAttribute(
    'instanceImpostorAppearance',
    new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4).fill(1), 4),
  );
  geometry.instanceCount = 0;
  return geometry;
}

export class CpuTreeImpostorBatch {
  constructor({ scene, atlas, capacity, name, ambientEffects = null }) {
    this.atlas = atlas;
    this.capacity = capacity;
    this.records = [];
    this.geometry = createGeometry(capacity);
    const built = createCpuTreeImpostorMaterial(atlas, ambientEffects);
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
    this.lastProjectionView = new THREE.Matrix4();
    this.lastOriginX = Number.NaN;
    this.lastOriginZ = Number.NaN;
    this.lastCoordinateSystem = null;
    this.recordsDirty = true;
    this.sphere = new THREE.Sphere();
    this.lastCullRecordCount = 0;
    this.lastCullReused = false;
  }

  setRecords(records) {
    this.records = records.slice(0, this.capacity);
    this.recordsDirty = true;
    return this.records.length;
  }

  update(camera, origin, timestamp = 0) {
    this.lastCullRecordCount = 0;
    this.lastCullReused = false;
    updateImpostorCameraUniforms(this.uniforms, camera, timestamp);
    this.projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    if (!this.recordsDirty && this.projectionView.equals(this.lastProjectionView)
        && origin.x === this.lastOriginX && origin.z === this.lastOriginZ
        && camera.coordinateSystem === this.lastCoordinateSystem) {
      this.lastCullReused = true;
      this.mesh.visible = this.geometry.instanceCount > 0;
      return this.geometry.instanceCount;
    }
    this.lastProjectionView.copy(this.projectionView);
    this.lastOriginX = origin.x;
    this.lastOriginZ = origin.z;
    this.lastCoordinateSystem = camera.coordinateSystem;
    this.recordsDirty = false;
    this.frustum.setFromProjectionMatrix(this.projectionView, camera.coordinateSystem);
    const transforms = this.geometry.getAttribute('instanceTransform');
    const parameters = this.geometry.getAttribute('instanceImpostorParams');
    const appearances = this.geometry.getAttribute('instanceImpostorAppearance');
    const transformRange = { min: Infinity, max: -1 };
    const parameterRange = { min: Infinity, max: -1 };
    const appearanceRange = { min: Infinity, max: -1 };
    let count = 0;
    this.lastCullRecordCount = this.records.length;

    for (const record of this.records) {
      this.sphere.center.set(
        record.x - origin.x,
        record.y,
        record.z - origin.z,
      );
      this.sphere.radius = record.radius;
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      writeImpostorAttribute(transforms, count,
        record.x - origin.x, record.y, record.z - origin.z, record.scale, transformRange);
      writeImpostorAttribute(parameters, count,
        record.yaw, record.fade, record.seed, record.radius, parameterRange);
      const appearance = record.appearance ?? DEFAULT_APPEARANCE;
      writeImpostorAttribute(appearances, count,
        appearance[0], appearance[1], appearance[2], appearance[3], appearanceRange);
      count += 1;
    }

    this.geometry.instanceCount = count;
    this.mesh.visible = count > 0;
    if (count > 0) {
      markAttributeSubrangeUpdated(transforms, transformRange.min, transformRange.max,
        { counter: 'treeImpostorAttributeBytesUploaded' });
      markAttributeSubrangeUpdated(parameters, parameterRange.min, parameterRange.max,
        { counter: 'treeImpostorAttributeBytesUploaded' });
      markAttributeSubrangeUpdated(appearances, appearanceRange.min, appearanceRange.max,
        { counter: 'treeImpostorAttributeBytesUploaded' });
    }
    return count;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.records.length = 0;
  }
}
