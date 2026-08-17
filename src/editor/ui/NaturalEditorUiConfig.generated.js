export const NATURAL_EDITOR_UI_CONFIG = Object.freeze({
  storage: Object.freeze({
    favoritesKey: 'drusniel:natural-ui:favorites',
    recentKey: 'drusniel:natural-ui:recent',
    hintKey: 'drusniel:natural-ui:hint-seen',
  }),
  limits: Object.freeze({
    recentObjects: 8,
    favoriteObjects: 16,
  }),
  motion: Object.freeze({
    panelMs: 160,
    toolbarMs: 140,
    hintDurationMs: 9000,
  }),
  primaryTools: Object.freeze([
    Object.freeze({ id: 'terrain', label: 'Terrain', controllerTool: 'terrain', icon: 'terrain' }),
    Object.freeze({ id: 'nature', label: 'Nature', controllerTool: 'object', objectCategory: 'nature', icon: 'nature' }),
    Object.freeze({ id: 'build', label: 'Build', controllerTool: 'construction', icon: 'build' }),
    Object.freeze({ id: 'decor', label: 'Decor', controllerTool: 'object', objectCategory: 'all', icon: 'decor' }),
  ]),
  buildActions: Object.freeze([
    Object.freeze({ id: 'wall', label: 'Wall', controllerTool: 'construction', icon: 'wall' }),
    Object.freeze({ id: 'structures', label: 'Structures', controllerTool: 'object', objectCategory: 'building', icon: 'structures' }),
    Object.freeze({ id: 'workshop', label: 'Procedural', action: 'workshop', icon: 'workshop' }),
  ]),
  worldActions: Object.freeze([
    Object.freeze({ id: 'save', label: 'Save' }),
    Object.freeze({ id: 'load', label: 'Load' }),
    Object.freeze({ id: 'export', label: 'Export' }),
    Object.freeze({ id: 'import', label: 'Import' }),
  ]),
  hints: Object.freeze({
    firstRun: 'Drag the world directly. Click an object to select it. Shift lowers terrain; Ctrl smooths.',
    terrain: 'Drag to paint or sculpt. Shift lowers. Ctrl smooths. Shift + wheel changes brush size.',
    build: 'Drag empty ground to draw a wall. Click a wall to edit it. Drag its handles directly.',
  }),
});
