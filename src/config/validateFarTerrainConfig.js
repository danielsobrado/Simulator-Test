const MAX_RADIAL_RESOLUTION = 2048;
const MAX_ANGULAR_RESOLUTION = 4096;
const MAX_VERTEX_COUNT = 1_000_000;

function optionalFinite(value, field, { minimum = -Infinity, exclusiveMinimum = false } = {}) {
  if (value === undefined) return;
  if (!Number.isFinite(value)
      || (exclusiveMinimum ? value <= minimum : value < minimum)) {
    const relation = exclusiveMinimum ? 'greater than' : 'at least';
    throw new Error(
      `Invalid editor configuration: world.farTerrain.${field} must be finite and ${relation} ${minimum}.`,
    );
  }
}

function optionalInteger(value, field, minimum, maximum) {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `Invalid editor configuration: world.farTerrain.${field} must be an integer from ${minimum} to ${maximum}.`,
    );
  }
}

export function validateFarTerrainConfig(farTerrain) {
  if (farTerrain === undefined) return;
  if (!farTerrain || typeof farTerrain !== 'object' || Array.isArray(farTerrain)) {
    throw new Error('Invalid editor configuration: world.farTerrain must be an object.');
  }

  optionalInteger(farTerrain.resolution, 'resolution', 2, MAX_RADIAL_RESOLUTION);
  optionalInteger(
    farTerrain.radialResolution,
    'radialResolution',
    2,
    MAX_RADIAL_RESOLUTION,
  );
  optionalInteger(
    farTerrain.angularResolution,
    'angularResolution',
    8,
    MAX_ANGULAR_RESOLUTION,
  );

  const radialResolution = farTerrain.radialResolution ?? farTerrain.resolution;
  if (radialResolution !== undefined && farTerrain.angularResolution !== undefined
      && radialResolution * farTerrain.angularResolution > MAX_VERTEX_COUNT) {
    throw new Error(
      `Invalid editor configuration: world.farTerrain grid must not exceed ${MAX_VERTEX_COUNT} vertices.`,
    );
  }

  optionalFinite(farTerrain.snowLine, 'snowLine');
  optionalFinite(farTerrain.rockSlopeStart, 'rockSlopeStart', { minimum: 0 });
  optionalFinite(farTerrain.rockSlopeFull, 'rockSlopeFull', { minimum: 0 });
  optionalFinite(farTerrain.radialFalloff, 'radialFalloff', { minimum: 1 });

  if (farTerrain.rockSlopeStart !== undefined && farTerrain.rockSlopeFull !== undefined
      && farTerrain.rockSlopeFull <= farTerrain.rockSlopeStart) {
    throw new Error(
      'Invalid editor configuration: world.farTerrain.rockSlopeFull must exceed rockSlopeStart.',
    );
  }
}

export const FAR_TERRAIN_CONFIG_LIMITS = Object.freeze({
  maxRadialResolution: MAX_RADIAL_RESOLUTION,
  maxAngularResolution: MAX_ANGULAR_RESOLUTION,
  maxVertexCount: MAX_VERTEX_COUNT,
});
