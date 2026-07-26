import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acceptsStrategicDetailPlacement,
  isInsideDetailColony,
  isNearOpenWaterShoreline,
} from '../src/editor/stylized/StrategicDetailPlacement.js';

const RULE = Object.freeze({
  strategy: 'shoreline-colonies',
  supercellSize: 72,
  probability: 0.34,
  radius: 16,
  shorelineCells: 6,
  openWaterTileIds: [0],
  seed: 9404,
});

test('detail colonies are deterministic, sparse, and contain visible patch interiors', () => {
  let inside = 0;
  let outside = 0;

  for (let z = -240; z <= 240; z += 4) {
    for (let x = -240; x <= 240; x += 4) {
      const first = isInsideDetailColony(x, z, RULE);
      assert.equal(isInsideDetailColony(x, z, RULE), first);
      if (first) inside += 1;
      else outside += 1;
    }
  }

  assert.ok(inside > 100, `expected colony interiors, received ${inside} samples`);
  assert.ok(outside > inside * 4, `expected mostly clear water, received ${outside}:${inside}`);
});

test('shoreline gating accepts bank water but rejects open water', () => {
  const context = {
    tileSize: 2,
    tileAt: (cellX) => (cellX >= 8 ? 4 : 0),
  };

  assert.equal(isNearOpenWaterShoreline(2, 0, RULE, context), false);
  assert.equal(isNearOpenWaterShoreline(6, 0, RULE, context), true);
});

test('strategic placement requires both a selected colony and nearby shore', () => {
  let colonyPoint = null;
  for (let z = -240; z <= 240 && !colonyPoint; z += 2) {
    for (let x = -240; x <= 240; x += 2) {
      if (isInsideDetailColony(x, z, RULE)) {
        colonyPoint = { x, z };
        break;
      }
    }
  }
  assert.ok(colonyPoint);

  const candidate = { ...colonyPoint, prototypeIndex: 4 };
  assert.equal(acceptsStrategicDetailPlacement(candidate, RULE, {
    tileSize: 2,
    tileAt: () => 0,
  }), false);
  assert.equal(acceptsStrategicDetailPlacement(candidate, RULE, {
    tileSize: 2,
    tileAt: () => 12,
  }), true);
  assert.equal(acceptsStrategicDetailPlacement(candidate, null, {
    tileSize: 2,
    tileAt: () => 0,
  }), true);
});
