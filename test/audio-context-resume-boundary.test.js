import assert from 'node:assert/strict';
import test from 'node:test';

import { ProceduralAudio } from '../src/editor/audio/procedural_audio.js';

test('audio context resume rejection is handled fail-soft', async () => {
  const audio = new ProceduralAudio();
  audio.ctx = {
    state: 'suspended',
    resume() {
      return Promise.reject(new Error('autoplay denied'));
    },
  };

  assert.doesNotThrow(() => audio.resumeContext());
  await new Promise((resolve) => setImmediate(resolve));
});

test('audio context resume synchronous errors are handled fail-soft', () => {
  const audio = new ProceduralAudio();
  audio.ctx = {
    state: 'suspended',
    resume() {
      throw new Error('context closed');
    },
  };

  assert.doesNotThrow(() => audio.resumeContext());
});
