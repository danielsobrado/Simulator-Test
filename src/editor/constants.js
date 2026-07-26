/** Current native world document version is INFINITE_WORLD_FORMAT_VERSION (6). */
export const MAX_HISTORY_ENTRIES = 100;
export const PRIMARY_POINTER_BUTTON = 0;
export const MINIMAP_SIZE = 192;
export const PAINT_INTERVAL_MS = 24;
export const QUARTER_TURN_RADIANS = Math.PI / 2;
export const VALID_EDITOR_TOOLS = Object.freeze([
  'terrain',
  'object',
  'construction',
  'select',
  'settings',
]);
export const VALID_TERRAIN_MODES = Object.freeze(['paint', 'raise', 'lower', 'smooth']);
export const ELEVATED_PLACEMENT_TOLERANCE = 0.05;
export const TERRAIN_MODE_BY_SHORTCUT = Object.freeze({
  p: 'paint',
  u: 'raise',
  j: 'lower',
  k: 'smooth',
});
export const TERRAIN_PREVIEW_COLORS = Object.freeze({
  raise: '#76d17e',
  lower: '#d16f6f',
  smooth: '#6faed1',
});
