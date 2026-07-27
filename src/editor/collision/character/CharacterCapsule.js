const MINIMUM_CAPSULE_HEIGHT_EPSILON = 1e-6;

function assertFinite(value, name) {
  if (!Number.isFinite(value)) throw new Error(`Character capsule ${name} must be finite.`);
}

export function createCharacterCapsule({
  x,
  y,
  z,
  radius,
  bodyHeight,
}) {
  for (const [name, value] of Object.entries({ x, y, z, radius, bodyHeight })) {
    assertFinite(value, name);
  }
  if (!(radius > 0)) throw new Error('Character capsule radius must be positive.');
  if (!(bodyHeight > radius * 2 + MINIMUM_CAPSULE_HEIGHT_EPSILON)) {
    throw new Error('Character capsule bodyHeight must exceed its diameter.');
  }
  return Object.freeze({
    x,
    y,
    z,
    radius,
    bodyHeight,
    segmentMinY: y + radius,
    segmentMaxY: y + bodyHeight - radius,
  });
}

export function moveCharacterCapsule(capsule, x, y, z) {
  return createCharacterCapsule({
    x,
    y,
    z,
    radius: capsule.radius,
    bodyHeight: capsule.bodyHeight,
  });
}

export function characterCapsuleAabb(capsule, padding = 0) {
  if (!Number.isFinite(padding) || padding < 0) {
    throw new Error('Character capsule AABB padding must be non-negative.');
  }
  const extent = capsule.radius + padding;
  return Object.freeze({
    minX: capsule.x - extent,
    maxX: capsule.x + extent,
    minY: capsule.y - padding,
    maxY: capsule.y + capsule.bodyHeight + padding,
    minZ: capsule.z - extent,
    maxZ: capsule.z + extent,
  });
}
