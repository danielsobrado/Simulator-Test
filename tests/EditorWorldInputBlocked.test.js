import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorController } from '../src/editor/EditorController.js';

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

function createController(blockedProvider) {
  const controller = new EditorController({
    tileMap: { tileSize: 2 },
    heightField: {},
    objectMap: { getById: () => null },
    terrainView: {
      renderer: { domElement: createCanvas() },
      pickCell: () => ({ x: 0, z: 0 }),
      pickWorld: () => ({ x: 0, z: 0 }),
      floatingOrigin: null,
      setPreview() {},
    },
    objectView: {
      setSelection() {},
      setHover() {},
      setPlacementPreview() {},
      pickObject: () => null,
    },
    editorCamera: {
      camera: {},
      setLeftPanEnabled() {},
      getFocusWorld: () => ({ x: 0, z: 0 }),
    },
    objectCatalog: [{ key: 'tree', label: 'Tree' }],
    brushSizes: [1],
    defaultBrushSize: 1,
    terrainConfig: { minHeight: -4, maxHeight: 4 },
    worldInputBlockedProvider: blockedProvider,
  });
  controller.updatePreviews = () => {};
  return controller;
}

test('editor pointer and key input are blocked while worldInputBlockedProvider is true', () => {
  const restore = installDomGlobals();
  let blocked = true;
  const paintCalls = [];
  const controller = createController(() => blocked);
  controller.editTerrainFromPointer = () => {
    paintCalls.push('paint');
  };

  const initialTool = controller.tool;
  controller.onPointerDown({
    button: 0,
    pointerId: 1,
    clientX: 10,
    clientY: 10,
    preventDefault() {},
  });
  assert.equal(controller.painting, false);
  assert.equal(paintCalls.length, 0);

  controller.onKeyDown({
    code: 'KeyO',
    key: 'o',
    target: { tagName: 'CANVAS' },
    preventDefault() {},
  });
  assert.equal(controller.tool, initialTool);

  blocked = false;
  controller.onPointerDown({
    button: 0,
    pointerId: 1,
    clientX: 10,
    clientY: 10,
    preventDefault() {},
  });
  assert.equal(controller.painting, true);
  assert.equal(paintCalls.length, 1);

  controller.dispose();
  restore();
});

test('cancelBlockedWorldInteraction clears an active paint stroke', () => {
  const restore = installDomGlobals();
  const controller = createController(() => false);
  controller.editTerrainFromPointer = () => {};
  controller.onPointerDown({
    button: 0,
    pointerId: 1,
    clientX: 10,
    clientY: 10,
    preventDefault() {},
  });
  assert.equal(controller.painting, true);
  controller.cancelBlockedWorldInteraction();
  assert.equal(controller.painting, false);
  assert.equal(controller.stroke, null);
  controller.dispose();
  restore();
});
