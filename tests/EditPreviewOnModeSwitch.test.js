import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorController } from '../src/editor/EditorController.js';
import { PLAYER_MODE_EDIT, PLAYER_MODE_WALK } from '../src/editor/player/playerConstants.js';

/**
 * Terrain/object brush ghosts must hide when leaving orbit edit for spawn
 * pick or walk. Regression: enterWalkMode / beginSpawnSelection left the last
 * setPreview mesh visible on the ground.
 */

function installDomGlobals() {
  const listeners = new Map();
  const target = {
    addEventListener(type, handler) {
      const list = listeners.get(type) ?? [];
      list.push(handler);
      listeners.set(type, list);
    },
    removeEventListener(type, handler) {
      const list = listeners.get(type) ?? [];
      listeners.set(type, list.filter((entry) => entry !== handler));
    },
  };
  const previous = {
    hadWindow: Object.prototype.hasOwnProperty.call(globalThis, 'window'),
    hadDocument: Object.prototype.hasOwnProperty.call(globalThis, 'document'),
    window: globalThis.window,
    document: globalThis.document,
  };
  globalThis.window = target;
  globalThis.document = { ...target };
  return () => {
    if (previous.hadWindow) globalThis.window = previous.window;
    else delete globalThis.window;
    if (previous.hadDocument) globalThis.document = previous.document;
    else delete globalThis.document;
  };
}

function createCanvas() {
  return {
    addEventListener() {},
    removeEventListener() {},
    setPointerCapture() {},
    releasePointerCapture() {},
    hasPointerCapture() { return false; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    style: {},
    width: 100,
    height: 100,
  };
}

function createPreviewHarness({ previewsAllowed = () => true } = {}) {
  const terrainPreview = { calls: [], visible: false };
  const objectPreview = { calls: [], visible: false };
  const controller = new EditorController({
    tileMap: {
      tileSize: 2,
      getTileDefinition: () => ({ color: '#7cba3d' }),
    },
    heightField: {},
    objectMap: {
      getById: () => null,
      definitionByKey: new Map([['tree', {}]]),
      getBounds: () => ({ minX: 0, maxX: 0, minZ: 0, maxZ: 0 }),
    },
    terrainView: {
      renderer: { domElement: createCanvas() },
      pickCell: () => ({ x: 3, z: 5 }),
      pickWorld: () => ({ x: 0, z: 0 }),
      floatingOrigin: null,
      setPreview(cell, brushSize, color) {
        terrainPreview.calls.push({ cell, brushSize, color });
        terrainPreview.visible = Boolean(cell);
      },
    },
    objectView: {
      setSelection() {},
      setHover() {},
      setPreview(preview) {
        objectPreview.calls.push(preview);
        objectPreview.visible = Boolean(preview);
      },
      pickObject: () => null,
    },
    editorCamera: {
      camera: {},
      setLeftPanEnabled() {},
      getFocusWorld: () => ({ x: 0, z: 0 }),
    },
    objectCatalog: [{ key: 'tree', label: 'Tree' }],
    brushSizes: [1, 3],
    defaultBrushSize: 1,
    terrainConfig: { minHeight: -4, maxHeight: 4 },
  });
  controller.editPreviewsAllowedProvider = previewsAllowed;
  controller.selectTerrainMode('raise');
  return { controller, terrainPreview, objectPreview };
}

test('clearHoverPreviews hides a live terrain brush ghost', () => {
  const restore = installDomGlobals();
  const { controller, terrainPreview, objectPreview } = createPreviewHarness();

  controller.hoveredCell = { x: 3, z: 5 };
  controller.updatePreviews();
  assert.equal(terrainPreview.visible, true);

  controller.clearHoverPreviews();
  assert.equal(controller.hoveredCell, null);
  assert.equal(terrainPreview.visible, false);
  assert.equal(objectPreview.visible, false);

  controller.dispose();
  restore();
});

test('previews stay hidden while orbit editing is not allowed', () => {
  const restore = installDomGlobals();
  let allowed = true;
  const { controller, terrainPreview } = createPreviewHarness({
    previewsAllowed: () => allowed,
  });

  controller.hoveredCell = { x: 1, z: 2 };
  controller.updatePreviews();
  assert.equal(terrainPreview.visible, true);

  allowed = false;
  controller.hoveredCell = { x: 4, z: 4 };
  controller.updatePreviews();
  assert.equal(terrainPreview.visible, false, 'spawn/walk must not refresh the brush ghost');

  controller.dispose();
  restore();
});

/**
 * Mirrors the main.js wiring: leave-orbit hook clears previews, and the
 * allowed-provider tracks edit vs player so spawn hover cannot revive them.
 */
test('leaving orbit for player mode clears and suppresses the brush ghost', () => {
  const restore = installDomGlobals();
  let mode = PLAYER_MODE_EDIT;
  let awaitingSpawn = false;
  const { controller, terrainPreview } = createPreviewHarness({
    previewsAllowed: () => mode === PLAYER_MODE_EDIT && !awaitingSpawn,
  });

  const viewMode = {
    onLeaveOrbitEditing: null,
    beginSpawnSelection() {
      awaitingSpawn = true;
      this.onLeaveOrbitEditing?.();
    },
    enterWalkMode() {
      awaitingSpawn = false;
      mode = PLAYER_MODE_WALK;
      this.onLeaveOrbitEditing?.();
    },
  };
  viewMode.onLeaveOrbitEditing = () => controller.clearHoverPreviews();

  controller.hoveredCell = { x: 8, z: 2 };
  controller.updatePreviews();
  assert.equal(terrainPreview.visible, true);

  viewMode.beginSpawnSelection();
  assert.equal(awaitingSpawn, true);
  assert.equal(terrainPreview.visible, false, 'spawn pick must hide the orbit brush');

  // Pointer still moves over the ground while choosing a spawn — must not revive.
  controller.hoveredCell = { x: 9, z: 9 };
  controller.updatePreviews();
  assert.equal(terrainPreview.visible, false);

  viewMode.enterWalkMode();
  assert.equal(mode, PLAYER_MODE_WALK);
  assert.equal(terrainPreview.visible, false, 'walk entry must leave no ghost on the ground');

  controller.dispose();
  restore();
});
