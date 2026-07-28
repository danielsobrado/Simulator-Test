import assert from 'node:assert/strict';
import test from 'node:test';
import { compileConstructionCollision } from '../src/editor/construction/compile/ConstructionCollisionCompiler.js';
import { sampleCubicBezierPath } from '../src/editor/construction/curve/CubicBezierPath.js';
import {
  curvedConstruction,
  doorFeature,
  straightConstruction,
} from './helpers/constructionCollisionFixtures.js';

function compile(record, curveSegmentLength = 1.25) {
  return compileConstructionCollision(
    record,
    sampleCubicBezierPath(record.path),
    { curveSegmentLength },
  );
}

test('a straight construction wall compiles to one oriented box', () => {
  const record = straightConstruction();
  const plan = compile(record);

  assert.equal(plan.version, 1);
  assert.equal(plan.constructionId, record.id);
  assert.equal(plan.constructionRevision, record.revision);
  assert.equal(plan.boxes.length, 1);
  assert.equal(plan.boxes[0].segmentId, 'segment-main');
  assert.ok(Math.abs(plan.boxes[0].length - 16) < 1e-6);
  assert.deepEqual(plan.boxes[0].tangent, [1, 0]);
  assert.deepEqual([plan.boxes[0].bottom, plan.boxes[0].top], [0, 3.5]);
});

test('long straight walls are partitioned into bounded overlapping boxes', () => {
  const plan = compile(straightConstruction({ start: [0, 0], end: [200, 0] }));

  assert.ok(plan.boxes.length > 1);
  assert.ok(plan.boxes.every((box) => box.length <= 48.4));
  for (let index = 1; index < plan.boxes.length; index += 1) {
    const previous = plan.boxes[index - 1];
    const current = plan.boxes[index];
    assert.ok(
      current.center[0] - previous.center[0] <= (current.length + previous.length) / 2,
    );
  }
});

test('curved construction boxes overlap through the source-segment join', () => {
  const plan = compile(curvedConstruction(), 1);

  assert.ok(plan.boxes.length > 8);
  const fullHeight = plan.boxes.filter((box) => box.bottom === 0 && box.top === 3.5);
  for (let index = 1; index < fullHeight.length; index += 1) {
    const previous = fullHeight[index - 1];
    const current = fullHeight[index];
    const centerDistance = Math.hypot(
      current.center[0] - previous.center[0],
      current.center[1] - previous.center[1],
    );
    assert.ok(
      centerDistance <= (current.length + previous.length) / 2 + 1e-6,
      `gap between ${previous.id} and ${current.id}`,
    );
  }
  const join = fullHeight.findIndex((box) => box.segmentId === 'segment-north-east');
  assert.ok(join > 0);
  assert.notEqual(fullHeight[join - 1].segmentId, fullHeight[join].segmentId);
});

test('door openings remove the player-height band but retain a lintel', () => {
  const record = straightConstruction({ features: [doorFeature()] });
  const plan = compile(record, 1);
  const openingBoxes = plan.boxes.filter((box) => box.openingIds.includes('door-main'));
  const solidBoxes = plan.boxes.filter((box) => !box.openingIds.includes('door-main'));

  assert.ok(openingBoxes.length > 0);
  assert.ok(openingBoxes.every((box) => box.bottom >= 2.2));
  assert.ok(openingBoxes.some((box) => box.bottom === 2.2 && box.top === 3.5));
  assert.ok(solidBoxes.some((box) => box.bottom === 0 && box.top === 3.5));
});

test('construction collision compilation is deterministic', () => {
  const record = curvedConstruction();
  const first = compile(record);
  const second = compile(record);

  assert.equal(first.signature, second.signature);
  assert.deepEqual(first.boxes, second.boxes);
  assert.deepEqual(first.bounds, second.bounds);
});
