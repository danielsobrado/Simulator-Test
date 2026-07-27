export const WATER_DOMAIN_VERSION = 1;

export const WATER_KIND_NONE = 0;
export const WATER_KIND_OCEAN = 1;
export const WATER_KIND_LAKE = 2;
export const WATER_KIND_RIVER = 3;

export const WATER_BODY_ID_NONE = 0;
export const WATER_BODY_ID_PROCEDURAL_OCEAN = 1;
export const WATER_BODY_ID_RIVER_BASE = 1024;

export const WATER_SAMPLE_FLAG_NONE = 0;
export const WATER_SAMPLE_FLAG_INCOMPLETE_BED = 1;

export const WATER_KINDS = Object.freeze([
  WATER_KIND_NONE,
  WATER_KIND_OCEAN,
  WATER_KIND_LAKE,
  WATER_KIND_RIVER,
]);
