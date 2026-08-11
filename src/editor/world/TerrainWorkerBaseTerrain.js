import {
  AZGAAR_LEGACY_MACRO_SOURCE_KIND,
  AZGAAR_MACRO_SOURCE_KIND,
} from '../import/AzgaarMacroWorldSource.js';

const AZGAAR_LEGACY_MACRO_SOURCE_VERSION = 1;
const AZGAAR_MACRO_SOURCE_VERSION = 2;

const TERRAIN_FIELD_MAP = Object.freeze({
  heightData: 'elevation',
  biomeData: 'biomeId',
  featureData: 'featureId',
});

function cloneValue(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function legacyPayload(fields, name) {
  const payload = fields?.[name];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`Azgaar terrain worker source is missing field ${name}.`);
  }
  const { type: _type, ...legacy } = payload;
  return structuredClone(legacy);
}

/**
 * Terrain workers only need the three canonical atlas fields plus terrain and
 * river metadata. Converting v2 guidance sources to the compatible v1 shape
 * prevents every worker from receiving the much larger simulation guidance
 * payload while the main world keeps the complete v2 source.
 */
export function createTerrainWorkerBaseTerrain(baseTerrain) {
  if (!baseTerrain) return null;
  if (baseTerrain.kind !== AZGAAR_MACRO_SOURCE_KIND
      || baseTerrain.version !== AZGAAR_MACRO_SOURCE_VERSION) {
    return structuredClone(baseTerrain);
  }

  const atlas = baseTerrain.atlas;
  const fields = atlas?.fields;
  const legacyAtlas = {
    width: atlas?.width,
    height: atlas?.height,
  };
  for (const [legacyName, fieldName] of Object.entries(TERRAIN_FIELD_MAP)) {
    legacyAtlas[legacyName] = legacyPayload(fields, fieldName);
  }

  return {
    kind: AZGAAR_LEGACY_MACRO_SOURCE_KIND,
    version: AZGAAR_LEGACY_MACRO_SOURCE_VERSION,
    source: cloneValue(baseTerrain.source),
    atlas: legacyAtlas,
    physical: cloneValue(baseTerrain.physical),
    bounds: cloneValue(baseTerrain.bounds),
    oceanTransitionCells: baseTerrain.oceanTransitionCells,
    terrain: cloneValue(baseTerrain.terrain),
    biomes: cloneValue(baseTerrain.biomes),
    rivers: cloneValue(baseTerrain.rivers ?? []),
  };
}
