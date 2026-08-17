// Generated from config/editor-natural-ui.yaml.
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const NATURAL_EDITOR_UI_CONFIG = deepFreeze({
  "version": 1,
  "storage": {
    "favoritesKey": "drusniel:natural-ui:favorites",
    "recentKey": "drusniel:natural-ui:recent",
    "hintKey": "drusniel:natural-ui:hint-seen",
    "reducedMotionKey": "drusniel:natural-ui:reduced-motion"
  },
  "limits": {
    "recentObjects": 8,
    "favoriteObjects": 16
  },
  "motion": {
    "panelMs": 160,
    "toolbarMs": 140,
    "hintDurationMs": 9000
  },
  "playerSettings": {
    "reducedMotionClass": "natural-reduced-motion"
  },
  "primaryTools": [
    {
      "id": "terrain",
      "label": "Terrain",
      "controllerTool": "terrain",
      "icon": "terrain"
    },
    {
      "id": "nature",
      "label": "Nature",
      "controllerTool": "object",
      "objectCategory": "nature",
      "icon": "nature"
    },
    {
      "id": "build",
      "label": "Build",
      "controllerTool": "construction",
      "icon": "build"
    },
    {
      "id": "decor",
      "label": "Decor",
      "controllerTool": "object",
      "objectCategory": "all",
      "icon": "decor"
    }
  ],
  "buildActions": [
    {
      "id": "wall",
      "label": "Wall",
      "controllerTool": "construction",
      "icon": "wall"
    },
    {
      "id": "structures",
      "label": "Structures",
      "controllerTool": "object",
      "objectCategory": "building",
      "icon": "structures"
    },
    {
      "id": "defenses",
      "label": "Defenses",
      "controllerTool": "object",
      "objectCategory": "defense",
      "icon": "defense"
    },
    {
      "id": "workshop",
      "label": "Procedural",
      "action": "workshop",
      "icon": "workshop"
    }
  ],
  "worldActions": [
    {
      "id": "save",
      "label": "Save"
    },
    {
      "id": "load",
      "label": "Load"
    },
    {
      "id": "export",
      "label": "Export"
    },
    {
      "id": "import",
      "label": "Import"
    }
  ],
  "hints": {
    "firstRun": "Drag the world directly. Click an object to select it. Shift lowers terrain; Ctrl smooths.",
    "terrain": "Drag to paint or sculpt. Shift lowers. Ctrl smooths. Shift + wheel changes brush size.",
    "build": "Drag empty ground to draw a wall. Click a wall to edit it. Drag its handles directly."
  }
});
