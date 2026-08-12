import assert from 'node:assert/strict';
import test from 'node:test';

import { TerrainAwareEditorController } from '../src/editor/TerrainAwareEditorController.js';

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

test('controller notifications continue after individual listener failures', async () => {
  await withCapturedErrors(async (errors) => {
    const controller = Object.create(TerrainAwareEditorController.prototype);
    controller.getState = () => ({ ready: true });
    controller.listeners = new Set([
      () => { throw new Error('state listener failed'); },
      (value) => { controller.observedState = value; },
    ]);
    controller.mapListeners = new Set([
      () => { throw new Error('map listener failed'); },
      (value) => { controller.observedMap = value; },
    ]);
    controller.noticeListeners = new Set([
      () => { throw new Error('notice listener failed'); },
      (value) => { controller.observedNotice = value; },
    ]);
    controller.hoverListeners = new Set([
      () => { throw new Error('hover listener failed'); },
      (value) => { controller.observedHover = value; },
    ]);
    controller.tileMap = {
      get: () => 4,
      getTileDefinition: () => ({ id: 4, label: 'Grassland' }),
    };
    controller.objectMap = {
      findAt: () => null,
      getDefinition: () => null,
    };
    controller.heightField = { getCellHeight: () => 3 };

    controller.emitState();
    controller.emitMap(false);
    controller.emitNotice('saved');
    controller.emitHover({ x: 2, z: 3 });

    assert.deepEqual(controller.observedState, { ready: true });
    assert.deepEqual(controller.observedMap, { final: false });
    assert.deepEqual(controller.observedNotice, { message: 'saved', isError: false });
    assert.equal(controller.observedHover.height, 3);
    assert.equal(errors.length, 4);
  });
});
