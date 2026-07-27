import assert from 'node:assert/strict';
import test from 'node:test';
import { ESCAPE_PRIORITY, EscapeStack } from '../src/editor/ui/EscapeStack.js';

/** Minimal capture-phase event target, since this runs outside a DOM. */
function createTarget() {
  const listeners = [];
  return {
    addEventListener(type, handler, capture) {
      listeners.push({ type, handler, capture });
    },
    removeEventListener(type, handler) {
      const index = listeners.findIndex((entry) => entry.handler === handler);
      if (index >= 0) listeners.splice(index, 1);
    },
    press(key = 'Escape', tagName = 'CANVAS') {
      const event = {
        key,
        code: key,
        target: { tagName },
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
    get listenerCount() {
      return listeners.length;
    },
  };
}

test('the highest priority handler that claims the press consumes it', () => {
  const target = createTarget();
  const stack = new EscapeStack({ target });
  const seen = [];
  stack.register(ESCAPE_PRIORITY.selection, () => {
    seen.push('selection');
    return true;
  });
  stack.register(ESCAPE_PRIORITY.palette, () => {
    seen.push('palette');
    return true;
  });
  const event = target.press();
  assert.deepEqual(seen, ['palette'], 'the palette outranks the selection');
  assert.ok(event.propagationStopped);
  assert.ok(event.defaultPrevented);
  stack.dispose();
});

test('a handler that declines passes the press down one level', () => {
  const target = createTarget();
  const stack = new EscapeStack({ target });
  const seen = [];
  stack.register(ESCAPE_PRIORITY.palette, () => {
    seen.push('palette');
    return false;
  });
  stack.register(ESCAPE_PRIORITY.gesture, () => {
    seen.push('gesture');
    return true;
  });
  stack.register(ESCAPE_PRIORITY.selection, () => {
    seen.push('selection');
    return true;
  });
  target.press();
  assert.deepEqual(seen, ['palette', 'gesture'], 'stops at the first claim');
  stack.dispose();
});

test('nothing claiming the press leaves the event alone', () => {
  const target = createTarget();
  const stack = new EscapeStack({ target });
  stack.register(ESCAPE_PRIORITY.selection, () => false);
  const event = target.press();
  assert.equal(event.propagationStopped, false);
  assert.equal(event.defaultPrevented, false);
  stack.dispose();
});

test('ties resolve by registration order, not by chance', () => {
  const target = createTarget();
  const stack = new EscapeStack({ target });
  const seen = [];
  stack.register(50, () => {
    seen.push('first');
    return false;
  });
  stack.register(50, () => {
    seen.push('second');
    return false;
  });
  target.press();
  assert.deepEqual(seen, ['first', 'second']);
  stack.dispose();
});

test('unregistering removes a handler', () => {
  const target = createTarget();
  const stack = new EscapeStack({ target });
  let calls = 0;
  const off = stack.register(ESCAPE_PRIORITY.selection, () => {
    calls += 1;
    return true;
  });
  target.press();
  off();
  target.press();
  assert.equal(calls, 1);
  stack.dispose();
});

test('other keys and text fields are left to their owners', () => {
  const target = createTarget();
  const stack = new EscapeStack({ target });
  let calls = 0;
  stack.register(ESCAPE_PRIORITY.selection, () => {
    calls += 1;
    return true;
  });
  target.press('Enter');
  assert.equal(calls, 0);
  target.press('Escape', 'INPUT');
  assert.equal(calls, 0, 'escape inside a text field belongs to the field');
  target.press('Escape', 'CANVAS');
  assert.equal(calls, 1);
  stack.dispose();
});

test('dispose detaches the listener and drops every handler', () => {
  const target = createTarget();
  const stack = new EscapeStack({ target });
  stack.register(ESCAPE_PRIORITY.selection, () => true);
  assert.equal(target.listenerCount, 1);
  stack.dispose();
  assert.equal(target.listenerCount, 0);
  assert.equal(stack.handlers.length, 0);
});
