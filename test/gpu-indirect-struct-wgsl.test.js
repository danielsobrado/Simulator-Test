import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { Fn, atomicStore, storage, struct, uint } from 'three/tsl';

// r187 binds struct storage buffers as arrays, so the indirect draw structs in
// GpuVoxelChunk and GpuTreeImpostorBatch must index element 0 explicitly.
test('indirect draw struct storage compiles as an indexed array element', () => {
  const renderer = new THREE.WebGPURenderer({ canvas: {
    width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {},
  } });
  renderer.hasFeature = () => false;
  renderer.hasCompatibility = () => true;
  renderer.backend.capabilities.getUniformBufferLimit = () => 65536;
  renderer._bindings = { getSharedBindGroup: group => group };
  const buffer = new THREE.IndirectStorageBufferAttribute(new Uint32Array(5), 5);
  const draw = storage(buffer, struct({
    vertexCount: { type: 'uint', atomic: true }, instanceCount: 'uint',
  }, 'DrawArgs'), buffer.count);
  const builder = renderer.backend.createNodeBuilder(null, renderer);
  builder.compute = Fn(() => {
    atomicStore(draw.element(0).get('vertexCount'), uint(0));
    draw.element(0).get('instanceCount').assign(uint(1));
  })().compute(1);
  builder.build();
  assert.match(builder.computeShader, /\[\s*0u?\s*\]\.vertexCount/);
  assert.doesNotMatch(builder.computeShader, /value\.vertexCount/);
});
