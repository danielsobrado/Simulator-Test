import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_CONSTRUCTION_PATH_POINTS,
  normalizeConstructionPath,
} from '../src/editor/construction/ConstructionSchema.js';
import {
  createCubicBezierPathFromStroke,
  sampleCubicBezierPath,
} from '../src/editor/construction/curve/CubicBezierPath.js';

test('curve sampling enforces one budget across every segment', () => {
  const path = createCubicBezierPathFromStroke([
    [0, 0],
    [8, 0],
    [16, 0],
  ], { simplifyTolerance: 0 });

  assert.throws(
    () => sampleCubicBezierPath(path, { maxSpacing: 0.5, maxSamples: 25 }),
    /sampling exceeded/,
  );
});

test('construction schema rejects oversized paths before geometry allocation', () => {
  const anchors = Array.from({ length: MAX_CONSTRUCTION_PATH_POINTS + 1 }, (_, index) => ({
    id: `anchor-${index + 1}`,
    position: [index, 0],
  }));
  const segments = anchors.slice(0, -1).map((anchor, index) => ({
    id: `segment-${index + 1}`,
    startAnchorId: anchor.id,
    endAnchorId: anchors[index + 1].id,
    startHandle: [0, 0],
    endHandle: [0, 0],
  }));

  assert.throws(
    () => normalizeConstructionPath({
      version: 2,
      type: 'cubicBezier',
      closed: false,
      anchors,
      segments,
      features: [],
    }),
    new RegExp(`at most ${MAX_CONSTRUCTION_PATH_POINTS} anchors`),
  );
});
