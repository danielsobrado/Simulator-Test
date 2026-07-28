import { Box3, Matrix4, Quaternion, Vector3 } from 'three';

const EPSILON = 1e-6;
const MATRIX_ELEMENTS = 16;
const TRANSFORM_CACHE = new WeakMap();

const LOCAL_BOX = new Box3();
const WORLD_BOX = new Box3();
const POSITION = new Vector3();
const QUATERNION = new Quaternion();
const SCALE = new Vector3();

function matrixFromArray(transform) {
  if (!Array.isArray(transform) || transform.length !== MATRIX_ELEMENTS
      || transform.some((value) => !Number.isFinite(value))) {
    throw new Error('Mesh collider transform must contain 16 finite values.');
  }
  return new Matrix4().fromArray(transform);
}

export function createMeshInstanceTransform(transform) {
  const cached = Object.isFrozen(transform) ? TRANSFORM_CACHE.get(transform) : null;
  if (cached) return cached;

  const matrix = matrixFromArray(transform);
  matrix.decompose(POSITION, QUATERNION, SCALE);
  const uniformScale = (SCALE.x + SCALE.y + SCALE.z) / 3;
  if (!(SCALE.x > EPSILON) || !(SCALE.y > EPSILON) || !(SCALE.z > EPSILON)
      || Math.abs(SCALE.x - uniformScale) > EPSILON
      || Math.abs(SCALE.y - uniformScale) > EPSILON
      || Math.abs(SCALE.z - uniformScale) > EPSILON) {
    throw new Error('Mesh collider instances require a positive uniform scale.');
  }
  const inverse = matrix.clone().invert();
  const resolved = Object.freeze({ matrix, inverse, scale: uniformScale });
  if (Object.isFrozen(transform)) TRANSFORM_CACHE.set(transform, resolved);
  return resolved;
}

export function transformPrototypeBounds(bounds, matrix) {
  LOCAL_BOX.min.set(bounds.minX, bounds.minY, bounds.minZ);
  LOCAL_BOX.max.set(bounds.maxX, bounds.maxY, bounds.maxZ);
  WORLD_BOX.copy(LOCAL_BOX).applyMatrix4(matrix);
  return Object.freeze({
    minX: WORLD_BOX.min.x,
    minY: WORLD_BOX.min.y,
    minZ: WORLD_BOX.min.z,
    maxX: WORLD_BOX.max.x,
    maxY: WORLD_BOX.max.y,
    maxZ: WORLD_BOX.max.z,
  });
}

export function composeUniformTransform({ x, y, z, rotationY = 0, scale = 1 }) {
  if (![x, y, z, rotationY, scale].every(Number.isFinite) || !(scale > 0)) {
    throw new Error('Mesh collider placement transform must be finite with positive scale.');
  }
  const matrix = new Matrix4().compose(
    new Vector3(x, y, z),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rotationY),
    new Vector3(scale, scale, scale),
  );
  return Object.freeze(matrix.toArray());
}
