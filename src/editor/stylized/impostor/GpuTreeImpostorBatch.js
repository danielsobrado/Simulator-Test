import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  atomicAdd,
  atomicStore,
  dot,
  float,
  instanceIndex,
  storage,
  struct,
  uint,
  uniform,
} from 'three/tsl';
import { markAttributeRangeUpdated } from '../attributeUpload.js';
import { createGpuTreeImpostorMaterial, updateImpostorCameraUniforms } from './TreeImpostorMaterial.js';

const WORKGROUP_SIZE = 64;
const DEFAULT_APPEARANCE = Object.freeze([1, 1, 1, 1]);

function createGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -0.5, -0.5, 0,
    0.5, -0.5, 0,
    -0.5, 0.5, 0,
    -0.5, 0.5, 0,
    0.5, -0.5, 0,
    0.5, 0.5, 0,
  ]), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
    0, 0,
    1, 0,
    0, 1,
    0, 1,
    1, 0,
    1, 1,
  ]), 2));
  return geometry;
}

export class GpuTreeImpostorBatch {
  constructor({ renderer, scene, atlas, capacity, name }) {
    if (!renderer.backend?.isWebGPUBackend) {
      throw new Error('GPU impostor culling requires the WebGPU backend.');
    }
    this.renderer = renderer;
    this.scene = scene;
    this.atlas = atlas;
    this.capacity = capacity;
    this.recordCount = 0;
    this.computePending = null;
    this.indirectNeedsReset = false;
    this.disposed = false;
    this.frustum = new THREE.Frustum();
    this.projectionView = new THREE.Matrix4();

    const geometry = createGeometry();
    const transformBuffer = new THREE.StorageBufferAttribute(new Float32Array(capacity * 4), 4);
    const parameterBuffer = new THREE.StorageBufferAttribute(new Float32Array(capacity * 4), 4);
    const appearanceBuffer = new THREE.StorageBufferAttribute(new Float32Array(capacity * 4).fill(1), 4);
    const visibleBuffer = new THREE.StorageBufferAttribute(new Uint32Array(capacity), 1);
    const planeBuffer = new THREE.StorageBufferAttribute(new Float32Array(6 * 4), 4);
    const drawBuffer = new THREE.IndirectStorageBufferAttribute(new Uint32Array([6, 0, 0, 0, 0]), 5);
    const transformRead = storage(transformBuffer, 'vec4', capacity).toReadOnly();
    const parameterRead = storage(parameterBuffer, 'vec4', capacity).toReadOnly();
    const appearanceRead = storage(appearanceBuffer, 'vec4', capacity).toReadOnly();
    const visibleWrite = storage(visibleBuffer, 'uint', capacity);
    const visibleRead = storage(visibleBuffer, 'uint', capacity).toReadOnly();
    const planeRead = storage(planeBuffer, 'vec4', 6).toReadOnly();
    const drawStruct = struct({
      vertexCount: 'uint',
      instanceCount: { type: 'uint', atomic: true },
      firstVertex: 'uint',
      firstInstance: 'uint',
      offset: 'uint',
    }, 'VegetationDrawBuffer');
    const drawStorage = storage(drawBuffer, drawStruct, drawBuffer.count);
    const countUniform = uniform(0, 'uint');
    const originUniform = uniform(new THREE.Vector3());

    const computeReset = Fn(() => {
      drawStorage.get('vertexCount').assign(uint(6));
      atomicStore(drawStorage.get('instanceCount'), uint(0));
      drawStorage.get('firstVertex').assign(uint(0));
      drawStorage.get('firstInstance').assign(uint(0));
      drawStorage.get('offset').assign(uint(0));
    })().compute(1).setName(`${name} reset indirect draw`);

    const computeCull = Fn(() => {
      const sourceIndex = uint(instanceIndex).toVar('sourceIndex');
      If(sourceIndex.lessThan(countUniform), () => {
        const transform = transformRead.element(sourceIndex);
        const parameters = parameterRead.element(sourceIndex);
        const renderPosition = transform.xyz.sub(originUniform).toVar('renderPosition');
        const visible = float(1).toVar('visible');
        for (let planeIndex = 0; planeIndex < 6; planeIndex += 1) {
          const plane = planeRead.element(planeIndex);
          If(dot(plane.xyz, renderPosition).add(plane.w).lessThan(parameters.w.negate()), () => {
            visible.assign(0);
          });
        }
        If(visible.greaterThan(0.5), () => {
          const outputIndex = atomicAdd(drawStorage.get('instanceCount'), uint(1));
          visibleWrite.element(outputIndex).assign(sourceIndex);
        });
      });
    })().compute(capacity, [WORKGROUP_SIZE]).setName(`${name} frustum cull`);

    geometry.setIndirect(drawBuffer);
    const built = createGpuTreeImpostorMaterial({
      atlas,
      transformRead,
      parameterRead,
      appearanceRead,
      visibleRead,
      instanceIndex: uint(instanceIndex),
      originUniform,
    });
    const mesh = new THREE.Mesh(geometry, built.material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    scene.add(mesh);

    this.geometry = geometry;
    this.material = built.material;
    this.uniforms = built.uniforms;
    this.mesh = mesh;
    this.transformBuffer = transformBuffer;
    this.parameterBuffer = parameterBuffer;
    this.appearanceBuffer = appearanceBuffer;
    this.visibleBuffer = visibleBuffer;
    this.planeBuffer = planeBuffer;
    this.drawBuffer = drawBuffer;
    this.countUniform = countUniform;
    this.originUniform = originUniform;
    this.computeReset = computeReset;
    this.computeCull = computeCull;
  }

  setRecords(records) {
    const previousCount = this.recordCount;
    const count = Math.min(records.length, this.capacity);
    const transforms = this.transformBuffer.array;
    const parameters = this.parameterBuffer.array;
    const appearances = this.appearanceBuffer.array;
    for (let index = 0; index < count; index += 1) {
      const record = records[index];
      const offset = index * 4;
      transforms[offset] = record.x;
      transforms[offset + 1] = record.y;
      transforms[offset + 2] = record.z;
      transforms[offset + 3] = record.scale;
      parameters[offset] = record.yaw;
      parameters[offset + 1] = record.fade;
      parameters[offset + 2] = record.seed;
      parameters[offset + 3] = record.radius;
      const appearance = record.appearance ?? DEFAULT_APPEARANCE;
      appearances[offset] = appearance[0];
      appearances[offset + 1] = appearance[1];
      appearances[offset + 2] = appearance[2];
      appearances[offset + 3] = appearance[3];
    }
    this.recordCount = count;
    this.countUniform.value = count;
    this.indirectNeedsReset ||= previousCount > 0 && count === 0;
    if (count > 0) {
      markAttributeRangeUpdated(
        this.transformBuffer,
        count,
        { counter: 'treeImpostorAttributeBytesUploaded' },
      );
      markAttributeRangeUpdated(
        this.parameterBuffer,
        count,
        { counter: 'treeImpostorAttributeBytesUploaded' },
      );
      markAttributeRangeUpdated(
        this.appearanceBuffer,
        count,
        { counter: 'treeImpostorAttributeBytesUploaded' },
      );
    }
    return count;
  }

  updatePlanes(camera) {
    this.projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projectionView);
    const values = this.planeBuffer.array;
    for (let index = 0; index < 6; index += 1) {
      const plane = this.frustum.planes[index];
      const offset = index * 4;
      values[offset] = plane.normal.x;
      values[offset + 1] = plane.normal.y;
      values[offset + 2] = plane.normal.z;
      values[offset + 3] = plane.constant;
    }
    markAttributeRangeUpdated(
      this.planeBuffer,
      6,
      { counter: 'treeImpostorAttributeBytesUploaded' },
    );
  }

  submitComputes(jobs) {
    if (typeof this.renderer.compute === 'function') {
      for (const job of jobs) this.renderer.compute(job.node, job.dispatchSize);
      return;
    }
    if (this.computePending) return;
    this.computePending = (async () => {
      for (const job of jobs) {
        await this.renderer.computeAsync(job.node, job.dispatchSize);
      }
    })().catch((error) => {
      console.error('GPU impostor culling failed.', error);
    }).finally(() => {
      this.computePending = null;
    });
  }

  update(camera, origin, timestamp = 0) {
    if (this.disposed) return null;
    updateImpostorCameraUniforms(this.uniforms, camera, timestamp);
    this.originUniform.value.set(origin.x, 0, origin.z);
    if (this.recordCount === 0) {
      if (this.indirectNeedsReset) {
        this.submitComputes([{ node: this.computeReset, dispatchSize: 1 }]);
        this.indirectNeedsReset = false;
      }
      return 0;
    }

    this.updatePlanes(camera);
    this.submitComputes([
      { node: this.computeReset, dispatchSize: 1 },
      { node: this.computeCull, dispatchSize: this.recordCount },
    ]);
    return null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    for (const resource of [
      this.transformBuffer,
      this.parameterBuffer,
      this.appearanceBuffer,
      this.visibleBuffer,
      this.planeBuffer,
      this.drawBuffer,
    ]) {
      resource.dispose?.();
    }
  }
}
