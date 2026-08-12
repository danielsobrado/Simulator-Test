import assert from 'node:assert/strict';
import test from 'node:test';

import { InfiniteWorldStore } from '../src/editor/world/InfiniteWorldStore.js';
import { ProceduralWorldGenerator } from '../src/editor/world/ProceduralWorldGenerator.js';

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

function createStore() {
  return new InfiniteWorldStore({
    chunkSize: 8,
    tileSize: 2,
    cacheLimit: 4,
    generator: new ProceduralWorldGenerator(),
  });
}

test('terrain listener failures do not make successful edits look failed', async () => {
  await withCapturedErrors(async (errors) => {
    const store = createStore();
    const observed = [];
    store.subscribe(() => { throw new Error('render refresh failed'); });
    store.subscribe((change) => observed.push(change));

    const before = store.getTile(0, 0);
    const after = before === 4 ? 5 : 4;
    const patch = store.paintSquare(0, 0, 1, after);

    assert.equal(store.getTile(0, 0), after);
    assert.equal(patch.indices.length, 1);
    assert.equal(observed.length, 1);
    assert.equal(observed[0].kind, 'tile');
    assert.equal(errors.length, 1);
  });
});
