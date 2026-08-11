import { AZGAAR_MACRO_SOURCE_KIND } from '../import/AzgaarMacroWorldSource.js';

const AZGAAR_MACRO_SOURCE_VERSION = 2;

const TERRAIN_FIELD_NAMES = Object.freeze([
  'elevation',
  'biomeId',
  'mountainness',
  'ruggedness',
  'valleyness',
]);

function cloneValue(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function terrainFields(baseTerrain) {
  const sourceFields = baseTerrain.atlas?.fields;
  const result = {};
  for (const name of TERRAIN_FIELD_NAMES) {
    const payload = sourceFields?.[name];
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error(`Azgaar terrain worker source is missing field ${name}.`);
    }
    result[name] = structuredClone(payload);
  }
  return result;
}

/**
 * Terrain workers receive only the guidance required by chunk morphology.
 * Climate, hydrology, population and feature ids remain on the authoritative
 * main-world source, keeping worker clones and decoded resident memory bounded.
 */
export function createTerrainWorkerBaseTerrain(baseTerrain) {
  if (!baseTerrain) return null;
  if (baseTerrain.kind !== AZGAAR_MACRO_SOURCE_KIND
      || baseTerrain.version !== AZGAAR_MACRO_SOURCE_VERSION) {
    return structuredClone(baseTerrain);
  }

  return {
    kind: AZGAAR_MACRO_SOURCE_KIND,
    version: AZGAAR_MACRO_SOURCE_VERSION,
    profile: 'terrain-worker',
    source: cloneValue(baseTerrain.source),
    atlas: {
      width: baseTerrain.atlas?.width,
      height: baseTerrain.atlas?.height,
      fields: terrainFields(baseTerrain),
    },
    physical: cloneValue(baseTerrain.physical),
    bounds: cloneValue(baseTerrain.bounds),
    oceanTransitionCells: baseTerrain.oceanTransitionCells,
    terrain: cloneValue(baseTerrain.terrain),
    biomes: cloneValue(baseTerrain.biomes),
    rivers: cloneValue(baseTerrain.rivers ?? []),
  };
}

export const TERRAIN_WORKER_GUIDANCE_FIELDS = TERRAIN_FIELD_NAMES;
