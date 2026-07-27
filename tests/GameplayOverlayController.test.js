import assert from 'node:assert/strict';
import test from 'node:test';
import { GameplayOverlayController } from '../src/editor/ui/GameplayOverlayController.js';
import { GAMEPLAY_OVERLAY } from '../src/editor/ui/gameplayOverlayConstants.js';

function createTarget() {
  const listeners = [];
  return {
    addEventListener(type, handler) {
      listeners.push({ type, handler });
    },
    removeEventListener(type, handler) {
      const index = listeners.findIndex((entry) => entry.handler === handler);
      if (index >= 0) listeners.splice(index, 1);
    },
    press(code, {
      repeat = false,
      tagName = 'CANVAS',
      isContentEditable = false,
    } = {}) {
      const event = {
        code,
        key: code === 'Escape' ? 'Escape' : code,
        repeat,
        target: { tagName, isContentEditable },
        defaultPrevented: false,
        propagationStopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopImmediatePropagation() { this.propagationStopped = true; },
      };
      for (const entry of [...listeners]) {
        if (entry.type !== 'keydown') continue;
        entry.handler(event);
        if (event.propagationStopped) break;
      }
      return event;
    },
  };
}

function createPlayer() {
  return {
    pointerLocked: false,
    uiBlocked: false,
    inputReset: 0,
    lockRequests: 0,
    exitCalls: 0,
    setUiBlocked(blocked) { this.uiBlocked = Boolean(blocked); },
    resetInput() { this.inputReset += 1; },
    requestPointerLock() { this.lockRequests += 1; },
  };
}

function createDocument(player) {
  return {
    exitPointerLock() {
      player.pointerLocked = false;
      player.exitCalls += 1;
    },
  };
}

function createOverlay(player = createPlayer()) {
  const target = createTarget();
  const doc = createDocument(player);
  const controller = new GameplayOverlayController({
    target,
    document: doc,
    getPlayerController: () => player,
  });
  const opened = [];
  const closed = [];
  controller.registerOverlay(GAMEPLAY_OVERLAY.inventory, {
    onOpen: () => opened.push('inventory'),
    onClose: () => closed.push('inventory'),
    onEscape: () => false,
  });
  controller.registerOverlay(GAMEPLAY_OVERLAY.worldMap, {
    onOpen: () => opened.push('world-map'),
    onClose: () => closed.push('world-map'),
  });
  return { controller, target, player, opened, closed };
}

test('I opens inventory', () => {
  const { controller, target, opened } = createOverlay();
  target.press('KeyI');
  assert.equal(controller.activeOverlay, 'inventory');
  assert.deepEqual(opened, ['inventory']);
  controller.dispose();
});

test('repeated I is ignored', () => {
  const { controller, target, opened } = createOverlay();
  target.press('KeyI');
  target.press('KeyI', { repeat: true });
  assert.equal(controller.activeOverlay, 'inventory');
  assert.deepEqual(opened, ['inventory']);
  controller.dispose();
});

test('I closes inventory', () => {
  const { controller, target, closed } = createOverlay();
  target.press('KeyI');
  target.press('KeyI');
  assert.equal(controller.activeOverlay, null);
  assert.deepEqual(closed, ['inventory']);
  controller.dispose();
});

test('M opens map', () => {
  const { controller, target, opened } = createOverlay();
  target.press('KeyM');
  assert.equal(controller.activeOverlay, 'world-map');
  assert.deepEqual(opened, ['world-map']);
  controller.dispose();
});

test('inventory and map are mutually exclusive', () => {
  const { controller, target, opened, closed } = createOverlay();
  target.press('KeyI');
  target.press('KeyM');
  assert.equal(controller.activeOverlay, 'world-map');
  assert.deepEqual(opened, ['inventory', 'world-map']);
  assert.deepEqual(closed, ['inventory']);
  target.press('KeyI');
  assert.equal(controller.activeOverlay, 'inventory');
  assert.deepEqual(closed, ['inventory', 'world-map']);
  controller.dispose();
});

test('Escape closes the active overlay', () => {
  const { controller, target } = createOverlay();
  target.press('KeyI');
  target.press('Escape');
  assert.equal(controller.activeOverlay, null);
  controller.dispose();
});

test('shortcuts are ignored while typing', () => {
  const { controller, target } = createOverlay();
  target.press('KeyI', { tagName: 'INPUT' });
  assert.equal(controller.activeOverlay, null);
  target.press('KeyI', { tagName: 'DIV', isContentEditable: true });
  assert.equal(controller.activeOverlay, null);
  controller.dispose();
});

test('opening clears movement input and releases pointer lock', () => {
  const player = createPlayer();
  player.pointerLocked = true;
  const { controller, target } = createOverlay(player);
  target.press('KeyI');
  assert.equal(player.uiBlocked, true);
  assert.equal(player.inputReset, 1);
  assert.equal(player.exitCalls, 1);
  assert.equal(player.pointerLocked, false);
  controller.dispose();
});

test('closing restores pointer lock when it was previously held', () => {
  const player = createPlayer();
  player.pointerLocked = true;
  const { controller, target } = createOverlay(player);
  target.press('KeyI');
  target.press('KeyI');
  assert.equal(player.uiBlocked, false);
  assert.equal(player.lockRequests, 1);
  controller.dispose();
});

test('closing does not restore pointer lock when it was not previously held', () => {
  const player = createPlayer();
  player.pointerLocked = false;
  const { controller, target } = createOverlay(player);
  target.press('KeyI');
  target.press('KeyI');
  assert.equal(player.lockRequests, 0);
  assert.equal(player.uiBlocked, false);
  controller.dispose();
});

test('Escape can cancel a local overlay interaction first', () => {
  const player = createPlayer();
  const target = createTarget();
  const controller = new GameplayOverlayController({
    target,
    document: createDocument(player),
    getPlayerController: () => player,
  });
  let cancelCalls = 0;
  controller.registerOverlay('inventory', {
    onEscape: () => {
      cancelCalls += 1;
      return cancelCalls === 1;
    },
  });
  controller.open('inventory');
  target.press('Escape');
  assert.equal(controller.activeOverlay, 'inventory');
  target.press('Escape');
  assert.equal(controller.activeOverlay, null);
  controller.dispose();
});

test('isWorldInputBlocked tracks the active overlay', () => {
  const { controller, target } = createOverlay();
  assert.equal(controller.isWorldInputBlocked(), false);
  target.press('KeyM');
  assert.equal(controller.isWorldInputBlocked(), true);
  controller.dispose();
});
