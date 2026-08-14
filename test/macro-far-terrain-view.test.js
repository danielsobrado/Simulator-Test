import assert from 'node:assert/strict';
import test from 'node:test';
import { MacroFarTerrainView } from '../src/editor/world/MacroFarTerrainView.js';

function createHarness(originRef, fieldRef) {
  const view = Object.create(MacroFarTerrainView.prototype);
  view.enabled = true;
  view.generator = {};
  view.ensureGenerator = () => view.generator;
  view.mesh = { visible: false };
  view.floatingOrigin = { getState: () => originRef.current };
  view.forestFieldProvider = () => fieldRef.current;
  view.builtOriginX = null;
  view.builtOriginZ = null;
  view.builtForestSignature = null;
  view.pendingHeights = new Float32Array(1);
  view.pendingTileIds = new Int32Array(1);
  view.pendingForest = new Float32Array(1);
  view.advanceCount = 0;
  view.advanceJob = () => {
    view.advanceCount += 1;
    return false;
  };
  return view;
}

test('MacroFarTerrainView restarts an active rebuild when the floating origin changes', () => {
  const originRef = { current: { x: 0, z: 0 } };
  const fieldRef = { current: { signature: 'forest-a' } };
  const view = createHarness(originRef, fieldRef);
  view.startJob(0, 0, fieldRef.current);
  const staleJob = view.job;

  originRef.current = { x: 256, z: -128 };
  view.update();

  assert.notStrictEqual(view.job, staleJob);
  assert.equal(view.job.originX, 256);
  assert.equal(view.job.originZ, -128);
  assert.strictEqual(view.job.field, fieldRef.current);
  assert.equal(view.job.forestSignature, 'forest-a');
  assert.equal(view.advanceCount, 1);
});

test('MacroFarTerrainView restarts an active rebuild when the forest field changes', () => {
  const originRef = { current: { x: 0, z: 0 } };
  const fieldRef = { current: { signature: 'forest-a' } };
  const view = createHarness(originRef, fieldRef);
  view.startJob(0, 0, fieldRef.current);
  const staleJob = view.job;
  const nextField = { signature: 'forest-b' };

  fieldRef.current = nextField;
  view.update();

  assert.notStrictEqual(view.job, staleJob);
  assert.strictEqual(view.job.field, nextField);
  assert.equal(view.job.forestSignature, 'forest-b');
  assert.equal(view.advanceCount, 1);
});

test('MacroFarTerrainView continues a current active rebuild without restarting it', () => {
  const originRef = { current: { x: 0, z: 0 } };
  const fieldRef = { current: { signature: 'forest-a' } };
  const view = createHarness(originRef, fieldRef);
  view.startJob(0, 0, fieldRef.current);
  const currentJob = view.job;

  view.update();

  assert.strictEqual(view.job, currentJob);
  assert.equal(view.advanceCount, 1);
});
