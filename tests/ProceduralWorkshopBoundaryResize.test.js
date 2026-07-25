import assert from 'node:assert/strict';
import test from 'node:test';
import { solveWorkshopBoundaryResize } from '../src/editor/workshop/ProceduralWorkshopBoundaryResize.js';

test('positive and negative boundary drags resize in their outward directions', () => {
  const right = solveWorkshopBoundaryResize({
    startScale: 1,
    startSpan: 4,
    pointerDelta: 2,
    side: 1,
    scaleMin: 0.1,
    scaleMax: 4,
  });
  const left = solveWorkshopBoundaryResize({
    startScale: 1,
    startSpan: 4,
    pointerDelta: -2,
    side: -1,
    scaleMin: 0.1,
    scaleMax: 4,
  });

  assert.deepEqual(right, { scale: 1.5, span: 6, boundaryDelta: 2 });
  assert.deepEqual(left, { scale: 1.5, span: 6, boundaryDelta: -2 });
});

test('boundary resize snaps scale and reports the actual clamped boundary movement', () => {
  const snapped = solveWorkshopBoundaryResize({
    startScale: 1,
    startSpan: 5,
    pointerDelta: 1.12,
    side: 1,
    scaleMin: 0.5,
    scaleMax: 1.2,
    scaleSnap: 0.1,
    snapEnabled: true,
  });

  assert.deepEqual(snapped, { scale: 1.2, span: 6, boundaryDelta: 1 });

  const clamped = solveWorkshopBoundaryResize({
    startScale: 1,
    startSpan: 5,
    pointerDelta: -20,
    side: 1,
    scaleMin: 0.25,
    scaleMax: 4,
  });
  assert.deepEqual(clamped, { scale: 0.25, span: 1.25, boundaryDelta: -3.75 });
});
