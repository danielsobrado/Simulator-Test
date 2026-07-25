const COUNT_LIMITS = Object.freeze({ rocks: 8, bushes: 10, flowers: 8, steps: 8 });

export const WORKSHOP_ENVIRONMENT_LIMITS = Object.freeze({
  moundHeight: Object.freeze({ min: 0, max: 3 }),
  moundRadius: Object.freeze({ min: 0.9, max: 2.2 }),
  moundSlope: Object.freeze({ min: 0, max: 1 }),
  clusterScale: Object.freeze({ min: 0.4, max: 2 }),
  pathWidth: Object.freeze({ min: 0.6, max: 3 }),
  counts: COUNT_LIMITS,
});

function requireObject(value, field) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value;
}

function requireFinite(value, field, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}.`);
  }
  return number;
}

function requireCount(value, field, maximum) {
  return Math.trunc(requireFinite(value, field, 0, maximum));
}

function normalizeCluster(input, field, fallbackCount, maximum) {
  const cluster = requireObject(input, field);
  const { min, max } = WORKSHOP_ENVIRONMENT_LIMITS.clusterScale;
  return Object.freeze({
    count: requireCount(cluster.count ?? fallbackCount, `${field} count`, maximum),
    scale: requireFinite(cluster.scale ?? 1, `${field} scale`, min, max),
  });
}

export function normalizeEnvironment(input = {}) {
  const config = requireObject(input, 'Workshop surroundings');
  const mound = requireObject(config.mound, 'Surroundings mound');
  const path = requireObject(config.path, 'Surroundings path');
  const steps = requireObject(config.steps, 'Surroundings steps');
  const limits = WORKSHOP_ENVIRONMENT_LIMITS;

  return Object.freeze({
    enabled: config.enabled === true,
    mound: Object.freeze({
      height: requireFinite(
        mound.height ?? 1.2,
        'Mound height',
        limits.moundHeight.min,
        limits.moundHeight.max,
      ),
      radius: requireFinite(
        mound.radius ?? 1.35,
        'Mound radius',
        limits.moundRadius.min,
        limits.moundRadius.max,
      ),
      slope: requireFinite(
        mound.slope ?? 0.6,
        'Mound slope',
        limits.moundSlope.min,
        limits.moundSlope.max,
      ),
    }),
    rocks: normalizeCluster(config.rocks, 'Rocks', 4, COUNT_LIMITS.rocks),
    bushes: normalizeCluster(config.bushes, 'Bushes', 5, COUNT_LIMITS.bushes),
    flowers: normalizeCluster(config.flowers, 'Flowers', 3, COUNT_LIMITS.flowers),
    path: Object.freeze({
      enabled: path.enabled !== false,
      width: requireFinite(
        path.width ?? 1.4,
        'Path width',
        limits.pathWidth.min,
        limits.pathWidth.max,
      ),
    }),
    steps: Object.freeze({
      enabled: steps.enabled !== false,
      count: requireCount(steps.count ?? 5, 'Step count', COUNT_LIMITS.steps),
    }),
  });
}

export function serializeEnvironment(input = {}) {
  const environment = normalizeEnvironment(input);
  return {
    enabled: environment.enabled,
    mound: { ...environment.mound },
    rocks: { ...environment.rocks },
    bushes: { ...environment.bushes },
    flowers: { ...environment.flowers },
    path: { ...environment.path },
    steps: { ...environment.steps },
  };
}

export function environmentDefaultsForArchetype(archetype) {
  return archetype === 'manor' || archetype === 'tower' || archetype === 'square-tower';
}
