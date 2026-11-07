import assert from 'node:assert/strict';
import test from 'node:test';
import { acquireKtx2Loader } from '../src/editor/assets/sharedKtx2Loader.js';

const renderer = () => ({ isWebGPURenderer: true, hasFeature: () => false });
const telemetry = () => ({ clock: () => 0, setKtx2Support() {}, recordKtx2() {} });

test('owners on one renderer share one KTX2 loader, disposed by the last release', () => {
  const device = renderer();
  const first = acquireKtx2Loader(device, '/', telemetry());
  const second = acquireKtx2Loader(device, '/', telemetry());
  assert.equal(first.loader, second.loader);
  let disposed = 0;
  const dispose = first.loader.dispose.bind(first.loader);
  first.loader.dispose = () => { disposed++; return dispose(); };
  first.release();
  first.release(); // a second release by the same owner is ignored
  assert.equal(disposed, 0, 'another owner still holds it');
  second.release();
  assert.equal(disposed, 1);
  const next = acquireKtx2Loader(device, '/', telemetry());
  assert.notEqual(next.loader, first.loader, 'a fully released loader is rebuilt, never reused');
  next.release();
});

test('separate renderers and transcoder locations never share a loader', () => {
  const a = acquireKtx2Loader(renderer(), '/', telemetry());
  const b = acquireKtx2Loader(renderer(), '/', telemetry());
  const device = renderer();
  const root = acquireKtx2Loader(device, '/', telemetry());
  const nested = acquireKtx2Loader(device, '/game/', telemetry());
  assert.notEqual(a.loader, b.loader);
  assert.notEqual(root.loader, nested.loader);
  assert.equal(nested.loader.transcoderPath, '/game/assets/gods-end/decoders/basis/');
  for (const held of [a, b, root, nested]) held.release();
});
