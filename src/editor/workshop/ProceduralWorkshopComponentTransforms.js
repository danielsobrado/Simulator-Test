const MAX_COMPONENT_TRANSFORMS = 96;
const COMPONENT_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const POSITION_LIMIT = 32;
const SCALE_MIN = 0.1;
const SCALE_MAX = 4;
const IDENTITY_EPSILON = 1e-6;
const ANGLE_EPSILON = 1e-12;

const IDENTITY_POSITION = Object.freeze([0, 0, 0]);
const IDENTITY_ROTATION = Object.freeze([0, 0, 0]);
const IDENTITY_SCALE = Object.freeze([1, 1, 1]);

function requireObject(value, field) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value;
}

function strictNumber(value) {
  return typeof value === 'number' ? value : Number.NaN;
}

function normalizeAngle(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('Component rotation values must be finite numbers.');
  }
  const angle = Math.atan2(Math.sin(value), Math.cos(value));
  if (Math.abs(Math.abs(angle) - Math.PI) <= ANGLE_EPSILON) return Math.PI;
  return Math.abs(angle) <= ANGLE_EPSILON ? 0 : angle;
}

function normalizeVector(input, field, fallback, minimum, maximum, mapper = strictNumber) {
  if (input == null) return Object.freeze([...fallback]);
  if (!Array.isArray(input) || input.length !== 3) {
    throw new Error(`${field} must contain exactly three values.`);
  }
  const values = input.map((value) => mapper(value));
  if (values.some((value) => !Number.isFinite(value) || value < minimum || value > maximum)) {
    throw new Error(`${field} values must be between ${minimum} and ${maximum} and be finite numbers.`);
  }
  return Object.freeze(values);
}

function isNear(left, right) {
  return Math.abs(left - right) <= IDENTITY_EPSILON;
}

function compareKey(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function componentOrder([left], [right]) {
  return compareKey(left, right);
}

export function isIdentityComponentTransform(transform) {
  return transform.position.every((value) => isNear(value, 0))
    && transform.rotation.every((value) => isNear(value, 0))
    && transform.scale.every((value) => isNear(value, 1));
}

export function createIdentityComponentTransform() {
  return Object.freeze({
    position: IDENTITY_POSITION,
    rotation: IDENTITY_ROTATION,
    scale: IDENTITY_SCALE,
  });
}

export function normalizeComponentTransform(input = {}) {
  const value = requireObject(input, 'Component transform');
  return Object.freeze({
    position: normalizeVector(
      value.position,
      'Component position',
      IDENTITY_POSITION,
      -POSITION_LIMIT,
      POSITION_LIMIT,
    ),
    rotation: normalizeVector(
      value.rotation,
      'Component rotation',
      IDENTITY_ROTATION,
      -Math.PI,
      Math.PI,
      normalizeAngle,
    ),
    scale: normalizeVector(
      value.scale,
      'Component scale',
      IDENTITY_SCALE,
      SCALE_MIN,
      SCALE_MAX,
    ),
  });
}

export function normalizeComponentTransforms(input = {}) {
  const values = requireObject(input, 'Workshop component transforms');
  const entries = Object.entries(values).sort(componentOrder);
  if (entries.length > MAX_COMPONENT_TRANSFORMS) {
    throw new Error(`The workshop supports at most ${MAX_COMPONENT_TRANSFORMS} edited components.`);
  }

  const result = {};
  for (const [componentId, transformInput] of entries) {
    if (!COMPONENT_ID_PATTERN.test(componentId)) {
      throw new Error(`Invalid workshop component id: ${componentId}.`);
    }
    const transform = normalizeComponentTransform(transformInput);
    if (!isIdentityComponentTransform(transform)) {
      result[componentId] = transform;
    }
  }
  return Object.freeze(result);
}

export function filterComponentTransforms(input = {}, componentIds = new Set()) {
  const normalized = normalizeComponentTransforms(input);
  const result = {};
  for (const [componentId, transform] of Object.entries(normalized)) {
    if (componentIds.has(componentId)) result[componentId] = transform;
  }
  return Object.freeze(result);
}

export function serializeComponentTransforms(input = {}) {
  const normalized = normalizeComponentTransforms(input);
  return Object.fromEntries(
    Object.entries(normalized).map(([componentId, transform]) => [componentId, {
      position: [...transform.position],
      rotation: [...transform.rotation],
      scale: [...transform.scale],
    }]),
  );
}

export function getComponentTransform(input, componentId) {
  return input?.[componentId] ?? createIdentityComponentTransform();
}

export const WORKSHOP_COMPONENT_TRANSFORM_LIMITS = Object.freeze({
  maxCount: MAX_COMPONENT_TRANSFORMS,
  position: POSITION_LIMIT,
  scaleMin: SCALE_MIN,
  scaleMax: SCALE_MAX,
});