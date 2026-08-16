import assert from 'node:assert/strict';
import test from 'node:test';

import { ObjectPlacementResolver } from '../src/editor/placement/ObjectPlacementResolver.js';

function installWindowStub() {
  const previousWindow = globalThis.window;
  const listeners = new Map();
  const target = {
    location: { search: '' },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };
  globalThis.window = target;
  return {
    listeners,
    restore() {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    },
  };
}

function createResolver() {
  return new ObjectPlacementResolver({
    objectMap: { list: () => [] },
    definitionByKey: new Map(),
    heightField: null,
    tileSize: 1,
    floatingOrigin: null,
  });
}

test('object placement resolver removes pagehide ownership and collision registration on dispose', () => {
  const windowStub = installWindowStub();
  const resolver = createResolver();

  try {
    assert.equal(typeof windowStub.listeners.get('pagehide'), 'function');
    assert.equal(typeof resolver.releaseCollisionObjectSource, 'function');

    resolver.dispose();

    assert.equal(windowStub.listeners.has('pagehide'), false);
    assert.equal(resolver.releaseCollisionObjectSource, null);
    assert.equal(resolver.pagehideTarget, null);
    assert.equal(resolver.pagehideListener, null);
    assert.doesNotThrow(() => resolver.dispose());
  } finally {
    resolver.dispose();
    windowStub.restore();
  }
});
