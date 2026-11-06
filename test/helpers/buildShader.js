import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { lights } from 'three/tsl';

/** Real WGSL generation without a device; this does not replace driver QA. */
export function shaderTestRenderer({ forceWebGL = false } = {}) {
  const renderer = new THREE.WebGPURenderer({ forceWebGL, canvas: {
    width: 64, height: 64, style: {}, addEventListener() {}, removeEventListener() {},
  } });
  renderer.hasFeature = () => false;
  renderer.hasCompatibility = () => true;
  renderer.backend.capabilities ??= {};
  renderer.backend.capabilities.getUniformBufferLimit = () => 65536;
  renderer._bindings = { getSharedBindGroup: group => group };
  if (forceWebGL) renderer.backend.extensions = { has: () => false };
  return renderer;
}

export function buildShader(mesh, renderer = shaderTestRenderer(), sun = new THREE.DirectionalLight()) {
  const builder = renderer.backend.createNodeBuilder(mesh, renderer);
  builder.camera = new THREE.PerspectiveCamera();
  builder.scene = new THREE.Scene();
  builder.lightsNode = lights([sun]);
  builder.build();
  assert.ok(renderer.backend.isWebGPUBackend
    ? builder.fragmentShader.includes('@fragment') : builder.fragmentShader.includes('#version 300 es'));
  assert.doesNotMatch(builder.fragmentShader, /\b(?:NaN|undefined)\b/);
  return builder;
}
