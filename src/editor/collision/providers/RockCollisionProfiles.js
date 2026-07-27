import {
  ROCK_COLLISION_CAPSULE_VERTICAL_RATIO,
  ROCK_COLLISION_COMPOUND_HORIZONTAL_RATIO,
  ROCK_COLLISION_SHAPE_CAPSULE,
  ROCK_COLLISION_SHAPE_COMPOUND,
  ROCK_COLLISION_SHAPE_ELLIPSOID,
  ROCK_COLLISION_SHAPE_SPHERE,
  ROCK_COLLISION_SIGNATURE_SCALE,
  ROCK_COLLISION_SPHERE_ASPECT_LIMIT,
  ROCK_COLLISION_TIER_BLOCKING,
  ROCK_COLLISION_TIER_DECORATIVE,
  ROCK_COLLISION_TIER_WALKABLE,
} from './RockCollisionConstants.js';

const AUTO = 'auto';

function finite(value, name) {
  if (!Number.isFinite(value)) throw new Error(`Rock collision ${name} must be finite.`);
  return value;
}

function positive(value, name) {
  finite(value, name);
  if (!(value > 0)) throw new Error(`Rock collision ${name} must be positive.`);
  return value;
}

function freezePart(part) {
  return Object.freeze({ ...part });
}

function readBounds(prototype, prototypeKey) {
  const geometry = prototype?.geometry;
  if (!geometry?.computeBoundingBox) {
    throw new Error(`Rock collision prototype ${prototypeKey} has no measurable geometry.`);
  }
  geometry.computeBoundingBox();
  const source = geometry.boundingBox;
  if (!source?.min || !source?.max) {
    throw new Error(`Rock collision prototype ${prototypeKey} has no bounding box.`);
  }
  const bounds = {
    minX: finite(source.min.x, `${prototypeKey}.minX`),
    minY: finite(source.min.y, `${prototypeKey}.minY`),
    minZ: finite(source.min.z, `${prototypeKey}.minZ`),
    maxX: finite(source.max.x, `${prototypeKey}.maxX`),
    maxY: finite(source.max.y, `${prototypeKey}.maxY`),
    maxZ: finite(source.max.z, `${prototypeKey}.maxZ`),
  };
  positive(bounds.maxX - bounds.minX, `${prototypeKey}.width`);
  positive(bounds.maxY - bounds.minY, `${prototypeKey}.height`);
  positive(bounds.maxZ - bounds.minZ, `${prototypeKey}.depth`);
  return bounds;
}

function overrideFor(config, prototypeKey, prototypeIndex) {
  return config.prototypeOverrides?.[prototypeKey]
    ?? config.prototypeOverrides?.[`prototype:${prototypeIndex}`]
    ?? config.prototypeOverrides?.[String(prototypeIndex)]
    ?? null;
}

function automaticShape(width, height, depth) {
  const horizontalMaximum = Math.max(width, depth);
  const horizontalMinimum = Math.min(width, depth);
  const horizontalRatio = horizontalMaximum / horizontalMinimum;
  const totalRatio = Math.max(width, height, depth) / Math.min(width, height, depth);
  if (height / horizontalMaximum >= ROCK_COLLISION_CAPSULE_VERTICAL_RATIO
      && horizontalRatio <= ROCK_COLLISION_SPHERE_ASPECT_LIMIT) {
    return ROCK_COLLISION_SHAPE_CAPSULE;
  }
  if (horizontalRatio >= ROCK_COLLISION_COMPOUND_HORIZONTAL_RATIO) {
    return ROCK_COLLISION_SHAPE_COMPOUND;
  }
  if (totalRatio <= ROCK_COLLISION_SPHERE_ASPECT_LIMIT) {
    return ROCK_COLLISION_SHAPE_SPHERE;
  }
  return ROCK_COLLISION_SHAPE_ELLIPSOID;
}

function spherePart(centerX, centerY, centerZ, width, height, depth) {
  const radius = Math.min(width, height, depth) * 0.5;
  return freezePart({
    type: ROCK_COLLISION_SHAPE_SPHERE,
    centerX,
    centerY,
    centerZ,
    radiusX: radius,
    radiusY: radius,
    radiusZ: radius,
  });
}

function ellipsoidPart(centerX, centerY, centerZ, width, height, depth) {
  return freezePart({
    type: ROCK_COLLISION_SHAPE_ELLIPSOID,
    centerX,
    centerY,
    centerZ,
    radiusX: width * 0.5,
    radiusY: height * 0.5,
    radiusZ: depth * 0.5,
  });
}

function capsulePart(centerX, centerY, centerZ, width, height, depth) {
  const radius = Math.min(width, depth) * 0.5;
  const capsuleHeight = Math.max(height, radius * 2);
  return freezePart({
    type: ROCK_COLLISION_SHAPE_CAPSULE,
    centerX,
    centerZ,
    baseY: centerY - capsuleHeight * 0.5,
    radius,
    height: capsuleHeight,
  });
}

function compoundParts(centerX, centerY, centerZ, width, height, depth) {
  const alongX = width >= depth;
  const major = alongX ? width : depth;
  const minor = alongX ? depth : width;
  const majorRadius = major / 3;
  const minorRadius = minor * 0.5;
  const offset = major / 6;
  return Object.freeze([-1, 1].map((direction) => freezePart({
    type: ROCK_COLLISION_SHAPE_ELLIPSOID,
    centerX: centerX + (alongX ? direction * offset : 0),
    centerY,
    centerZ: centerZ + (alongX ? 0 : direction * offset),
    radiusX: alongX ? majorRadius : minorRadius,
    radiusY: height * 0.5,
    radiusZ: alongX ? minorRadius : majorRadius,
  })));
}

function primitiveParts(shape, centerX, centerY, centerZ, width, height, depth) {
  if (shape === ROCK_COLLISION_SHAPE_SPHERE) {
    return Object.freeze([spherePart(centerX, centerY, centerZ, width, height, depth)]);
  }
  if (shape === ROCK_COLLISION_SHAPE_ELLIPSOID) {
    return Object.freeze([ellipsoidPart(centerX, centerY, centerZ, width, height, depth)]);
  }
  if (shape === ROCK_COLLISION_SHAPE_CAPSULE) {
    return Object.freeze([capsulePart(centerX, centerY, centerZ, width, height, depth)]);
  }
  if (shape === ROCK_COLLISION_SHAPE_COMPOUND) {
    return compoundParts(centerX, centerY, centerZ, width, height, depth);
  }
  throw new Error(`Unsupported rock collision shape: ${shape}.`);
}

function quantize(value) {
  return Math.round(value * ROCK_COLLISION_SIGNATURE_SCALE);
}

export function deriveRockCollisionProfile({ prototype, prototypeIndex, prototypeKey, config }) {
  if (!Number.isSafeInteger(prototypeIndex) || prototypeIndex < 0) {
    throw new Error('Rock collision prototype index must be a non-negative safe integer.');
  }
  const id = prototypeKey ?? `prototype:${prototypeIndex}`;
  const sourceBounds = readBounds(prototype, id);
  const override = overrideFor(config, id, prototypeIndex);
  const collisionScale = override?.collisionScale ?? 1;
  positive(collisionScale, `${id}.collisionScale`);

  const sourceWidth = sourceBounds.maxX - sourceBounds.minX;
  const sourceHeight = sourceBounds.maxY - sourceBounds.minY;
  const sourceDepth = sourceBounds.maxZ - sourceBounds.minZ;
  const width = sourceWidth * collisionScale;
  const height = sourceHeight * collisionScale;
  const depth = sourceDepth * collisionScale;
  const centerX = (sourceBounds.minX + sourceBounds.maxX) * 0.5;
  const centerY = (sourceBounds.minY + sourceBounds.maxY) * 0.5;
  const centerZ = (sourceBounds.minZ + sourceBounds.maxZ) * 0.5;
  const requestedShape = override?.shape ?? AUTO;
  const shape = requestedShape === AUTO ? automaticShape(width, height, depth) : requestedShape;
  const requestedTier = override?.tier ?? AUTO;

  return Object.freeze({
    id,
    prototypeIndex,
    sourceBounds: Object.freeze({ ...sourceBounds }),
    centerX,
    centerY,
    centerZ,
    width,
    height,
    depth,
    shape,
    forcedTier: requestedTier === AUTO ? null : requestedTier,
    collisionScale,
    parts: primitiveParts(shape, centerX, centerY, centerZ, width, height, depth),
  });
}

export function deriveRockCollisionProfiles({ prototypes, prototypeKeys, config }) {
  if (!Array.isArray(prototypes) || !Array.isArray(prototypeKeys)
      || prototypes.length !== prototypeKeys.length) {
    throw new Error('Rock collision profiles require matching prototypes and keys.');
  }
  return Object.freeze(prototypes.map((prototype, prototypeIndex) => deriveRockCollisionProfile({
    prototype,
    prototypeIndex,
    prototypeKey: prototypeKeys[prototypeIndex],
    config,
  })));
}

export function classifyRockCollision(profile, placementScale, config) {
  positive(placementScale, `${profile.id}.placementScale`);
  if (profile.forcedTier) return profile.forcedTier;
  const height = profile.height * placementScale;
  const width = Math.max(profile.width, profile.depth) * placementScale;
  if (height < config.minimumCollidableHeight || width < config.minimumCollidableWidth) {
    return ROCK_COLLISION_TIER_DECORATIVE;
  }
  if (height >= config.minimumWalkableHeight && width >= config.minimumWalkableWidth) {
    return ROCK_COLLISION_TIER_WALKABLE;
  }
  return ROCK_COLLISION_TIER_BLOCKING;
}

export function rockCollisionProfileSignature(profiles) {
  return profiles.map((profile) => [
    profile.id,
    profile.shape,
    profile.forcedTier ?? AUTO,
    quantize(profile.centerX),
    quantize(profile.centerY),
    quantize(profile.centerZ),
    quantize(profile.width),
    quantize(profile.height),
    quantize(profile.depth),
    profile.parts.length,
  ].join(':')).join('|');
}
