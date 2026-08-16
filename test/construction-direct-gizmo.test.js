import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import {
  nominalTopHeightAtAnchor,
  setAnchorTopHeight,
  translateConstructionRecord,
} from '../src/editor/construction/ui/ConstructionDirectGizmoModel.js';
import { createWallTopProfile } from '../src/editor/construction/masonry/WallTopProfile.js';

const PATH = Object.freeze({
  version: 2,
  type: 'cubicBezier',
  closed: false,
  anchors: Object.freeze([
    Object.freeze({ id: 'anchor-a', position: Object.freeze([0, 0]) }),
    Object.freeze({ id: 'anchor-b', position: Object.freeze([5, 0]) }),
    Object.freeze({ id: 'anchor-c', position: Object.freeze([10, 0]) }),
  ]),
  segments: Object.freeze([
    Object.freeze({
      id: 'segment-a',
      startAnchorId: 'anchor-a',
      endAnchorId: 'anchor-b',
      startHandle: Object.freeze([1.5, 0]),
      endHandle: Object.freeze([-1.5, 0]),
    }),
    Object.freeze({
      id: 'segment-b',
      startAnchorId: 'anchor-b',
      endAnchorId: 'anchor-c',
      startHandle: Object.freeze([1.5, 0]),
      endHandle: Object.freeze([-1.5, 0]),
    }),
  ]),
  features: Object.freeze([]),
});

const ARC_TABLE = Object.freeze({
  totalLength: 10,
  toArc(segmentId, arcFraction) {
    return (segmentId === 'segment-a' ? 0 : 5) + arcFraction * 5;
  },
});

function record(kind = 'wall', top = undefined) {
  return normalizeConstructionRecord({
    version: 1,
    id: `construction-${kind}`,
    revision: 1,
    seed: 17,
    kind,
    style: { key: 'coursed-rubble', version: 1 },
    dimensions: { height: 3.5, thickness: 0.8 },
    path: PATH,
    features: [],
    ...(top ? { top } : {}),
  });
}

test('new wall records default to an irregular stone crown while buildings stay flat', () => {
  assert.equal(record('wall').top.style, 'irregular');
  assert.equal(record('building').top.style, 'flat');
  assert.equal(record('wall', { style: 'flat', base: 3.5, profile: [] }).top.style, 'flat');
});

test('irregular wall tops vary at stone scale without changing the authored base height', () => {
  const wall = record('wall');
  const profile = createWallTopProfile(wall, ARC_TABLE);
  const heights = Array.from({ length: 41 }, (_, index) => profile.heightAt(index * 0.25));
  const spread = Math.max(...heights) - Math.min(...heights);

  assert.ok(spread > 0.18, `expected a readable irregular crown, got ${spread}`);
  assert.ok(spread < 0.9, `irregular crown should remain controlled, got ${spread}`);
  assert.deepEqual(heights, Array.from({ length: 41 }, (_, index) => profile.heightAt(index * 0.25)));
});

test('direct height editing changes one control point and brackets its neighbours', () => {
  const wall = record('wall', { style: 'flat', base: 3.5, profile: [] });
  const top = setAnchorTopHeight(wall, ARC_TABLE, 'anchor-b', 5.25);
  assert.ok(top);

  const edited = { ...wall, top };
  assert.equal(nominalTopHeightAtAnchor(edited, ARC_TABLE, 'anchor-b'), 5.25);
  assert.equal(nominalTopHeightAtAnchor(edited, ARC_TABLE, 'anchor-a'), 3.5);
  assert.equal(nominalTopHeightAtAnchor(edited, ARC_TABLE, 'anchor-c'), 3.5);
});

test('move-all translation preserves curve shape and wall-authored detail', () => {
  const wall = record('wall');
  const moved = translateConstructionRecord(wall, 7.5, -3.25);

  assert.deepEqual(moved.path.anchors.map(({ position }) => position), [
    [7.5, -3.25],
    [12.5, -3.25],
    [17.5, -3.25],
  ]);
  assert.deepEqual(moved.path.segments, wall.path.segments);
  assert.deepEqual(moved.top, wall.top);
  assert.deepEqual(moved.features, wall.features);
});
