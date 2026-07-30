import assert from 'node:assert/strict';
import test from 'node:test';
import { PostProcessingFrameState } from '../../src/render/postprocessing/PostProcessingFrameState.js';

test('beginFrame reuses fixed frame state storage', () => {
  const frameState = new PostProcessingFrameState();
  const keys = Object.keys(frameState);
  const camera = Object.freeze({ name: 'test-camera' });
  const resources = Object.freeze({ width: 1920, height: 1080, pixelRatio: 1.5 });

  const first = frameState.beginFrame(camera, resources);
  const second = frameState.beginFrame(camera, resources);

  assert.strictEqual(first, frameState);
  assert.strictEqual(second, frameState);
  assert.deepEqual(Object.keys(frameState), keys);
  assert.strictEqual(frameState.camera, camera);
  assert.equal(frameState.frame, 2);
  assert.equal(frameState.width, 1920);
  assert.equal(frameState.height, 1080);
  assert.equal(frameState.pixelRatio, 1.5);
});
