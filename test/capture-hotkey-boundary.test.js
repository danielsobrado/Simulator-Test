import assert from 'node:assert/strict';
import test from 'node:test';

import { attachCaptureHotkey } from '../src/editor/input/attachCaptureHotkey.js';

test('capture hotkey failures do not escape the global key listener', () => {
  const target = new EventTarget();
  const originalError = console.error;
  console.error = () => {};
  try {
    const detach = attachCaptureHotkey(() => () => {
      throw new Error('broken hotkey');
    }, target);

    assert.doesNotThrow(() => target.dispatchEvent(new Event('keydown')));
    detach();
  } finally {
    console.error = originalError;
  }
});

test('capture hotkey disposer removes its listener', () => {
  const target = new EventTarget();
  let calls = 0;
  const detach = attachCaptureHotkey(() => () => {
    calls += 1;
    return false;
  }, target);

  target.dispatchEvent(new Event('keydown'));
  detach();
  target.dispatchEvent(new Event('keydown'));

  assert.equal(calls, 1);
});
