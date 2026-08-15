import assert from 'node:assert/strict';
import test from 'node:test';

import { AudioBus } from '../src/editor/audio/audio_bus.js';

function installStorage(values) {
  const original = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  return () => {
    if (original === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = original;
  };
}

test('corrupt persisted master volume falls back to configured default', () => {
  const restore = installStorage(new Map([
    ['drusniel_audio_master_volume', 'not-a-number'],
  ]));
  try {
    const bus = new AudioBus();
    assert.equal(bus.getAudioState().masterVolume, bus.getConfig().global.master_volume);
  } finally {
    restore();
  }
});

test('invalid runtime master volume is rejected without corrupting audio state', () => {
  const bus = new AudioBus();
  const before = bus.getAudioState().masterVolume;

  assert.equal(bus.setMasterVolume(Number.NaN), false);
  assert.equal(bus.getAudioState().masterVolume, before);
  assert.equal(bus.setMasterVolume(2), true);
  assert.equal(bus.getAudioState().masterVolume, 1);
});
