const DEBUG_KEYS = Object.freeze(['colliders', 'broadphase', 'support', 'contacts']);
const TRUE_VALUES = new Set(['', '1', 'true', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'off']);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const COLLISION_CONFIG_DEFAULTS = deepFreeze({
  enabled: false,
  schemaVersion: 1,
  streaming: {
    residentRadius: 1,
    unloadRadius: 2,
    prefetchSeconds: 0.5,
    buildsPerFrame: 1,
    buildBudgetMs: 2,
    binSize: 12,
  },
  player: {
    radius: 0.35,
    bodyHeight: 1.8,
    skinWidth: 0.03,
    maxSlopeDegrees: 50,
    maxSubstepDistance: 0.35,
    maxIterations: 4,
  },
  trees: {
    enabled: true,
    minimumTrunkRadius: 0.16,
  },
  rocks: {
    enabled: true,
    minimumCollidableHeight: 0.3,
    minimumWalkableHeight: 0.7,
    maximumProxyTriangles: 96,
  },
  objects: {
    enabled: true,
  },
  constructions: {
    enabled: true,
    curveSegmentLength: 1.25,
  },
  debug: {
    colliders: false,
    broadphase: false,
    support: false,
    contacts: false,
  },
});

function assertObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid collision configuration: ${path} must be an object.`);
  }
}

function assertBoolean(value, path) {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid collision configuration: ${path} must be boolean.`);
  }
}

function assertPositive(value, path) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid collision configuration: ${path} must be positive.`);
  }
}

function assertNonNegativeInteger(value, path) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid collision configuration: ${path} must be a non-negative integer.`);
  }
}

function assertPositiveInteger(value, path) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid collision configuration: ${path} must be a positive integer.`);
  }
}

export function validateCollisionConfig(config) {
  assertObject(config, 'collision');
  assertBoolean(config.enabled, 'collision.enabled');
  if (config.schemaVersion !== 1) {
    throw new Error('Invalid collision configuration: collision.schemaVersion must be 1.');
  }

  assertObject(config.streaming, 'collision.streaming');
  assertNonNegativeInteger(config.streaming.residentRadius, 'collision.streaming.residentRadius');
  assertNonNegativeInteger(config.streaming.unloadRadius, 'collision.streaming.unloadRadius');
  if (config.streaming.unloadRadius < config.streaming.residentRadius) {
    throw new Error(
      'Invalid collision configuration: collision.streaming.unloadRadius must cover residentRadius.',
    );
  }
  assertPositive(config.streaming.prefetchSeconds, 'collision.streaming.prefetchSeconds');
  assertPositiveInteger(config.streaming.buildsPerFrame, 'collision.streaming.buildsPerFrame');
  assertPositive(config.streaming.buildBudgetMs, 'collision.streaming.buildBudgetMs');
  assertPositive(config.streaming.binSize, 'collision.streaming.binSize');

  assertObject(config.player, 'collision.player');
  for (const field of ['radius', 'bodyHeight', 'skinWidth', 'maxSubstepDistance']) {
    assertPositive(config.player[field], `collision.player.${field}`);
  }
  assertPositiveInteger(config.player.maxIterations, 'collision.player.maxIterations');
  if (!Number.isFinite(config.player.maxSlopeDegrees)
      || config.player.maxSlopeDegrees <= 0
      || config.player.maxSlopeDegrees >= 90) {
    throw new Error(
      'Invalid collision configuration: collision.player.maxSlopeDegrees must be within (0, 90).',
    );
  }
  if (config.player.bodyHeight <= config.player.radius * 2) {
    throw new Error(
      'Invalid collision configuration: collision.player.bodyHeight must exceed the capsule diameter.',
    );
  }

  for (const section of ['trees', 'rocks', 'objects', 'constructions']) {
    assertObject(config[section], `collision.${section}`);
    assertBoolean(config[section].enabled, `collision.${section}.enabled`);
  }
  assertPositive(config.trees.minimumTrunkRadius, 'collision.trees.minimumTrunkRadius');
  assertPositive(config.rocks.minimumCollidableHeight, 'collision.rocks.minimumCollidableHeight');
  assertPositive(config.rocks.minimumWalkableHeight, 'collision.rocks.minimumWalkableHeight');
  if (config.rocks.minimumWalkableHeight < config.rocks.minimumCollidableHeight) {
    throw new Error(
      'Invalid collision configuration: collision.rocks.minimumWalkableHeight must not be below minimumCollidableHeight.',
    );
  }
  assertPositiveInteger(config.rocks.maximumProxyTriangles, 'collision.rocks.maximumProxyTriangles');
  assertPositive(config.constructions.curveSegmentLength, 'collision.constructions.curveSegmentLength');

  assertObject(config.debug, 'collision.debug');
  for (const key of DEBUG_KEYS) assertBoolean(config.debug[key], `collision.debug.${key}`);
  return config;
}

function mergeCollisionConfig(input = {}) {
  assertObject(input, 'collision');
  return {
    ...COLLISION_CONFIG_DEFAULTS,
    ...input,
    streaming: { ...COLLISION_CONFIG_DEFAULTS.streaming, ...(input.streaming ?? {}) },
    player: { ...COLLISION_CONFIG_DEFAULTS.player, ...(input.player ?? {}) },
    trees: { ...COLLISION_CONFIG_DEFAULTS.trees, ...(input.trees ?? {}) },
    rocks: { ...COLLISION_CONFIG_DEFAULTS.rocks, ...(input.rocks ?? {}) },
    objects: { ...COLLISION_CONFIG_DEFAULTS.objects, ...(input.objects ?? {}) },
    constructions: {
      ...COLLISION_CONFIG_DEFAULTS.constructions,
      ...(input.constructions ?? {}),
    },
    debug: { ...COLLISION_CONFIG_DEFAULTS.debug, ...(input.debug ?? {}) },
  };
}

function readBooleanOverride(params, name) {
  if (!params.has(name)) return null;
  const value = params.get(name)?.trim().toLowerCase() ?? '';
  if (TRUE_VALUES.has(value)) return true;
  if (FALSE_VALUES.has(value)) return false;
  return null;
}

function applyDebugOverrides(config, search) {
  const params = new URLSearchParams(
    typeof search === 'string' && search.startsWith('?') ? search.slice(1) : (search ?? ''),
  );
  const debug = { ...config.debug };
  const requested = new Set(
    (params.get('collisionDebug') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (requested.has('all')) {
    for (const key of DEBUG_KEYS) debug[key] = true;
  } else {
    for (const key of DEBUG_KEYS) {
      if (requested.has(key)) debug[key] = true;
    }
  }

  for (const key of DEBUG_KEYS) {
    const parameter = `collision${key[0].toUpperCase()}${key.slice(1)}`;
    const override = readBooleanOverride(params, parameter);
    if (override !== null) debug[key] = override;
  }
  return { ...config, debug };
}

export function createCollisionConfig(input = {}, search = '') {
  const resolved = applyDebugOverrides(mergeCollisionConfig(input), search);
  validateCollisionConfig(resolved);
  return deepFreeze(resolved);
}
