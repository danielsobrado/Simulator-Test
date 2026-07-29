import assert from 'node:assert/strict';
import test from 'node:test';
import { attachSpellHotkeys } from '../src/editor/spells/spell_runtime.js';

/**
 * Walk-mode PlayerController capture-stops every non-Escape key. Spell digits
 * must therefore be claimed by a listener registered *before* the player, the
 * same way GameplayOverlayController claims I/M.
 */
function createCaptureBus() {
  const listeners = [];
  return {
    addEventListener(type, handler, options) {
      if (type !== 'keydown') return;
      listeners.push({
        handler,
        capture: options === true || options?.capture === true,
      });
    },
    removeEventListener(type, handler, options) {
      const capture = options === true || options?.capture === true;
      const index = listeners.findIndex(
        (entry) => entry.handler === handler && entry.capture === capture,
      );
      if (index >= 0) listeners.splice(index, 1);
    },
    dispatch(code) {
      const event = {
        code,
        key: code.replace('Digit', '').replace('Numpad', ''),
        repeat: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        target: { tagName: 'CANVAS', isContentEditable: false },
        defaultPrevented: false,
        propagationStopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopImmediatePropagation() { this.propagationStopped = true; },
      };
      for (const entry of [...listeners]) {
        if (!entry.capture) continue;
        entry.handler(event);
        if (event.propagationStopped) break;
      }
      return event;
    },
  };
}

function attachPlayerSwallow(bus) {
  bus.addEventListener('keydown', (event) => {
    if (event.code !== 'Escape') event.stopImmediatePropagation();
  }, true);
}

test('late spell listener never sees Digit1 once the player swallows keys', () => {
  const bus = createCaptureBus();
  attachPlayerSwallow(bus);

  let spellSawKey = false;
  bus.addEventListener('keydown', () => {
    spellSawKey = true;
  }, true);

  bus.dispatch('Digit1');
  assert.equal(spellSawKey, false);
});

test('attachSpellHotkeys before the player claims Digit1', () => {
  const bus = createCaptureBus();
  const spells = ['fire', 'water', 'air', 'earth', 'lightning', 'fireball'];
  let castId = null;
  let handler = (event) => {
    if (!event.code.startsWith('Digit')) return false;
    const spellId = spells[Number(event.code.slice(5)) - 1];
    if (!spellId) return false;
    event.preventDefault();
    castId = spellId;
    return true;
  };

  const detach = attachSpellHotkeys(() => handler, bus);
  attachPlayerSwallow(bus);

  const event = bus.dispatch('Digit1');
  assert.equal(castId, 'fire');
  assert.equal(event.propagationStopped, true);
  assert.equal(event.defaultPrevented, true);

  castId = null;
  handler = null;
  bus.dispatch('Digit2');
  assert.equal(castId, null);

  detach();
});
