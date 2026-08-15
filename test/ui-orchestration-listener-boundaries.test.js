import assert from 'node:assert/strict';
import test from 'node:test';

import { EscapeStack } from '../src/editor/ui/EscapeStack.js';
import { LoadingTracker } from '../src/editor/ui/LoadingTracker.js';
import { ViewModeController } from '../src/editor/player/ViewModeController.js';

async function withCapturedErrors(run) {
  const originalError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args);
  try {
    await run(errors);
  } finally {
    console.error = originalError;
  }
}

function fakeEventTarget() {
  return {
    addEventListener() {},
    removeEventListener() {},
  };
}

test('escape stack continues after a failing higher-priority handler', async () => {
  await withCapturedErrors(async (errors) => {
    const stack = new EscapeStack({ target: fakeEventTarget() });
    let lowerRan = false;
    let prevented = false;
    let stopped = false;
    stack.register(100, () => { throw new Error('broken escape'); }, { label: 'broken' });
    stack.register(90, () => {
      lowerRan = true;
      return true;
    });

    assert.doesNotThrow(() => stack.handleKeyDown({
      key: 'Escape',
      code: 'Escape',
      target: null,
      preventDefault: () => { prevented = true; },
      stopImmediatePropagation: () => { stopped = true; },
    }));
    assert.equal(lowerRan, true);
    assert.equal(prevented, true);
    assert.equal(stopped, true);
    assert.equal(errors.length, 1);
    stack.dispose();
  });
});

test('loading tracker continues notifying after a failing listener', async () => {
  await withCapturedErrors(async (errors) => {
    const tracker = new LoadingTracker({ clock: () => 0 });
    const observed = [];
    tracker.subscribe((state) => {
      if (state.open) throw new Error('broken loading view');
    });
    tracker.subscribe((state) => observed.push(state.open));

    assert.doesNotThrow(() => tracker.begin({ title: 'Load', steps: ['one'] }));
    assert.equal(observed.at(-1), true);
    assert.equal(errors.length, 1);
  });
});

test('view mode callbacks and listeners cannot abort spawn-selection state', async () => {
  await withCapturedErrors(async (errors) => {
    const originalWindow = globalThis.window;
    globalThis.window = fakeEventTarget();
    try {
      const canvas = fakeEventTarget();
      const editorCamera = {
        camera: {},
        setEnabled() {},
        update() {},
        resize() {},
        shiftWorld() {},
        getFocusWorld: () => ({ x: 0, z: 0 }),
      };
      const playerController = {
        camera: {},
        yaw: 0,
        subscribe: () => () => {},
        setEnabled() {},
        getStatus: () => ({}),
        resize() {},
        shiftWorld() {},
        dispose() {},
      };
      const controller = new ViewModeController({
        editorCamera,
        playerController,
        terrainView: { renderer: { domElement: canvas } },
      });
      controller.onLeaveOrbitEditing = () => { throw new Error('preview cleanup failed'); };
      const observed = [];
      controller.subscribe((state) => {
        if (state.awaitingSpawn) throw new Error('broken mode view');
      });
      controller.subscribe((state) => observed.push(state.awaitingSpawn));

      assert.doesNotThrow(() => controller.beginSpawnSelection());
      assert.equal(controller.awaitingSpawn, true);
      assert.equal(observed.at(-1), true);
      assert.equal(errors.length, 2);
      controller.dispose();
    } finally {
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
    }
  });
});
