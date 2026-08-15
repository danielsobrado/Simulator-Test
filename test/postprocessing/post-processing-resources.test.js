import assert from 'node:assert/strict';
import test from 'node:test';
import { PostProcessingResources } from '../../src/render/postprocessing/PostProcessingResources.js';

function createResources(pixelRatio = 1) {
  return new PostProcessingResources({ getPixelRatio: () => pixelRatio });
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

test('resize normalizes invalid render dimensions and pixel ratio', () => {
  const resources = createResources(Number.NaN);
  const resizeCalls = [];
  resources.acquireGraph('post:test', () => ({
    resize(...args) { resizeCalls.push(args); },
    dispose() {},
  }));
  resources.activateGraph('post:test');
  resizeCalls.length = 0;

  assert.equal(resources.resize(Number.NaN, Number.POSITIVE_INFINITY, 0), false);
  assert.deepEqual(resources.snapshot(), {
    width: 1,
    height: 1,
    pixelRatio: 1,
    retainedGraphCount: 1,
    activeSignature: 'post:test',
  });
  assert.deepEqual(resizeCalls, []);

  assert.equal(resources.resize(320, 180, 2), true);
  assert.deepEqual(resizeCalls, [[320, 180, 2]]);
  resources.dispose();
});

test('resizeGraph normalizes malformed warmup dimensions before graph resize', () => {
  const resources = createResources();
  const resizeCalls = [];
  resources.acquireGraph('post:test', () => ({
    resize(...args) { resizeCalls.push(args); },
    dispose() {},
  }));

  resources.resizeGraph('post:test', Number.NEGATIVE_INFINITY, Number.NaN, Infinity);

  assert.deepEqual(resizeCalls, [[1, 1, 1]]);
  resources.dispose();
});
