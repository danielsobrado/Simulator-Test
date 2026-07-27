import assert from 'node:assert/strict';
import test from 'node:test';
import { ALL_AUDIO_EVENTS } from '../src/editor/audio/audio_event_id.js';
import { AudioThrottle } from '../src/editor/audio/audio_throttle.js';
import { ProceduralAudio } from '../src/editor/audio/procedural_audio.js';

test('audio event catalog includes spell casts and player jump', () => {
  assert.ok(ALL_AUDIO_EVENTS.includes('spell.fire.cast'));
  assert.ok(ALL_AUDIO_EVENTS.includes('spell.lightning.cast'));
  assert.ok(ALL_AUDIO_EVENTS.includes('player.jump'));
  assert.ok(ALL_AUDIO_EVENTS.includes('camera.mode.player'));
});

test('audio throttle enforces cooldown unless forced', () => {
  const throttle = new AudioThrottle();
  const config = { cooldown_ms: 10_000 };
  assert.equal(throttle.isThrottled('ui.click', config), false);
  assert.equal(throttle.isThrottled('ui.click', config), true);
  assert.equal(throttle.isThrottled('ui.click', config, true), false);
});

test('procedural audio can init without a window AudioContext in node', () => {
  const synth = new ProceduralAudio();
  assert.equal(synth.isInitialized(), false);
  assert.equal(synth.isEnabled(), true);
  synth.setMasterVolume(0.4);
  assert.equal(synth.getMasterVolume(), 0.4);
});
