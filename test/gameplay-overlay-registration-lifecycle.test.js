import assert from 'node:assert/strict';
import test from 'node:test';

import { GameplayOverlayController } from '../src/editor/ui/GameplayOverlayController.js';

function createTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };
}

test('stale overlay unregister cannot remove a replacement registration', () => {
  const target = createTarget();
  const controller = new GameplayOverlayController({ target, document: null });
  let firstOpened = 0;
  let replacementOpened = 0;

  const unregisterFirst = controller.registerOverlay('test', {
    onOpen: () => { firstOpened += 1; },
  });
  const unregisterReplacement = controller.registerOverlay('test', {
    onOpen: () => { replacementOpened += 1; },
  });

  unregisterFirst();
  controller.open('test');

  assert.equal(firstOpened, 0);
  assert.equal(replacementOpened, 1);
  assert.equal(controller.isOpen('test'), true);

  controller.close('test');
  unregisterReplacement();
  assert.throws(() => controller.open('test'), /Unknown gameplay overlay/);
  controller.dispose();
});
