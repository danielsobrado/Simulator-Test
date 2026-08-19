import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CurvePath,
  curvePathMetrics,
  evaluateCurveSegment,
  projectPointToCurvePath,
} from '../src/editor/workshop/curves/index.js';

function randomFactory(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function finiteResult(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finiteResult);
  if (value && typeof value === 'object') return Object.values(value).every(finiteResult);
  return true;
}

test('fuzzed line, arc, and quadratic previews never emit NaN or Infinity', () => {
  const random = randomFactory(0x2f6e2b1);
  const kinds = ['line', 'arc', 'quadratic'];
  for (let index = 0; index < 300; index += 1) {
    const kind = kinds[index % kinds.length];
    const start = [random() * 20 - 10, random() * 20 - 10];
    let end = [start[0] + random() * 5 + 0.05, start[1] + random() * 5 + 0.05];
    const segment = { id: 'segment', kind, startId: 'p0', endId: 'p1' };
    if (kind === 'arc') {
      const radius = 0.2 + random() * 6;
      const startAngle = random() * Math.PI * 2;
      const sweep = 0.05 + random() * (Math.PI * 1.8);
      const center = [random() * 10 - 5, random() * 10 - 5];
      start[0] = center[0] + Math.cos(startAngle) * radius;
      start[1] = center[1] + Math.sin(startAngle) * radius;
      end = [
        center[0] + Math.cos(startAngle + sweep) * radius,
        center[1] + Math.sin(startAngle + sweep) * radius,
      ];
      segment.center = center;
      segment.clockwise = false;
    } else if (kind === 'quadratic') {
      segment.control = [
        (start[0] + end[0]) / 2 + random() * 4 - 2,
        (start[1] + end[1]) / 2 + random() * 4 - 2,
      ];
    }
    const path = new CurvePath({
      id: 'fuzz-path',
      points: [
        { id: 'p0', position: start },
        { id: 'p1', position: end },
      ],
      segments: [segment],
    }, { preview: true });
    const metrics = curvePathMetrics(path);
    const projection = projectPointToCurvePath(path, [random() * 20 - 10, random() * 20 - 10]);
    const evaluated = evaluateCurveSegment(path.getSegment('segment'), random());
    assert.equal(finiteResult(metrics.totalLength), true, `non-finite length at case ${index}`);
    assert.equal(finiteResult(projection), true, `non-finite projection at case ${index}`);
    assert.equal(finiteResult(evaluated), true, `non-finite evaluation at case ${index}`);
    assert.ok(projection.parameter >= 0 && projection.parameter <= 1);
  }
});
