import assert from 'node:assert/strict';
import test from 'node:test';
import { PlayerController } from '../src/editor/player/PlayerController.js';

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
    window: globalThis.window,
    document: globalThis.document,
  };
  globalThis.window = target;
  globalThis.document = {
    ...target,
    exitPointerLock() {},
    pointerLockElement: null,
  };
  return () => {
    if (previous.window === undefined) delete globalThis.window;
    else globalThis.window = previous.window;
    if (previous.document === undefined) delete globalThis.document;
    else globalThis.document = previous.document;
  };
}

function createController() {
  const restore = installDomGlobals();
  const canvas = {
    listeners: new Map(),
    addEventListener(type, handler) {
      const list = this.listeners.get(type) ?? [];
      list.push(handler);
      this.listeners.set(type, list);
    },
    removeEventListener(type, handler) {
      const list = this.listeners.get(type) ?? [];
      this.listeners.set(type, list.filter((entry) => entry !== handler));
    },
    requestPointerLock() {
      this.lockRequested = true;
    },
  };
  const terrainView = {
    getWorldHeight: () => 0,
  };
  const controller = new PlayerController({
    canvas,
    terrainView,
    config: {
      fovDegrees: 70,
      eyeHeight: 1.7,
      mouseSensitivity: 0.002,
      maxPitchDegrees: 85,
      walkSpeed: 5,
      runMultiplier: 1.5,
      jumpSpeed: 8,
      gravity: 20,
      stepHeight: 0.5,
      groundSnapDistance: 0.3,
    },
  });
  controller.setEnabled(true);
  return {
    controller,
    canvas,
    dispose() {
      controller.dispose();
      restore();
    },
  };
}

test('setUiBlocked clears movement and rejects new movement keys', () => {
  const { controller, dispose } = createController();
  controller.keys.add('KeyW');
  controller.jumpQueued = true;
  controller.setUiBlocked(true);
  assert.equal(controller.uiBlocked, true);
  assert.equal(controller.keys.size, 0);
  assert.equal(controller.jumpQueued, false);

  controller.onKeyDown({
    code: 'KeyW',
    repeat: false,
    target: { tagName: 'CANVAS' },
    preventDefault() {},
    stopImmediatePropagation() {},
  });
  assert.equal(controller.keys.has('KeyW'), false);
  dispose();
});

test('setUiBlocked rejects pointer-lock requests from canvas clicks', () => {
  const { controller, canvas, dispose } = createController();
  controller.setUiBlocked(true);
  controller.requestPointerLock();
  assert.equal(canvas.lockRequested, undefined);
  controller.setUiBlocked(false);
  controller.requestPointerLock();
  assert.equal(canvas.lockRequested, true);
  dispose();
});

test('setUiBlocked preserves pose and enabled mode', () => {
  const { controller, dispose } = createController();
  controller.setPose({ x: 12, z: 8, yaw: 1.2, pitch: 0.1 });
  controller.setUiBlocked(true);
  assert.equal(controller.enabled, true);
  assert.equal(controller.state.x, 12);
  assert.equal(controller.state.z, 8);
  assert.equal(controller.yaw, 1.2);
  assert.equal(controller.pitch, 0.1);
  dispose();
});
