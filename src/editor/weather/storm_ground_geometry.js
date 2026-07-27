import * as THREE from "three";
import { IMPACT_ROOT_COUNT } from "./storm_ground_constants.js";
function createStrikeGeometry(count) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
    -1,
    0,
    0,
    1,
    0,
    0,
    -1,
    1,
    0,
    1,
    1,
    0,
    -1,
    0,
    1,
    1,
    0,
    1,
    -1,
    1,
    1,
    1,
    1,
    1
  ]), 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([
    0,
    0,
    1,
    0,
    0,
    1,
    1,
    1,
    0,
    0,
    1,
    0,
    0,
    1,
    1,
    1
  ]), 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([
    0,
    1,
    2,
    2,
    1,
    3,
    4,
    5,
    6,
    6,
    5,
    7
  ]), 1));
  geometry.instanceCount = count;
  const buffers = {
    center: new Float32Array(count * 3),
    normal: new Float32Array(count * 3),
    params: new Float32Array(count * 4)
  };
  for (let i = 0; i < count; i++) buffers.normal[i * 3 + 1] = 1;
  setStrikeAttributes(geometry, buffers);
  return { geometry, buffers };
}
function createImpactGeometry(buffers) {
  const geometry = new THREE.InstancedBufferGeometry();
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let root = 0; root < IMPACT_ROOT_COUNT; root++) {
    const base = root * 4;
    positions.push(-1, 0, root, 1, 0, root, -1, 1, root, 1, 1, root);
    uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
    indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(indices), 1));
  geometry.instanceCount = buffers.params.length / 4;
  setStrikeAttributes(geometry, buffers);
  return geometry;
}
function markStrikeAttributesDirty(geometries) {
  for (const geometry of geometries) {
    for (const key of ["aLightningCenter", "aLightningNormal", "aLightningParams"]) {
      const attr = geometry.getAttribute(key);
      if (attr) attr.needsUpdate = true;
    }
  }
}
function setStrikeAttributes(geometry, buffers) {
  geometry.setAttribute("aLightningCenter", new THREE.InstancedBufferAttribute(buffers.center, 3));
  geometry.setAttribute("aLightningNormal", new THREE.InstancedBufferAttribute(buffers.normal, 3));
  geometry.setAttribute("aLightningParams", new THREE.InstancedBufferAttribute(buffers.params, 4));
}
export {
  createImpactGeometry,
  createStrikeGeometry,
  markStrikeAttributesDirty
};
