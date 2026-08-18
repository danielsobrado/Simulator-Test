export const TERRAIN_MATERIAL_BAKE_SCHEMA_VERSION = 1;

export const TERRAIN_MATERIAL_BAKE_QUALITY_TIERS = Object.freeze([
  'low',
  'balanced',
  'high',
]);

export const TERRAIN_MATERIAL_BAKE_CHANNELS = Object.freeze([
  'macroTint',
  'terrainShape',
  'materialWeights',
  'wetnessShoreline',
  'farColor',
  'farNormal',
  'canopyWater',
]);

export const TERRAIN_MATERIAL_BAKE_FORMAT_BYTES = Object.freeze({
  r8unorm: 1,
  rg8unorm: 2,
  rg8snorm: 2,
  rgba8unorm: 4,
  'rgba8unorm-srgb': 4,
  rg16float: 4,
});

export const TERRAIN_MATERIAL_BAKE_DEBUG_VIEWS = Object.freeze([
  'final',
  ...TERRAIN_MATERIAL_BAKE_CHANNELS,
]);

export const TERRAIN_MATERIAL_BAKE_REVISION_FIELDS = Object.freeze([
  'world',
  'tile',
  'height',
  'water',
  'canopy',
]);
