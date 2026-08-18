import assert from 'node:assert/strict';
import test from 'node:test';
import {
  arcSlot,
  circularOffset,
  consumeSteppedDelta,
  wheelDeltaPixels,
  wrapIndex,
} from '../src/editor/workshop/WorkshopRadialMenuMath.js';

test('wrapIndex keeps radial selections inside the item range', () => {
  assert.equal(wrapIndex(-1, 5), 4);
  assert.equal(wrapIndex(5, 5), 0);
  assert.equal(wrapIndex(12, 5), 2);
});

test('arcSlot keeps the selected center slot largest and fully opaque', () => {
  const first = arcSlot(0, 5);
  const center = arcSlot(2, 5);
  const last = arcSlot(4, 5);

  assert.equal(center.y, 50);
  assert.equal(center.scale, 1);
  assert.equal(center.opacity, 1);
  assert.equal(first.y, 8);
  assert.equal(last.y, 92);
  assert.equal(first.depth, last.depth);
});

test('circularOffset chooses the shortest wrapped direction', () => {
  assert.equal(circularOffset(0, 8, 10), 2);
  assert.equal(circularOffset(6, 8, 10), -2);
  assert.equal(circularOffset(8, 8, 10), 0);
});

test('wheelDeltaPixels normalizes wheel delta modes', () => {
  assert.equal(wheelDeltaPixels({ deltaX: 2, deltaY: 8, deltaMode: 0 }), 8);
  assert.equal(wheelDeltaPixels({ deltaX: -3, deltaY: 1, deltaMode: 1 }), -48);
  assert.equal(wheelDeltaPixels({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 640), 640);
});

test('consumeSteppedDelta accumulates trackpad motion without runaway fling backlog', () => {
  assert.deepEqual(consumeSteppedDelta(0, 20, 40, 2), { steps: 0, remainder: 20 });
  assert.deepEqual(consumeSteppedDelta(20, 25, 40, 2), { steps: 1, remainder: 5 });

  const fling = consumeSteppedDelta(0, 500, 40, 2);
  assert.equal(fling.steps, 2);
  assert.ok(Math.abs(fling.remainder) < 40);
});
