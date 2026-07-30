import assert from 'node:assert/strict';
import test from 'node:test';
import { PostProcessingResources } from '../../src/render/postprocessing/PostProcessingResources.js';

function createResources() {
  return new PostProcessingResources({ getPixelRatio: () => 1 });
}

test('discardGraph disposes and removes a retained topology', () => {
  const resources = createResources();
  let disposed = 0;
  resources.acquireGraph('post:test', () => ({
    resize() {},
    dispose() { disposed += 1; },
  }));
  resources.activateGraph('post:test');

  assert.equal(resources.discardGraph('post:test'), true);
  assert.equal(disposed, 1);
  assert.equal(resources.snapshot().retainedGraphCount, 0);
  assert.equal(resources.snapshot().activeSignature, null);
  assert.equal(resources.discardGraph('post:test'), false);
  resources.dispose();
});
