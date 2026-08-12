import assert from 'node:assert/strict';
import test from 'node:test';

import { FloatingOrigin } from '../src/editor/world/FloatingOrigin.js';

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

test('floating-origin rebases still complete when a subscriber throws', async () => {
  await withCapturedErrors(async (errors) => {
    const origin = new FloatingOrigin({ threshold: 100, snapSize: 64 });
    const observed = [];
    origin.subscribe(() => { throw new Error('post-process failure'); });
    origin.subscribe((event) => observed.push(event));

    const event = origin.update({ x: 130, z: 0 });

    assert.deepEqual(origin.getState(), { x: 128, z: 0 });
    assert.equal(event?.shiftX, 128);
    assert.equal(observed.length, 1);
    assert.equal(observed[0], event);
    assert.equal(errors.length, 1);
  });
});
