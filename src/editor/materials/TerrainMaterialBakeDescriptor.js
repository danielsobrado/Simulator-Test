import {
  TERRAIN_MATERIAL_BAKE_QUALITY_TIERS,
  TERRAIN_MATERIAL_BAKE_REVISION_FIELDS,
  TERRAIN_MATERIAL_BAKE_SCHEMA_VERSION,
} from './TerrainMaterialBakeConstants.js';

function assertCoordinate(value, path) {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Invalid terrain material bake descriptor: ${path} must be a safe integer.`);
  }
}

function assertQuality(value) {
  if (!TERRAIN_MATERIAL_BAKE_QUALITY_TIERS.includes(value)) {
    throw new Error(
      `Invalid terrain material bake descriptor: quality must be one of `
      + `${TERRAIN_MATERIAL_BAKE_QUALITY_TIERS.join(', ')}.`,
    );
  }
}

function normalizeRevisions(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('Invalid terrain material bake descriptor: revisions must be an object.');
  }
  const revisions = {};
  for (const field of TERRAIN_MATERIAL_BAKE_REVISION_FIELDS) {
    const value = source[field];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(
        `Invalid terrain material bake descriptor: revisions.${field} must be a non-negative safe integer.`,
      );
    }
    revisions[field] = value;
  }
  return Object.freeze(revisions);
}

export function terrainMaterialBakeKey(descriptor) {
  const revisionKey = TERRAIN_MATERIAL_BAKE_REVISION_FIELDS
    .map((field) => descriptor.revisions[field])
    .join('.');
  return `terrain-material:v${TERRAIN_MATERIAL_BAKE_SCHEMA_VERSION}`
    + `:${descriptor.quality}:${descriptor.chunkX}:${descriptor.chunkZ}:${revisionKey}`;
}

export function createTerrainMaterialBakeDescriptor({
  chunkX,
  chunkZ,
  quality,
  revisions,
}) {
  assertCoordinate(chunkX, 'chunkX');
  assertCoordinate(chunkZ, 'chunkZ');
  assertQuality(quality);

  const descriptor = {
    schemaVersion: TERRAIN_MATERIAL_BAKE_SCHEMA_VERSION,
    chunkX,
    chunkZ,
    quality,
    revisions: normalizeRevisions(revisions),
  };
  descriptor.key = terrainMaterialBakeKey(descriptor);
  return Object.freeze(descriptor);
}

export function sameTerrainMaterialBakeSource(left, right) {
  if (!left || !right) return false;
  if (left.schemaVersion !== right.schemaVersion
      || left.chunkX !== right.chunkX
      || left.chunkZ !== right.chunkZ
      || left.quality !== right.quality) {
    return false;
  }
  return TERRAIN_MATERIAL_BAKE_REVISION_FIELDS.every(
    (field) => left.revisions[field] === right.revisions[field],
  );
}

export function terrainMaterialBakeNeedsRefresh(cached, requested) {
  return !sameTerrainMaterialBakeSource(cached, requested);
}
