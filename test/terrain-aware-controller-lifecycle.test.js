import assert from 'node:assert/strict';
import test from 'node:test';

import { TerrainAwareEditorController } from '../src/editor/TerrainAwareEditorController.js';

function handlerSet() {
  return {
    pointerDown() {},
    pointerMove() {},
    pointerUp() {},
    pointerLeave() {},
    contextMenu() {},
    keyDown() {},
    keyUp() {},
  };
}

test('terrain-aware controller releases attached construction UI and subscriptions once', () => {
  const previousWindow = globalThis.window;
  const windowTarget = new EventTarget();
  globalThis.window = windowTarget;

  try {
    const controller = Object.create(TerrainAwareEditorController.prototype);
    controller.pendingTopEditTimer = null;
    controller.canvas = new EventTarget();
    controller.boundHandlers = handlerSet();
    controller.listeners = new Set([() => {}]);
    controller.mapListeners = new Set([() => {}]);
    controller.hoverListeners = new Set([() => {}]);
    controller.noticeListeners = new Set([() => {}]);

    let gizmoDisposals = 0;
    let paletteDisposals = 0;
    controller.constructionGizmo = { dispose: () => { gizmoDisposals += 1; } };
    controller.constructionPalette = { dispose: () => { paletteDisposals += 1; } };

    controller.dispose();

    assert.equal(gizmoDisposals, 1);
    assert.equal(paletteDisposals, 1);
    assert.equal(controller.constructionGizmo, null);
    assert.equal(controller.constructionPalette, null);
    assert.equal(controller.listeners.size, 0);
    assert.equal(controller.mapListeners.size, 0);
    assert.equal(controller.hoverListeners.size, 0);
    assert.equal(controller.noticeListeners.size, 0);

    assert.doesNotThrow(() => controller.dispose());
    assert.equal(gizmoDisposals, 1);
    assert.equal(paletteDisposals, 1);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
