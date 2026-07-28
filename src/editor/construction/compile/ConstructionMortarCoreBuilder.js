import * as THREE from 'three/webgpu';
import { scaleCorners } from '../masonry/CourseLattice.js';
import { CONSTRUCTION_MORTAR_CONFIG } from '../render/ConstructionMortarConfig.js';

const VERTICES_PER_PRISM = 24;
const INDICES_PER_PRISM = 36;
const FACES_PER_PRISM = 6;
const DEGENERATE_EPSILON = 1e-6;

/**
 * Absolute expansion of a face ring in metres around its bounding-box centre.
 *
 * Uses metres, not a percentage of stone size, so joints behind large and small
 * stones stay comparable.
 */
export function expandCorners(corners, overlap, {
  maxScale = CONSTRUCTION_MORTAR_CONFIG.maxCornerScale,
} = {}) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of corners) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const scaleX = Math.min(maxScale, 1 + (overlap * 2) / Math.max(width, DEGENERATE_EPSILON));
  const scaleY = Math.min(maxScale, 1 + (overlap * 2) / Math.max(height, DEGENERATE_EPSILON));
  return scaleCorners(corners, scaleX, scaleY);
}

/** Recessed core thickness for a stone of the given depth. */
export function mortarCoreDepth(stoneDepth, config = CONSTRUCTION_MORTAR_CONFIG) {
  return Math.max(config.minimumDepth, stoneDepth - config.faceRecess * 2);
}

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function faceBounds(corners) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of corners) {
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
      return { minX: NaN, maxX: NaN, minY: NaN, maxY: NaN, width: NaN, height: NaN };
    }
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function validateDescriptor(descriptor, index) {
  if (!descriptor || !Array.isArray(descriptor.corners)) {
    throw new Error(`Mortar descriptor ${index}: corners must be an array of four [x, y] points.`);
  }
  if (descriptor.corners.length !== 4) {
    throw new Error(
      `Mortar descriptor ${index}: corner ring must have exactly four entries, got ${descriptor.corners.length}.`,
    );
  }
  if (!isFiniteNumber(descriptor.depth) || descriptor.depth <= 0) {
    throw new Error(
      `Mortar descriptor ${index}: depth must be a finite number greater than zero, got ${descriptor.depth}.`,
    );
  }
  const position = descriptor.position;
  if (
    !Array.isArray(position)
    || position.length !== 3
    || !position.every(isFiniteNumber)
  ) {
    throw new Error(`Mortar descriptor ${index}: position must be a finite [x, y, z] triple.`);
  }
  const rotation = descriptor.rotation ?? [0, 0, 0];
  if (
    !Array.isArray(rotation)
    || rotation.length !== 3
    || !rotation.every(isFiniteNumber)
  ) {
    throw new Error(`Mortar descriptor ${index}: rotation must be a finite [x, y, z] triple.`);
  }
  const bounds = faceBounds(descriptor.corners);
  if (
    !isFiniteNumber(bounds.width)
    || !isFiniteNumber(bounds.height)
    || bounds.width <= DEGENERATE_EPSILON
    || bounds.height <= DEGENERATE_EPSILON
  ) {
    throw new Error(
      `Mortar descriptor ${index}: face ring is degenerate (width=${bounds.width}, height=${bounds.height}).`,
    );
  }
  if (descriptor.uvDensity != null && !isFiniteNumber(descriptor.uvDensity)) {
    throw new Error(`Mortar descriptor ${index}: uvDensity must be finite when provided.`);
  }
}

/**
 * Write one module-level BufferGeometry of recessed mortar prisms.
 *
 * Allocates typed arrays once. Each prism uses 24 independent vertices (six
 * hard faces × four corners) so normals stay face-sharp without
 * `computeVertexNormals()`.
 *
 * @param {Array<{
 *   corners: number[][],
 *   depth: number,
 *   position: number[],
 *   rotation?: number[],
 *   uvDensity?: number,
 * }>} descriptors
 * @returns {THREE.BufferGeometry | null}
 */
export function buildMortarCoreGeometry(descriptors) {
  if (!descriptors || descriptors.length === 0) return null;

  for (let index = 0; index < descriptors.length; index += 1) {
    validateDescriptor(descriptors[index], index);
  }

  const prismCount = descriptors.length;
  const vertexCount = prismCount * VERTICES_PER_PRISM;
  const indexCount = prismCount * INDICES_PER_PRISM;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = vertexCount <= 65_535
    ? new Uint16Array(indexCount)
    : new Uint32Array(indexCount);

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const translation = new THREE.Vector3();
  const scale = new THREE.Vector3(1, 1, 1);
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();

  let vertexOffset = 0;
  let indexOffset = 0;

  for (let prismIndex = 0; prismIndex < prismCount; prismIndex += 1) {
    const descriptor = descriptors[prismIndex];
    const corners = descriptor.corners;
    const halfDepth = descriptor.depth / 2;
    const uvDensity = descriptor.uvDensity ?? CONSTRUCTION_MORTAR_CONFIG.uvDensity;
    const rotation = descriptor.rotation ?? [0, 0, 0];

    euler.set(rotation[0], rotation[1], rotation[2], 'XYZ');
    quaternion.setFromEuler(euler);
    translation.set(descriptor.position[0], descriptor.position[1], descriptor.position[2]);
    matrix.compose(translation, quaternion, scale);

    // Front ring at +z, back ring at -z (stone-local, before transform).
    const local = [
      // front: bottom-left, bottom-right, top-right, top-left
      [corners[0][0], corners[0][1], halfDepth],
      [corners[1][0], corners[1][1], halfDepth],
      [corners[2][0], corners[2][1], halfDepth],
      [corners[3][0], corners[3][1], halfDepth],
      // back
      [corners[0][0], corners[0][1], -halfDepth],
      [corners[1][0], corners[1][1], -halfDepth],
      [corners[2][0], corners[2][1], -halfDepth],
      [corners[3][0], corners[3][1], -halfDepth],
    ];

    // Six faces as corner index quads (CCW from outside).
    const faces = [
      { corners: [0, 1, 2, 3], normal: [0, 0, 1], uv: 'front' }, // front
      { corners: [5, 4, 7, 6], normal: [0, 0, -1], uv: 'back' }, // back
      { corners: [4, 0, 3, 7], normal: [-1, 0, 0], uv: 'side' }, // left
      { corners: [1, 5, 6, 2], normal: [1, 0, 0], uv: 'side' }, // right
      { corners: [3, 2, 6, 7], normal: [0, 1, 0], uv: 'top' }, // top
      { corners: [4, 5, 1, 0], normal: [0, -1, 0], uv: 'bottom' }, // bottom
    ];

    const baseVertex = vertexOffset;
    for (let faceIndex = 0; faceIndex < FACES_PER_PRISM; faceIndex += 1) {
      const face = faces[faceIndex];
      normal.set(face.normal[0], face.normal[1], face.normal[2]).applyQuaternion(quaternion);
      const nx = normal.x;
      const ny = normal.y;
      const nz = normal.z;

      for (let cornerIndex = 0; cornerIndex < 4; cornerIndex += 1) {
        const localPoint = local[face.corners[cornerIndex]];
        point.set(localPoint[0], localPoint[1], localPoint[2]).applyMatrix4(matrix);
        const vertex = vertexOffset;
        positions[vertex * 3] = point.x;
        positions[vertex * 3 + 1] = point.y;
        positions[vertex * 3 + 2] = point.z;
        normals[vertex * 3] = nx;
        normals[vertex * 3 + 1] = ny;
        normals[vertex * 3 + 2] = nz;

        let u;
        let v;
        if (face.uv === 'front' || face.uv === 'back') {
          u = localPoint[0] * uvDensity;
          v = localPoint[1] * uvDensity;
        } else if (face.uv === 'side') {
          u = localPoint[2] * uvDensity;
          v = localPoint[1] * uvDensity;
        } else {
          u = localPoint[0] * uvDensity;
          v = localPoint[2] * uvDensity;
        }
        uvs[vertex * 2] = u;
        uvs[vertex * 2 + 1] = v;
        vertexOffset += 1;
      }

      const faceBase = baseVertex + faceIndex * 4;
      indices[indexOffset++] = faceBase;
      indices[indexOffset++] = faceBase + 1;
      indices[indexOffset++] = faceBase + 2;
      indices[indexOffset++] = faceBase;
      indices[indexOffset++] = faceBase + 2;
      indices[indexOffset++] = faceBase + 3;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.mortarPrisms = prismCount;
  geometry.userData.mortarTriangles = prismCount * 12;
  return geometry;
}
