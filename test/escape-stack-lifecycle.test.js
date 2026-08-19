import assert from 'node:assert/strict';
import test from 'node:test';

import { EscapeStack } from '../src/editor/ui/EscapeStack.js';

function escapeEvent() {
  const event = new Event('keydown', { cancelable: true });
  Object.defineProperty(event, 'key', { value: 'Escape' });
  Object.defineProperty(event, 'code', { value: 'Escape' });
  return event;
}

test('EscapeStack releases its target listener on pagehide and disposal is idempotent', () => {
  const target = new EventTarget();
  const stack = new EscapeStack({ target });
  let handled = 0;
  stack.register(1, () => {
    handled += 1;
    return true;
  });

  target.dispatchEvent(escapeEvent());
  assert.equal(handled, 1);

  target.dispatchEvent(new Event('pagehide'));
  target.dispatchEvent(escapeEvent());
  assert.equal(handled, 1);
  assert.equal(stack.handlers.length, 0);
  assert.doesNotThrow(() => stack.dispose());
});
