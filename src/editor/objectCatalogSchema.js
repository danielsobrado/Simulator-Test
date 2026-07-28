import {
  OBJECT_COLLISION_POLICIES,
  defaultObjectCollisionPolicy,
} from './ObjectCollisionPolicy.js';

const REQUIRED_STRING_FIELDS = Object.freeze(['key', 'label', 'icon', 'category', 'color', 'model']);
const FOUNDATION_MODES = new Set(['conform', 'terrace']);

function requirePositiveInteger(value, fieldName, key) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Object ${key} has an invalid ${fieldName}.`);
  }
}

function requireFiniteRange(value, fieldName, key, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`Object ${key} has an invalid ${fieldName}.`);
  }
}

function createFoundation(rawFoundation, rawDefinition) {
  const key = rawDefinition.key;
  if (!rawFoundation || !FOUNDATION_MODES.has(rawFoundation.mode)) {
    throw new Error(`Object ${key} has an invalid foundation mode.`);
  }

  requireFiniteRange(rawFoundation.maxSlopeDegrees, 'maximum slope', key, 0, 89);
  requireFiniteRange(rawFoundation.maxDepth, 'maximum foundation depth', key, 0, Number.MAX_SAFE_INTEGER);

  if (typeof rawFoundation.alignToNormal !== 'boolean') {
    throw new Error(`Object ${key} has an invalid alignToNormal value.`);
  }
  if (typeof rawFoundation.color !== 'string' || rawFoundation.color.trim() === '') {
    throw new Error(`Object ${key} has an invalid foundation color.`);
  }

  return Object.freeze({
    mode: rawFoundation.mode,
    maxSlopeDegrees: rawFoundation.maxSlopeDegrees,
    maxDepth: rawFoundation.maxDepth,
    alignToNormal: rawFoundation.alignToNormal,
    color: rawFoundation.color,
  });
}

function createVector(raw, fallback, key, field, positive) {
  const source = raw ?? fallback;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error(`Object ${key} has an invalid collision ${field}.`);
  }
  const vector = {};
  for (const axis of ['x', 'y', 'z']) {
    const value = source[axis];
    if (!Number.isFinite(value) || (positive && value <= 0)) {
      throw new Error(`Object ${key} has an invalid collision ${field}.${axis}.`);
    }
    vector[axis] = value;
  }
  return Object.freeze(vector);
}

function createCollision(rawCollision, rawDefinition) {
  const key = rawDefinition.key;
  const raw = rawCollision ?? {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Object ${key} has an invalid collision configuration.`);
  }
  const policy = raw.policy ?? defaultObjectCollisionPolicy(rawDefinition);
  if (!OBJECT_COLLISION_POLICIES.has(policy)) {
    throw new Error(`Object ${key} has an invalid collision policy.`);
  }
  if (raw.profile !== undefined
      && (typeof raw.profile !== 'string' || raw.profile.trim() === '')) {
    throw new Error(`Object ${key} has an invalid collision profile.`);
  }
  if (raw.allowFootprintOverflow !== undefined
      && typeof raw.allowFootprintOverflow !== 'boolean') {
    throw new Error(`Object ${key} has an invalid collision footprint-overflow flag.`);
  }
  return Object.freeze({
    policy,
    profile: raw.profile ?? rawDefinition.model,
    allowFootprintOverflow: raw.allowFootprintOverflow ?? false,
    scale: createVector(raw.scale, { x: 1, y: 1, z: 1 }, key, 'scale', true),
    offset: createVector(raw.offset, { x: 0, y: 0, z: 0 }, key, 'offset', false),
  });
}

export function createObjectCatalog(rawDefinitions, tileByKey) {
  if (!Array.isArray(rawDefinitions) || rawDefinitions.length === 0) {
    throw new Error('Object catalog must contain at least one definition.');
  }

  const keys = new Set();
  const catalog = rawDefinitions.map((rawDefinition) => {
    for (const field of REQUIRED_STRING_FIELDS) {
      if (typeof rawDefinition?.[field] !== 'string' || rawDefinition[field].trim() === '') {
        throw new Error(`Object definition is missing ${field}.`);
      }
    }

    if (keys.has(rawDefinition.key)) {
      throw new Error(`Duplicate object key: ${rawDefinition.key}.`);
    }
    keys.add(rawDefinition.key);

    requirePositiveInteger(rawDefinition.footprint?.width, 'footprint width', rawDefinition.key);
    requirePositiveInteger(rawDefinition.footprint?.depth, 'footprint depth', rawDefinition.key);

    if (!Array.isArray(rawDefinition.allowedTerrain) || rawDefinition.allowedTerrain.length === 0) {
      throw new Error(`Object ${rawDefinition.key} must allow at least one terrain type.`);
    }

    const allowedTileIds = rawDefinition.allowedTerrain.map((terrainKey) => {
      const tile = tileByKey.get(terrainKey);
      if (!tile) {
        throw new Error(`Object ${rawDefinition.key} references unknown terrain ${terrainKey}.`);
      }
      return tile.id;
    });
    const allowedTerrainClasses = rawDefinition.allowedTerrain.map(
      (terrainKey) => tileByKey.get(terrainKey)?.terrainClass,
    ).filter(Boolean);

    return Object.freeze({
      key: rawDefinition.key,
      label: rawDefinition.label,
      icon: rawDefinition.icon,
      category: rawDefinition.category,
      color: rawDefinition.color,
      model: rawDefinition.model,
      footprint: Object.freeze({
        width: rawDefinition.footprint.width,
        depth: rawDefinition.footprint.depth,
      }),
      foundation: createFoundation(rawDefinition.foundation, rawDefinition),
      collision: createCollision(rawDefinition.collision, rawDefinition),
      allowedTileIds: Object.freeze(allowedTileIds),
      allowedTerrainClasses: Object.freeze([...new Set(allowedTerrainClasses)]),
    });
  });

  return Object.freeze(catalog);
}
