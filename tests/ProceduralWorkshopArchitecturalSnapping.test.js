import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isWorkshopArchitecturalOpening,
  solveWorkshopArchitecturalSnap,
} from '../src/editor/workshop/ProceduralWorkshopArchitecturalSnapping.js';

const WALL = Object.freeze({
  minX: -4,
  maxX: 4,
  minY: 0,
  maxY: 5,
});

test('architectural openings stay contained by their parent wall surface', () => {
  const result = solveWorkshopArchitecturalSnap({
    kind: 'door',
    position: { x: 9, y: -2 },
    size: { x: 1, y: 2 },
    wallBounds: WALL,
    enabled: false,
    edgeInset: 0.1,
  });

  assert.deepEqual(result.position, { x: 3.4, y: 1.1 });
  assert.deepEqual(
    result.guides.map(({ axis, reason }) => ({ axis, reason })),
    [
      { axis: 'x', reason: 'Kept inside wall' },
      { axis: 'y', reason: 'Kept inside wall' },
    ],
  );
});

test('doors and arches magnetize to a nearby wall floor line', () => {
  const result = solveWorkshopArchitecturalSnap({
    kind: 'door',
    position: { x: 0.04, y: 1.28 },
    size: { x: 1, y: 2 },
    wallBounds: WALL,
    threshold: 0.2,
    edgeInset: 0.06,
  });

  assert.equal(result.position.x, 0);
  assert.equal(result.position.y, 1.06);
  assert.ok(result.guides.some(({ reason }) => reason === 'Wall floor line'));
  assert.ok(result.guides.some(({ reason }) => reason === 'Wall centre'));
});

test('windows align into rows and preserve convenient repeated spacing', () => {
  const sibling = {
    kind: 'window',
    label: 'Window 1',
    position: { x: 0, y: 2.5 },
    size: { x: 1, y: 1.4 },
  };
  const result = solveWorkshopArchitecturalSnap({
    kind: 'window',
    position: { x: 1.22, y: 2.58 },
    size: { x: 1, y: 1.4 },
    wallBounds: WALL,
    siblings: [sibling],
    threshold: 0.2,
    neighborGap: 0.16,
  });

  assert.ok(Math.abs(result.position.x - 1.16) < 1e-9);
  assert.equal(result.position.y, 2.5);
  assert.ok(result.guides.some(({ reason }) => reason === 'Even spacing from Window 1'));
  assert.ok(result.guides.some(({ reason }) => reason === 'Row aligned with Window 1'));
});

test('opening scale adapts to a nearby opening of the same kind', () => {
  const result = solveWorkshopArchitecturalSnap({
    kind: 'window',
    mode: 'scale',
    position: { x: 1.5, y: 2.5 },
    size: { x: 0.92, y: 1.43 },
    wallBounds: WALL,
    siblings: [{
      kind: 'window',
      label: 'Window 1',
      position: { x: -1.5, y: 2.5 },
      size: { x: 1, y: 1.5 },
    }],
    threshold: 0.15,
  });

  assert.deepEqual(result.size, { x: 1, y: 1.5 });
  assert.ok(result.guides.some(({ reason }) => reason === 'Width matched to Window 1'));
  assert.ok(result.guides.some(({ reason }) => reason === 'Height matched to Window 1'));
});

test('only architectural opening kinds use wall-aware snapping', () => {
  assert.equal(isWorkshopArchitecturalOpening({ kind: 'door' }), true);
  assert.equal(isWorkshopArchitecturalOpening({ kind: 'window' }), true);
  assert.equal(isWorkshopArchitecturalOpening({ kind: 'opening' }), true);
  assert.equal(isWorkshopArchitecturalOpening({ kind: 'roof' }), false);
});
