import assert from 'node:assert/strict';
import test from 'node:test';

import { InventoryController } from '../src/editor/inventory/InventoryController.js';
import { WorldMapController } from '../src/editor/map/WorldMapController.js';
import { GameplayOverlayController } from '../src/editor/ui/GameplayOverlayController.js';

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

function inventoryStore() {
  return {
    catalog: null,
    subscribe: () => () => {},
    getState: () => Object.freeze({ bagSlots: [], equipment: {} }),
  };
}

function eventTarget() {
  return {
    addEventListener() {},
    removeEventListener() {},
  };
}

test('inventory controller isolates listener failures during state changes', async () => {
  await withCapturedErrors(async (errors) => {
    const controller = new InventoryController({ store: inventoryStore() });
    const observed = [];
    controller.subscribe((state) => {
      if (state.isOpen) throw new Error('inventory view failed');
    });
    controller.subscribe((state) => observed.push(state.isOpen));

    assert.doesNotThrow(() => controller.open());
    assert.equal(observed.at(-1), true);
    assert.equal(errors.length, 1);
    controller.dispose();
  });
});

test('world map controller isolates listener failures during state changes', async () => {
  await withCapturedErrors(async (errors) => {
    const controller = new WorldMapController({
      worldStore: null,
      floatingOrigin: null,
      tileSize: 1,
      getViewModeController: () => null,
      getPlayerController: () => null,
      getCampaign: () => null,
    });
    const observed = [];
    controller.subscribe((state) => {
      if (state.isOpen) throw new Error('map view failed');
    });
    controller.subscribe((state) => observed.push(state.isOpen));

    assert.doesNotThrow(() => controller.open());
    assert.equal(observed.at(-1), true);
    assert.equal(errors.length, 1);
    controller.dispose();
  });
});

test('overlay close callback failure cannot leave world input blocked', async () => {
  await withCapturedErrors(async (errors) => {
    const blocked = [];
    let pointerRequests = 0;
    const player = {
      pointerLocked: true,
      setUiBlocked: (value) => blocked.push(value),
      resetInput() {},
      requestPointerLock: () => { pointerRequests += 1; },
    };
    const controller = new GameplayOverlayController({
      target: eventTarget(),
      document: { exitPointerLock() {} },
      getPlayerController: () => player,
    });
    controller.registerOverlay('broken', {
      onClose: () => { throw new Error('close failed'); },
    });

    controller.open('broken');
    assert.doesNotThrow(() => controller.close('broken'));
    assert.equal(controller.activeOverlay, null);
    assert.equal(controller.isWorldInputBlocked(), false);
    assert.equal(blocked.at(-1), false);
    assert.equal(pointerRequests, 1);
    assert.equal(errors.length, 1);
    controller.dispose();
  });
});

test('overlay open callback failure rolls back input ownership', async () => {
  await withCapturedErrors(async (errors) => {
    const blocked = [];
    let pointerRequests = 0;
    const player = {
      pointerLocked: true,
      setUiBlocked: (value) => blocked.push(value),
      resetInput() {},
      requestPointerLock: () => { pointerRequests += 1; },
    };
    const controller = new GameplayOverlayController({
      target: eventTarget(),
      document: { exitPointerLock() {} },
      getPlayerController: () => player,
    });
    controller.registerOverlay('broken', {
      onOpen: () => { throw new Error('open failed'); },
    });

    assert.doesNotThrow(() => controller.open('broken'));
    assert.equal(controller.activeOverlay, null);
    assert.equal(controller.isWorldInputBlocked(), false);
    assert.equal(blocked.at(-1), false);
    assert.equal(pointerRequests, 1);
    assert.equal(errors.length, 1);
    controller.dispose();
  });
});
